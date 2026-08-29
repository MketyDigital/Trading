// worker.js
// StarPips AI Engine - Core Logic (100% Reliability Zero-Drop, High-Precision Parsing, Perfect Spacing & Multi-Webhook Support)

let CACHE = { settings: null, routes: null, last_fetched: 0 };
let PROCESSED_MESSAGES = new Map(); // Memory cache for instant deduplication: key -> timestamp

// Clean up old processed message keys from memory after 10 minutes
function cleanup_processed_messages() {
    const now = Date.now();
    for (let [key, timestamp] of PROCESSED_MESSAGES.entries()) {
        if (now - timestamp > 600000) { // 10 minutes
            PROCESSED_MESSAGES.delete(key);
        }
    }
}

/**
 * Strips source footers, credits, channel handles (@username), and promo hashtags (#hashtag).
 * NEVER touches or strips price numbers (e.g. @1.16644), TP levels, SL levels, or trading keywords!
 */
function strip_source_credits(text) {
    if (!text) return "";
    return text
        .split('\n')
        .filter(line => {
            const l = line.trim();
            if (!l) return false;
            // Strip social handles (starting with @ and a letter), promo hashtags, and source branding banners
            if (/^@[a-zA-Z]\w*/i.test(l) || /^#\w+/i.test(l)) return false;
            if (/VIP\s*SIGNAL|PRECISION\s*SNIPER|JOIN\s*CHANNEL|TELEGRAM|ADMIN/i.test(l) && !/BUY|SELL|TP|SL|ENTRY|PROFIT|LOSS|PRICE/i.test(l)) return false;
            return true;
        })
        .join('\n')
        .replace(/@[a-zA-Z][a-zA-Z0-9_]*/g, '') // strip any inline @handles (must start with a letter, never digits!)
        .replace(/#\w+/g, '') // strip any inline #hashtags
        .trim();
}

/**
 * Ensures perfect line spacing before Take Profit 1, Stop Loss, and the Starpips Forex footer.
 */
function ensure_signal_spacing(text) {
    if (!text) return text;
    let res = text;
    // 1. Ensure empty line before Take Profit 1
    res = res.replace(/([^\n]+)\n(<b>Take Profit 1|\bTake Profit 1)/gi, '$1\n\n$2');
    // 2. Ensure empty line before Stop Loss
    res = res.replace(/([^\n]+)\n(<b>Stop Loss|\bStop Loss)/gi, '$1\n\n$2');
    // 3. Ensure double line break and ~~~ before footer
    if (res.includes("Starpips Forex")) {
        res = res.replace(/\n*\s*(?:~~~)?\s*\n*<b>Starpips Forex<\/b>/gi, "\n\n~~~\n<b>Starpips Forex</b>");
    } else {
        res += "\n\n~~~\n<b>Starpips Forex</b>";
    }
    return res;
}

/**
 * Auto-repairs unbalanced HTML <b> and </b> tags.
 */
function fix_html_bold_tags(text) {
    if (!text) return text;
    let res = text.replace(/<\/B>/g, '</b>').replace(/<B>/g, '<b>');
    let openCount = (res.match(/<b>/g) || []).length;
    let closeCount = (res.match(/<\/b>/g) || []).length;
    while (openCount > closeCount) {
        res += '</b>';
        closeCount++;
    }
    return res;
}

/**
 * Strips away any internal AI reasoning thoughts, preambles (e.g. "Wait, let's..."), markdown fences (```html), and residual noise.
 */
function clean_ai_output(raw_text) {
    if (!raw_text) return "";
    let cleaned = raw_text;
    
    // 1. Remove markdown code fences
    cleaned = cleaned.replace(/```json\s*/ig, '').replace(/```html\s*/ig, '').replace(/```\s*/g, '').trim();

    // 2. Remove thinking / reasoning preambles before the actual output content
    const bIndex = cleaned.indexOf('<b>');
    const jsonIndex = cleaned.indexOf('{');

    if (jsonIndex !== -1 && (bIndex === -1 || jsonIndex < bIndex)) {
        // It's JSON! Extract from first '{' to last '}'
        const lastJsonIndex = cleaned.lastIndexOf('}');
        if (lastJsonIndex !== -1 && lastJsonIndex > jsonIndex) {
            cleaned = cleaned.substring(jsonIndex, lastJsonIndex + 1);
        }
    } else if (bIndex !== -1) {
        // It's HTML! Extract starting from the first '<b>'
        cleaned = cleaned.substring(bIndex);
    }

    // 3. Strip trailing AI commentary after the LAST footer occurrence (prevents cutting off early mentions)
    const footerIndex = cleaned.lastIndexOf('Starpips Forex');
    if (footerIndex !== -1) {
        const endFooterTag = cleaned.indexOf('</b>', footerIndex);
        if (endFooterTag !== -1) {
            cleaned = cleaned.substring(0, endFooterTag + 4);
        }
    }

    // 4. Auto-repair missing closing tags
    cleaned = fix_html_bold_tags(cleaned);

    return cleaned.trim();
}

function is_response_complete(content) {
    if (!content) return false;
    
    // Reject markdown code fences or backticks
    if (content.includes("```")) return false;

    // Reject AI reasoning preamble or draft thoughts
    if (/wait,|double check|let's check|thinking:|i should|here is the|the prompt says|standardized symbol/i.test(content)) return false;

    // 1. Bold Tag Balance (Telegram strictly requires tag pairings)
    const b_count = (content.match(/<b>/g) || []).length;
    const b_close_count = (content.match(/<\/b>/g) || []).length;
    if (b_count !== b_close_count) return false;
    
    // 2. Reject responses with unreplaced placeholders
    if (content.includes("[Price]") || content.includes("[Price]'") || content.includes("{ENTRY_PRICE}")) return false;

    // 3. Ensure required footer exists
    if (!content.includes("Starpips Forex") && !content.includes("StarPips")) return false;

    return true;
}

function parse_json_safely(raw_text) {
    if (!raw_text) return null;
    let cleaned = raw_text.replace(/```json\s*/ig, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/(\{[\s\S]*\})/);
    if (match) cleaned = match[1];

    try { return JSON.parse(cleaned); } catch (e) {}

    let repaired = cleaned.replace(/"([^"\\]|\\.)*"/g, m => m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
    repaired = repaired.replace(/("[\s\S]*?")\s*("[\s\S]*?")\s*:/g, '$1, $2:');
    try { return JSON.parse(repaired); } catch (e) {}

    repaired = repaired.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*([\]\}])/g, '$1');
    try { return JSON.parse(repaired); } catch (e) {}

    return null;
}

/**
 * HIGH-PRECISION DEEP INTELLIGENCE FALLBACK PARSER
 * Handles Forex, Crypto, and Deriv Volatility Indices + ALL Trade Updates (TP Hits, SL Hits, BE, Close, Cancel, Activated, Weekly Recaps).
 * Preserves FULL multi-digit price numbers (e.g. 756201.43, 757,200) without truncation.
 * Enforces clean double empty line breaks before TP1, SL, and the Starpips Forex footer.
 */
function format_fallback_signal(rawText) {
    if (!rawText) return null;
    
    // Strip external credits, handles, hashtags
    const text = strip_source_credits(rawText);
    if (!text) return null;
    const upper = text.toUpperCase();

    // 0. Check for Weekly Recap / Roundup
    const isWeeklyRecap = upper.includes("WEEKLY RECAP") || upper.includes("WEEKLY ROUNDUP") || upper.includes("WEEKLY SUMMARY") || upper.includes("WEEK IN REVIEW");
    if (isWeeklyRecap) {
        const cleanLines = text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => (l.startsWith('<b>') && l.endsWith('</b>')) ? l : `<b>${l}</b>`);

        return `${cleanLines.join('\n\n')}\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 1. Check for Stop Loss Hit (SL Hit) -> Uses ❌
    const isSlHit = upper.includes("SL HIT") || upper.includes("STOP LOSS HIT") || (upper.includes("SL") && upper.includes("HIT")) || (upper.includes("SL") && upper.includes("TOUCHED")) || upper.includes("SL HIT ❌");
    if (isSlHit) {
        return `<b>SL HIT ❌</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 2. Check for TP Hits (e.g. TP 1, TP 2, TP 3 Hit / Done / ✅ / 💣 / 🎯)
    const hasTpKeyword = upper.includes("TP") || upper.includes("TAKE PROFIT") || /TP\s*[0-9]/i.test(upper);
    const hasTpHitIndicator = upper.includes("HIT") || upper.includes("REACHED") || upper.includes("DONE") || upper.includes("TARGET") || 
                              upper.includes("CLOSED") || upper.includes("SECURED") || upper.includes("SMASHED") || upper.includes("CLEARED") ||
                              upper.includes("✅") || upper.includes("🎯") || upper.includes("💣") || upper.includes("💯") || upper.includes("🔥");

    if (hasTpKeyword && hasTpHitIndicator && !upper.includes("BUY") && !upper.includes("SELL")) {
        const tpMatch = upper.match(/(?:TP|TAKE\s*PROFIT)\s*([0-9]+)/);
        const tpNum = tpMatch ? tpMatch[1] : "1";
        const tpTarget = `TP ${tpNum}`;

        // ONLY TP 1 includes "Move Stop Loss to Break Even."
        if (tpNum === "1") {
            return `<b>${tpTarget} HIT 🔥🔥😍😍💯✅</b>\n<b>Move Stop Loss to Break Even.</b>\n\n~~~\n<b>Starpips Forex</b>`;
        } else {
            return `<b>${tpTarget} HIT 🔥🔥😍😍💯✅</b>\n\n~~~\n<b>Starpips Forex</b>`;
        }
    }

    // 3. Move SL to Break Even (BE)
    const isBE = (upper.includes("SL") || upper.includes("STOP")) && (upper.includes("BE") || upper.includes("BREAK EVEN") || upper.includes("ENTRY"));
    if (isBE && !upper.includes("BUY") && !upper.includes("SELL")) {
        return `<b>Move Stop Loss to Break Even. 🎯✅</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 4. Close Half / Secure Partials
    const isCloseHalf = upper.includes("CLOSE HALF") || upper.includes("SECURE PARTIAL") || upper.includes("TAKE PARTIAL") || upper.includes("CLOSE 50%") || upper.includes("CLOSE 80%");
    if (isCloseHalf) {
        return `<b>Close Half Position & Secure Profits. 💰✅</b>\n<b>Move Stop Loss to Break Even.</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 5. Close All / Exit Trade
    const isCloseAll = upper.includes("CLOSE ALL") || upper.includes("CLOSE TRADE") || upper.includes("EXIT NOW") || upper.includes("CLOSE NOW");
    if (isCloseAll) {
        return `<b>Close All Positions Now 🚨✅</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 6. Cancel Signal / Delete Order
    const isCancel = upper.includes("CANCEL") || upper.includes("DELETE ORDER") || upper.includes("DELETE LIMIT") || upper.includes("DELETE STOP");
    if (isCancel && !upper.includes("BUY") && !upper.includes("SELL")) {
        return `<b>Signal Cancelled / Delete Pending Order ❌</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 7. Order Activated / Entry Hit
    const isActivated = upper.includes("ACTIVATED") || upper.includes("ENTRY HIT") || upper.includes("ENTRY ZONE HIT") || upper.includes("TRIGGERED");
    if (isActivated && !upper.includes("TAKE PROFIT") && !upper.includes("STOP LOSS")) {
        return `<b>Pending Order Activated / Entry Zone Hit ⚡✅</b>\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 8. Check for Progress / Running Pips / Update Reports (MUST NOT BE PARSED AS A NEW TRADE SIGNAL!)
    const isProgressReport = upper.includes("RUNNING") || upper.includes("PIPS") || upper.includes("DRAW DOWN") || upper.includes("ACED IT");
    
    if (isProgressReport && !upper.includes("TAKE PROFIT 1 AT") && !upper.includes("STOP LOSS AT")) {
        const cleanLines = text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => (l.startsWith('<b>') && l.endsWith('</b>')) ? l : `<b>${l}</b>`);

        return `${cleanLines.join('\n\n')}\n\n~~~\n<b>Starpips Forex</b>`;
    }

    // 9. New Trade Signals (Universal Support for Forex including JPY pairs, Gold/Metals, Commodities, Indices, Crypto, Deriv Volatility/Synthetics)
    const actionMatch = text.match(/\b(BUY\s+LIMIT|SELL\s+LIMIT|BUY\s+STOP|SELL\s+STOP|BUY\s+NOW|SELL\s+NOW|GO\s+LONG|GO\s+SHORT|BUY|SELL|LONG|SHORT)\b/i);
    
    // Universal Symbol Recognition Regex (Matches Forex 6-char pairs, Slash pairs, JPY pairs, Deriv V-indices, Boom/Crash, Indices, Commodities, Crypto)
    const symbolMatch = text.match(/\b(VOLATILITY\s*[0-9]+(?:\s*\([0-9]+S\))?(?:\s*INDEX)?|V[0-9]{2,3}(?:\s*\([0-9]+S\))?|BOOM\s*[0-9]+|CRASH\s*[0-9]+|STEP(?:\s*INDEX)?|JUMP\s*[0-9]+|RANGE\s*BREAK(?:\s*[0-9]+)?|DEX\s*[0-9]+|[A-Z]{3}\/[A-Z]{3,4}|[A-Z]{6}|GOLD|SILVER|XAUUSD|XAGUSD|US30|DJ30|DOW|NAS100|USTECH|NDX|SPX500|SP500|GER30|GER40|DAX|UK100|FTSE|JP225|HK50|OIL|WTI|BRENT|BTCUSD|ETHUSD|SOLUSD|XRPUSD|BTC|ETH|SOL|XRP)\b/i);

    if (actionMatch && symbolMatch && !isProgressReport) {
        let action = actionMatch[1].toUpperCase();
        if (action === "LONG" || action === "GO LONG") action = "BUY";
        if (action === "SHORT" || action === "GO SHORT") action = "SELL";
        if (action === "BUY NOW") action = "BUY";
        if (action === "SELL NOW") action = "SELL";

        let rawSymbol = symbolMatch[1].trim().toUpperCase().replace('/', '');
        
        // Standardize Symbol Display
        let symbol = rawSymbol;
        if (symbol === "GOLD") symbol = "XAUUSD";
        if (symbol === "SILVER") symbol = "XAGUSD";
        symbol = symbol.replace(/\s*INDEX$/i, ''); // Strip trailing "INDEX"

        // Extract Take Profits with FULL multi-digit & multi-decimal precision
        const tps = [];
        const tpRegex = /(?:TP|TAKE\s*PROFIT|TARGET)[\s\-_]*([0-9]?)[\s:@=\-]*([0-9]{1,10}(?:[\.,][0-9]+)?)(?:\s*(\([^)]+\)))?/gi;
        let match;
        while ((match = tpRegex.exec(text)) !== null) {
            const num = match[1] || (tps.length + 1);
            const price = match[2];
            const extra = match[3] ? ` ${match[3]}` : "";
            tps.push(`<b>Take Profit ${num} at ${price}${extra}</b>`);
        }

        // Extract Stop Loss with FULL multi-digit & multi-decimal precision
        let slLine = "";
        const slMatch = text.match(/(?:SL|STOP\s*LOSS|STOP)[\s:@=\-]*([0-9]{1,10}(?:[\.,][0-9]+)?)(?:\s*(\([^)]+\)))?/i);
        if (slMatch) {
            const price = slMatch[1];
            const extra = slMatch[2] ? ` ${slMatch[2]}` : "";
            slLine = `<b>Stop Loss at ${price}${extra}</b>`;
        }

        // Extract Entry Price or Entry Zone (supporting NOW @156.40, @1.16644, AT 1.16644, ENTRY: 156.40, EP: 156.40, range 156.20 - 156.50, CMP)
        let entry = "CMP";
        const explicitEntryMatch = text.match(/(?:ENTRY(?:\s*ZONE)?|EP|ZONE|NOW\s*@?|AT|@)[:\s=@\-]*([0-9]{1,10}(?:[\.,][0-9]+)?(?:\s*[\-\–\/]\s*[0-9]{1,10}(?:[\.,][0-9]+)?)?)/i);
        
        if (explicitEntryMatch && explicitEntryMatch[1]) {
            entry = explicitEntryMatch[1].replace(/\s+/g, ' ');
        } else {
            // Strip symbol, action, and matched TP/SL lines to find any remaining price number
            let cleanTextForEntry = text.replace(symbolMatch[0], '').replace(actionMatch[0], '');
            if (slMatch && slMatch[0]) cleanTextForEntry = cleanTextForEntry.replace(slMatch[0], '');
            cleanTextForEntry = cleanTextForEntry.replace(/(?:TP|TAKE\s*PROFIT|TARGET)[\s\-_]*[0-9]?[\s:@=\-]*[0-9]{1,10}(?:[\.,][0-9]+)?(?:\s*\([^)]+\))?/gi, '');
            cleanTextForEntry = cleanTextForEntry.replace(/\b(?:NOW|AT|LIMIT|STOP|ENTRY|EP|ZONE|CMP)\b/gi, '');

            const numberMatches = cleanTextForEntry.match(/(?:\b[0-9]{1,10}(?:[\.,][0-9]+)?(?:\s*[\-\–\/]\s*[0-9]{1,10}(?:[\.,][0-9]+)?)?\b)/g);
            if (numberMatches && numberMatches.length > 0) {
                entry = numberMatches[0].trim();
            }
        }

        if (tps.length > 0 || slLine) {
            let res = `<b>${action} ${symbol} (${entry})</b>\n\n`; // Blank line after header
            if (tps.length > 0) {
                res += tps.join('\n') + '\n\n'; // Blank line after TPs
            }
            if (slLine) {
                res += slLine + '\n\n'; // Blank line after SL
            }
            res += `~~~\n<b>Starpips Forex</b>`;
            return res;
        } else {
            return `<b>${action} ${symbol} (${entry})</b>\n\n~~~\n<b>Starpips Forex</b>`;
        }
    }

    // 10. Fallback for General Update Messages / Recaps
    const cleanLines = text.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => (l.startsWith('<b>') && l.endsWith('</b>')) ? l : `<b>${l}</b>`);

    return `${cleanLines.join('\n\n')}\n\n~~~\n<b>Starpips Forex</b>`;
}

async function fetch_db_config_with_fallback(supabaseUrl, supabaseHeaders) {
    const current_time = Date.now();
    if (CACHE.settings && CACHE.routes && (current_time - CACHE.last_fetched < 60000)) {
        return { settings: CACHE.settings, routes: CACHE.routes };
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const [settingsRes, routesRes] = await Promise.all([
                fetch(`${supabaseUrl}/rest/v1/settings?select=*`, { headers: supabaseHeaders, signal: controller.signal }),
                fetch(`${supabaseUrl}/rest/v1/routes?active=eq.true`, { headers: supabaseHeaders, signal: controller.signal })
            ]);
            clearTimeout(timeoutId);

            if (settingsRes.ok && routesRes.ok) {
                const settingsList = await settingsRes.json();
                const allRoutes = await routesRes.json();
                const settingsDict = {};
                for (let s of settingsList) settingsDict[s.key] = s.value;

                CACHE.settings = settingsDict;
                CACHE.routes = allRoutes;
                CACHE.last_fetched = current_time;
                return { settings: CACHE.settings, routes: CACHE.routes };
            }
        } catch (e) {
            console.error(`Attempt ${attempt} to fetch DB config failed:`, e);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
    }

    if (CACHE.settings && CACHE.routes) {
        console.warn("⚠️ Supabase fetch failed. Falling back to stale in-memory cache.");
        return { settings: CACHE.settings, routes: CACHE.routes };
    }

    return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    };

    const supabaseHeaders = {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
    
    const supabaseUrl = env.SUPABASE_URL || "YOUR_SUPABASE_URL";
    const geminiKey = env.GEMINI_API_KEY || "YOUR_GEMINI_KEY";

    try {
      if (url.pathname === '/api/webhook/process_signal' && request.method === 'POST') {
        const payload = await request.json();
        const { text, chat_id, chat_title, message_id, reply_to_id } = payload;

        if (!text || !chat_id) {
            return new Response(JSON.stringify({ error: "Missing text or chat_id" }), { status: 400, headers: corsHeaders });
        }

        // =========================================================
        // INSTANT DUAL MEMORY DEDUPLICATION (ID + Normalized Text)
        // =========================================================
        cleanup_processed_messages();
        const normText = text.trim().toLowerCase().replace(/\s+/g, ' ');
        const idKey = message_id ? `id_${chat_id}_${message_id}` : null;
        const textKey = `text_${chat_id}_${normText}`;

        if ((idKey && PROCESSED_MESSAGES.has(idKey)) || PROCESSED_MESSAGES.has(textKey)) {
            return new Response(JSON.stringify({ status: "ignored", reason: "Duplicate message or text dropped instantly" }), { headers: corsHeaders });
        }

        const now = Date.now();
        if (idKey) PROCESSED_MESSAGES.set(idKey, now);
        PROCESSED_MESSAGES.set(textKey, now);

        // =========================================================
        // ATOMIC DATABASE PRE-RESERVATION LOCK (Prevents Parallel Races)
        // =========================================================
        if (message_id) {
            try {
                const lockCheckRes = await fetch(`${supabaseUrl}/rest/v1/message_map?source_chat_id=eq.${chat_id}&source_message_id=eq.${message_id}&select=id&limit=1`, { headers: supabaseHeaders });
                if (lockCheckRes.ok) {
                    const lockData = await lockCheckRes.json();
                    if (lockData.length > 0) {
                        return new Response(JSON.stringify({ status: "ignored", reason: "Already in database message_map or actively processing" }), { headers: corsHeaders });
                    }
                }

                // Reserve lock in DB immediately before running AI
                await fetch(`${supabaseUrl}/rest/v1/message_map`, {
                    method: 'POST',
                    headers: supabaseHeaders,
                    body: JSON.stringify({
                        source_chat_id: chat_id,
                        source_message_id: message_id,
                        dest_chat_id: "PENDING_LOCK",
                        dest_message_id: 0
                    })
                });
            } catch (e) {}
        }

        // 1. Load DB Config
        const dbConfig = await fetch_db_config_with_fallback(supabaseUrl, supabaseHeaders);
        if (!dbConfig) {
            if (idKey) PROCESSED_MESSAGES.delete(idKey);
            PROCESSED_MESSAGES.delete(textKey);
            return new Response(JSON.stringify({ error: "Failed to fetch DB config after retries" }), { status: 500, headers: corsHeaders });
        }

        const { settings, routes: all_routes } = dbConfig;

        // 2. Filter Active Routes and DEDUPLICATE DESTINATIONS
        const raw_routes = all_routes.filter(r => String(r.source_chat_id) === String(chat_id));
        if (raw_routes.length === 0) {
            return new Response(JSON.stringify({ status: "ignored", reason: "No active routes for source_chat_id " + chat_id }), { headers: corsHeaders });
        }

        const routes = [];
        const seenDestinations = new Set();
        for (let r of raw_routes) {
            const dest = String(r.destination_chat_id);
            if (!seenDestinations.has(dest)) {
                seenDestinations.add(dest);
                routes.push(r);
            }
        }

        const ai_prompt = settings.ai_prompt || "";
        const models = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gemini-3.5-pro"
        ];
        
        let parsed_signal = null;
        let is_fallback_mode = false;

        // Strip source handles/credits before sending to AI
        const sanitizedText = strip_source_credits(text);

        if (geminiKey && ai_prompt && sanitizedText) {
            const geminiPayload = {
                "contents": [{
                    "role": "user",
                    "parts": [{"text": `System Role & Directives:\n${ai_prompt}\n\nMessage to parse:\n"${sanitizedText}"`}]
                }],
                "systemInstruction": {
                    "parts": [{
                        "text": "CRITICAL MANDATE: Output ONLY the final clean HTML text or JSON object. DO NOT output any internal thinking process, draft reasoning (such as 'Wait, let's double check...'), markdown code blocks, or backticks. Start directly with <b> or {"
                    }]
                },
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 2048
                }
            };

            let gemini_success = false;

            for (let model of models) {
                if (gemini_success) break;
                const modelUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

                for (let attempt = 0; attempt < 2; attempt++) {
                    const timeout_seconds = attempt === 0 ? 8 : 12;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout_seconds * 1000);

                    try {
                        const resp = await fetch(modelUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(geminiPayload),
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);

                        if (resp.status === 200) {
                            const data = await resp.json();
                            if (data.candidates && data.candidates[0]?.content?.parts) {
                                const raw_content = data.candidates[0].content.parts[0].text;
                                const content = clean_ai_output(raw_content);
                                
                                let parsed = parse_json_safely(content);
                                if (parsed) {
                                    let tg_msg = clean_ai_output(parsed.telegram_message || '');
                                    if (is_response_complete(tg_msg)) {
                                        parsed.telegram_message = tg_msg;
                                        parsed_signal = parsed;
                                        gemini_success = true;
                                        break;
                                    }
                                } else {
                                    if (is_response_complete(content)) {
                                        parsed_signal = content;
                                        gemini_success = true;
                                        break;
                                    }
                                }
                            }
                        } else if ([404, 503, 429].includes(resp.status)) {
                            break;
                        }
                    } catch (e) {
                        clearTimeout(timeoutId);
                    }
                }
            }
        }

        // 4. ZERO-DROP DEEP RULE-BASED FALLBACK PARSER
        if (!parsed_signal) {
            console.warn("⚠️ All Gemini AI models failed or timed out. Engaging Deep Rule-Based Fallback!");
            is_fallback_mode = true;
            parsed_signal = format_fallback_signal(text);
        }

        let formatted_text = typeof parsed_signal === 'object' ? (parsed_signal.telegram_message || text) : parsed_signal;

        if (typeof parsed_signal === 'object') {
            let final_entry = parsed_signal.entry !== undefined && parsed_signal.entry !== null ? String(parsed_signal.entry) : 'CMP';
            formatted_text = formatted_text.replace(/{ENTRY_PRICE}/g, final_entry);
        }
        
        // Sanitize output, strip credits, and enforce strict double line spacing before TP1, SL, and footer
        formatted_text = clean_ai_output(formatted_text);
        formatted_text = strip_source_credits(formatted_text.replace(/\\n/g, '\n'));
        formatted_text = ensure_signal_spacing(formatted_text);

        const global_bot_token = settings.bot_token;

        // 5. Background Execution
        ctx.waitUntil((async () => {
            // A. Forward to Telegram Channels configured in routes
            for (let route of routes) {
                const bot_token = route.bot_token || global_bot_token;
                const dest_chat_id = route.destination_chat_id;

                if (bot_token && dest_chat_id) {
                    let reply_target = null;
                    if (reply_to_id) {
                        try {
                            const mapRes = await fetch(`${supabaseUrl}/rest/v1/message_map?source_message_id=eq.${reply_to_id}&dest_chat_id=eq.${dest_chat_id}&dest_message_id=gt.0`, { headers: supabaseHeaders });
                            if (mapRes.ok) {
                                const mapData = await mapRes.json();
                                if (mapData.length > 0) reply_target = mapData[0].dest_message_id;
                            }
                        } catch (e) {}
                    }

                    const tg_url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
                    let tg_payload = {
                        chat_id: dest_chat_id,
                        text: formatted_text,
                        parse_mode: "HTML"
                    };
                    if (reply_target) tg_payload.reply_to_message_id = reply_target;

                    let tg_delivered = false;
                    for (let tg_attempt = 1; tg_attempt <= 3; tg_attempt++) {
                        try {
                            let tgRes = await fetch(tg_url, { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify(tg_payload) });
                            let tgData = await tgRes.json();

                            if (!tgData.ok && tgData.error_code === 400 && tgData.description?.toLowerCase().includes("parse")) {
                                tg_payload.parse_mode = "";
                                tg_payload.text = formatted_text.replace(/<[^>]*>?/gm, '');
                                tgRes = await fetch(tg_url, { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify(tg_payload) });
                                tgData = await tgRes.json();
                            }

                            if (tgData.ok) {
                                tg_delivered = true;
                                try {
                                    // Upsert/Insert final delivered message mapping
                                    await fetch(`${supabaseUrl}/rest/v1/message_map`, {
                                        method: 'POST',
                                        headers: { ...supabaseHeaders, 'Prefer': 'resolution=merge-duplicates' },
                                        body: JSON.stringify({
                                            source_chat_id: chat_id,
                                            source_message_id: message_id,
                                            dest_chat_id: dest_chat_id,
                                            dest_message_id: tgData.result.message_id
                                        })
                                    });
                                } catch (e) {}
                                break;
                            }
                            if (tgData.error_code === 429) {
                                const retryAfter = (tgData.parameters?.retry_after || 2) * 1000;
                                await new Promise(r => setTimeout(r, retryAfter));
                            }
                        } catch (e) {
                            console.error(`Telegram attempt ${tg_attempt} failed:`, e);
                        }
                        if (!tg_delivered && tg_attempt < 3) await new Promise(r => setTimeout(r, 1000));
                    }
                }

                const wh_url = route.destination_webhook_url;
                if (wh_url) {
                    try {
                        await fetch(wh_url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                source_chat_id: chat_id,
                                message_id: message_id,
                                original_text: text,
                                signal: parsed_signal,
                                formatted_text: formatted_text
                            })
                        });
                    } catch (e) {}
                }
            }

            // B. Multi-Endpoint Global Webhooks (e.g. GLOBAL_WEBHOOK_URL, GLOBAL_WEBHOOK_URL_2, etc.)
            const global_webhooks = [
                env.GLOBAL_WEBHOOK_URL,
                env.GLOBAL_WEBHOOK_URL_2,
                env.GLOBAL_WEBHOOK_URL_3,
                env.GLOBAL_WEBHOOK_URL_4,
                env.GLOBAL_WEBHOOK_URL_5
            ].filter(Boolean);

            for (let g_wh of global_webhooks) {
                try {
                    await fetch(g_wh, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            source_chat_id: chat_id,
                            message_id: message_id,
                            original_text: text,
                            signal: parsed_signal,
                            formatted_text: formatted_text
                        })
                    });
                } catch (e) {}
            }

            // C. DB Log
            const db_log_payload = typeof parsed_signal === 'object' ? parsed_signal : { telegram_message: parsed_signal };
            try {
                await fetch(`${supabaseUrl}/rest/v1/signals_log`, {
                    method: 'POST',
                    headers: supabaseHeaders,
                    body: JSON.stringify({
                        source_chat_id: chat_id,
                        original_text: text,
                        parsed_json: db_log_payload,
                        status: is_fallback_mode ? "Processed (Zero-Drop Deep Fallback)" : "Processed by Cloudflare Worker"
                    })
                });
            } catch (e) {}
        })());

        return new Response(JSON.stringify({ 
            status: "success", 
            mode: is_fallback_mode ? 'fallback' : (typeof parsed_signal === 'object' ? 'json' : 'html') 
        }), { headers: corsHeaders });
      }

      // ==========================================
      // ADMIN DASHBOARD API
      // ==========================================
      if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
        const res = await fetch(`${supabaseUrl}/rest/v1/settings?select=*`, { headers: supabaseHeaders });
        return new Response(await res.text(), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
        const body = await request.json();
        const res = await fetch(`${supabaseUrl}/rest/v1/settings?on_conflict=key`, {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(body)
        });
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/routes' && request.method === 'GET') {
        const res = await fetch(`${supabaseUrl}/rest/v1/routes?select=*&order=created_at.desc`, { headers: supabaseHeaders });
        return new Response(await res.text(), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/routes' && request.method === 'POST') {
        const body = await request.text();
        const res = await fetch(`${supabaseUrl}/rest/v1/routes`, {
          method: 'POST',
          headers: supabaseHeaders,
          body
        });
        return new Response(await res.text(), { headers: corsHeaders });
      }

      if (url.pathname.startsWith('/api/admin/routes/') && request.method === 'DELETE') {
        const id = url.pathname.split('/').pop();
        await fetch(`${supabaseUrl}/rest/v1/routes?id=eq.${id}`, {
          method: 'DELETE',
          headers: supabaseHeaders
        });
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/templates' && request.method === 'GET') {
        const res = await fetch(`${supabaseUrl}/rest/v1/templates?select=*`, { headers: supabaseHeaders });
        return new Response(await res.text(), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/templates' && request.method === 'POST') {
        const { id, format } = await request.json();
        let res;
        if (id) {
          res = await fetch(`${supabaseUrl}/rest/v1/templates?id=eq.${id}`, {
            method: 'PATCH',
            headers: supabaseHeaders,
            body: JSON.stringify({ format })
          });
        } else {
          res = await fetch(`${supabaseUrl}/rest/v1/templates`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify({ name: 'Default', format })
          });
        }
        return new Response(await res.text(), { headers: corsHeaders });
      }

      if (url.pathname === '/api/admin/signals' && request.method === 'GET') {
        const res = await fetch(`${supabaseUrl}/rest/v1/signals_log?select=*&order=created_at.desc&limit=50`, { headers: supabaseHeaders });
        return new Response(await res.text(), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Endpoint Not Found" }), { status: 404, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};
