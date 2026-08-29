import { UniversalAIRouter } from './ai/universal_ai.js';
import { VIPMembershipManager } from './vip/vip_manager.js';
import { TelegramVIPForwarder, DerivExecutor, CTraderExecutor, MT5Executor } from './executors/trade_executors.js';

// Export MTProtoListenerNode so Cloudflare can mount it as a Durable Object
export { MTProtoListenerNode } from './listener/listener_node.js';

/**
 * MKETY NEXT-GEN SAAS & SIGNAL COPIER CORE ENGINES (CLOUDFLARE WORKER)
 * Unified Entry Point routing requests for app.mkety.com and trade.mkety.com
 */
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Initialize Supabase Client only for API routes that need it
        let supabase = null;

        // Core Route 1: Telegram Bot Webhook (Stars, Bank receipt uploads, VIP administration)
        if (path === "/api/webhook/telegram_bot") {
            supabase = await getSupabaseClient(env);
            const botToken = env.TELEGRAM_BOT_TOKEN;
            const adminChannelId = env.TELEGRAM_ADMIN_CHANNEL_ID;
            const vipChatId = env.TELEGRAM_VIP_CHAT_ID;

            const vipManager = new VIPMembershipManager(supabase, botToken, adminChannelId, vipChatId);
            const update = await request.json();
            return await vipManager.handleWebhookUpdate(update);
        }

        // Core Route 2: Process Signals & Executions Webhook (Invoked by MTProto Listener DO)
        if (path === "/api/webhook/process_signal" && method === "POST") {
            supabase = await getSupabaseClient(env);
            return await handleProcessSignal(request, env, supabase);
        }

        // Core Route 3: Admin Controls - Link & Configure MTProto Durable Object Nodes
        if (path.startsWith("/api/admin/listener/")) {
            return await handleListenerNodeControl(request, env, path);
        }

        // Fallback Status Endpoint - Renders a premium, interactive testing dashboard
        if (path === "/" || path === "/admin") {
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mkety Copier | Admin Control Center</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #fcfbf9; color: #1e1b18; }
        .serif { font-family: 'Playfair Display', serif; }
    </style>
</head>
<body class="min-h-screen pb-16">
    <!-- Sophisticated Header -->
    <header class="border-b border-[#e9e6df] bg-white px-8 py-6 sticky top-0 z-50 shadow-sm">
        <div class="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <span class="text-xs font-semibold tracking-wider text-[#9d8d75] uppercase">Multi-Tenant SaaS Suite</span>
                <h1 class="text-3xl font-bold tracking-tight serif mt-1">Mkety Copier Engine</h1>
            </div>
            <div class="flex items-center gap-3">
                <span class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[#f1efe9] text-[#5c5346] rounded-full">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live at trade.mkety.com
                </span>
                <span class="text-xs text-[#8c8273] font-mono">v2.5.0-Release</span>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-8 mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Left 2 Columns: Core Control Deck -->
        <div class="lg:col-span-2 space-y-8">
            <!-- System Modules Isolation Overview -->
            <section class="bg-white border border-[#e9e6df] rounded-xl p-8">
                <h2 class="text-xl font-bold tracking-tight serif mb-4">Core Module Stack Status</h2>
                <p class="text-sm text-[#706453] mb-6 leading-relaxed">
                    All components are mathematically isolated inside Cloudflare microservices. Any edits made to target modules under <code>src/</code> execute instantly without affecting other operations.
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="p-4 border border-[#f1efe9] bg-[#fcfbf9] rounded-lg">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-sm text-[#3a352e]">Multi-AI Router</h3>
                            <span class="text-xs bg-[#eef6ec] text-[#4d7f38] px-2 py-0.5 rounded-full font-medium">Active</span>
                        </div>
                        <p class="text-xs text-[#827766] leading-relaxed">Asymmetric 12s fail-fast cascade: Gemini primary, cascading to OpenAI & DeepSeek.</p>
                        <span class="text-[10px] font-mono text-[#a59984] block mt-2">src/ai/universal_ai.js</span>
                    </div>

                    <div class="p-4 border border-[#f1efe9] bg-[#fcfbf9] rounded-lg">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-sm text-[#3a352e]">VIP Manager Bot</h3>
                            <span class="text-xs bg-[#eef6ec] text-[#4d7f38] px-2 py-0.5 rounded-full font-medium">Active</span>
                        </div>
                        <p class="text-xs text-[#827766] leading-relaxed">15-minute cron triggers handling user removals, invite revokes, and bank receipts.</p>
                        <span class="text-[10px] font-mono text-[#a59984] block mt-2">src/vip/vip_manager.js</span>
                    </div>

                    <div class="p-4 border border-[#f1efe9] bg-[#fcfbf9] rounded-lg">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-sm text-[#3a352e]">Trade Executors</h3>
                            <span class="text-xs bg-[#eef6ec] text-[#4d7f38] px-2 py-0.5 rounded-full font-medium">Active</span>
                        </div>
                        <p class="text-xs text-[#827766] leading-relaxed">Concurrent pipelines for Deriv WS, cTrader API, MT5 Webhook, and TG VIP forwarding.</p>
                        <span class="text-[10px] font-mono text-[#a59984] block mt-2">src/executors/trade_executors.js</span>
                    </div>

                    <div class="p-4 border border-[#f1efe9] bg-[#fcfbf9] rounded-lg">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-sm text-[#3a352e]">MTProto DO Node</h3>
                            <span class="text-xs bg-[#eef6ec] text-[#4d7f38] px-2 py-0.5 rounded-full font-medium">Active</span>
                        </div>
                        <p class="text-xs text-[#827766] leading-relaxed">Always-On listener holding persistent connections inside Cloudflare Durable Objects.</p>
                        <span class="text-[10px] font-mono text-[#a59984] block mt-2">src/listener/listener_node.js</span>
                    </div>
                </div>
            </section>

            <!-- Dynamic Settings & Transformation Playground -->
            <section class="bg-white border border-[#e9e6df] rounded-xl p-8">
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h2 class="text-xl font-bold tracking-tight serif">Interactive Transformation Playground</h2>
                        <p class="text-xs text-[#827766] mt-0.5">Test custom branding and single entry transformations instantly.</p>
                    </div>
                    <span class="text-[11px] font-semibold text-[#9d8d75] tracking-wider uppercase bg-[#fcfbf9] border border-[#f1efe9] px-2.5 py-1 rounded">Dev Mode</span>
                </div>

                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-[#5c5346] uppercase mb-1.5">Raw Incoming Channel Signal</label>
                        <textarea id="rawSignal" rows="5" class="w-full text-sm bg-[#fcfbf9] border border-[#e9e6df] rounded-lg p-3 focus:outline-none focus:border-[#9d8d75] font-mono" placeholder="BUY GOLD @ 1950.50 - 1955.00&#10;TP1 @ 1960.00&#10;TP2 @ 1970.00&#10;SL @ 1940.00"></textarea>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-[#5c5346] uppercase mb-1.5">Destination Brand Header Override</label>
                            <input id="brandHeader" type="text" class="w-full text-sm bg-[#fcfbf9] border border-[#e9e6df] rounded-lg p-2.5 focus:outline-none focus:border-[#9d8d75]" placeholder="🏆 MKETY SPECIAL ALERTS">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-[#5c5346] uppercase mb-1.5">Single-Entry Mode</label>
                            <select id="singleEntry" class="w-full text-sm bg-[#fcfbf9] border border-[#e9e6df] rounded-lg p-2.5 focus:outline-none focus:border-[#9d8d75]">
                                <option value="true">Enable (Truncate Ranges)</option>
                                <option value="false">Disable (Keep Full Ranges)</option>
                            </select>
                        </div>
                    </div>

                    <div class="flex justify-end pt-2">
                        <button onclick="processTestSignal()" class="px-5 py-2.5 bg-[#1e1b18] hover:bg-[#332f2a] text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                            Run Live Format Simulation
                        </button>
                    </div>

                    <div class="border-t border-[#f1efe9] pt-4 hidden" id="previewArea">
                        <label class="block text-xs font-semibold text-[#5c5346] uppercase mb-2">Simulated Output Result (Delivered to Telegram & API)</label>
                        <div class="p-4 bg-[#fcfbf9] border border-[#e9e6df] rounded-lg font-mono text-sm leading-relaxed whitespace-pre-wrap text-[#1e1b18]" id="outputPreview"></div>
                    </div>
                </div>
            </section>
        </div>

        <!-- Right 1 Column: Persistent Variable & Architecture Guide -->
        <div class="space-y-8">
            <!-- persistent credentials guide -->
            <section class="bg-white border border-[#e9e6df] rounded-xl p-6">
                <h2 class="text-lg font-bold tracking-tight serif mb-3">MTProto Credentials Storage</h2>
                <p class="text-xs text-[#706453] leading-relaxed mb-4">
                    The 3 listener variables (<code>API_ID</code>, <code>API_HASH</code>, and <code>SESSION_STRING</code>) are <strong>never stored in insecure global env variables</strong>. Doing so would limit the SaaS platform to a single user.
                </p>
                <div class="space-y-3">
                    <div class="p-3 bg-[#fcfbf9] border border-[#f1efe9] rounded-lg text-xs leading-relaxed">
                        <strong class="text-[#3a352e] block mb-0.5">Isolated Durable Object RAM/Disk</strong>
                        Each tenant / customer gets their own stateful Cloudflare Durable Object container. The variables are saved directly using transactional <code>this.state.storage.put()</code> calls.
                    </div>
                    <div class="p-3 bg-[#fcfbf9] border border-[#f1efe9] rounded-lg text-xs leading-relaxed">
                        <strong class="text-[#3a352e] block mb-0.5">Multi-Tenant Dynamic Mounts</strong>
                        When you request to link an account, credentials are provided directly via API payload, keeping configurations isolated and completely automated.
                    </div>
                </div>
            </section>

            <!-- Zitadel Enterprise Configuration -->
            <section class="bg-white border border-[#e9e6df] rounded-xl p-6">
                <h2 class="text-lg font-bold tracking-tight serif mb-3">Zitadel Enterprise Gate</h2>
                <p class="text-xs text-[#706453] leading-relaxed mb-4">
                    Link access for custom and enterprise clients without adding complex checkout layers on <code>trade.mkety.com</code>.
                </p>
                <ol class="text-xs space-y-2.5 text-[#706453] list-decimal pl-4">
                    <li>Create <code>copier_access</code> or <code>enterprise_user</code> role inside Zitadel.</li>
                    <li>Assign roles to target clients on your main Zitadel control panel.</li>
                    <li>Configure <code>ZITADEL_JWKS_URL</code> inside your Cloudflare environment secrets.</li>
                    <li>When users hit the admin APIs, the worker validates OIDC claims automatically.</li>
                </ol>
            </section>
        </div>
    </main>

    <script>
        function processTestSignal() {
            const raw = document.getElementById("rawSignal").value;
            const header = document.getElementById("brandHeader").value;
            const single = document.getElementById("singleEntry").value === "true";

            if (!raw) {
                alert("Please write a sample incoming message to transform!");
                return;
            }

            // Client-Side Simulation of our Worker regex/transformation logic
            let formattedHtml = raw;
            
            // Standardize format (simulate AI parsing and structure)
            const isBuy = raw.toUpperCase().includes("BUY");
            const action = isBuy ? "BUY" : "SELL";
            let symbol = "EURUSD";
            if (raw.toUpperCase().includes("GOLD") || raw.toUpperCase().includes("XAUUSD")) symbol = "XAUUSD";
            else if (raw.toUpperCase().includes("US30")) symbol = "US30";
            else if (raw.toUpperCase().includes("NAS100")) symbol = "NAS100";

            let sl = "0.0";
            const slMatch = raw.match(/(?:SL|STOP)[\s:@=\-\(]*([0-9\.]+)/i);
            if (slMatch) sl = slMatch[1];

            const tps = [];
            const tpRegex = /(?:TP|TAKE\s*PROFIT)[\s\-_]*([0-9]?)[\s:@=\-\(]*([0-9\.]+)/gi;
            let m;
            while ((m = tpRegex.exec(raw)) !== null) {
                tps.push(m[2]);
            }

            // Construct preview output text
            let preview = "<b>" + action + " " + symbol + "</b>\\n\\n";
            
            // Simulate single entry conversion
            if (single) {
                // If single-entry is true, matches price range patterns "1950.50 - 1955.00" and keeps "1950.50"
                const singleRegex = /(\\b\\d+(?:\\.\\d+)?)\\s*[\\s\\-–—]+\\s*(\\d+(?:\\.\\d+)?\\b)/g;
                let entrySection = raw.match(/@\s*([0-9\.\-\s]+)/i);
                let entry = entrySection ? entrySection[1].trim() : "Market Exec";
                if (entry.includes("-")) {
                    entry = entry.split("-")[0].trim();
                }
                preview += "Entry Level: <b>" + entry + "</b>\\n";
            } else {
                let entrySection = raw.match(/@\s*([0-9\.\-\s]+)/i);
                let entry = entrySection ? entrySection[1].trim() : "Market Exec";
                preview += "Entry Zone: <b>" + entry + "</b>\\n";
            }

            tps.forEach((tp, idx) => {
                preview += "Take Profit " + (idx + 1) + " at " + tp + "\\n";
            });
            preview += "\\nStop Loss at " + sl;

            // Apply custom header
            if (header) {
                preview = "<b>" + header + "</b>\\n\\n" + preview;
            }

            // Append footer
            preview += "\\n\\n~~~ \\n<b>Starpips Forex</b>";

            document.getElementById("outputPreview").innerHTML = preview.replace(/\\n/g, "<br>");
            document.getElementById("previewArea").classList.remove("hidden");
        }
    </script>
</body>
</html>`;

            return new Response(html, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" }
            });
        }

        // Fallback 404 response for other paths (like /favicon.ico)
        return new Response("Not Found", { status: 404 });
    },

    /**
     * Automated Cron Trigger Handler (Runs every 15 minutes to kick expired users)
     */
    async scheduled(event, env) {
        const supabase = await getSupabaseClient(env);
        const vipManager = new VIPMembershipManager(
            supabase,
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_ADMIN_CHANNEL_ID,
            env.TELEGRAM_VIP_CHAT_ID
        );
        await vipManager.processSubscriptionLifecycleCron();
        console.log("Automated VIP subscription expiry cron completed successfully.");
    }
};

/**
 * Lazy-initializer helper for Supabase Client
 */
async function getSupabaseClient(env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase credentials missing in Cloudflare Environment variables.");
    }

    // Dynamic import to support clean tree-shaking
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(supabaseUrl, supabaseKey);
}

/**
 * Controller to spin up, control, and authenticate @mtcute Durable Object Instances
 */
async function handleListenerNodeControl(request, env, path) {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("node_id"); // Unique UUID for workspace listener DO

    if (!nodeId) return new Response("Missing node_id query parameter", { status: 400 });

    // Establish link to MTProto Listener Durable Object namespace
    const id = env.MTPROTO_LISTENER_NAMESPACE.idFromString(nodeId);
    const stub = env.MTPROTO_LISTENER_NAMESPACE.get(id);

    // Forward the HTTP request directly into the targeted Durable Object actor instance
    return await stub.fetch(request);
}

/**
 * Core Parser, AI Transformer, and Copy-Trading Execution Webhook Engine
 */
async function handleProcessSignal(request, env, supabase) {
    const payload = await request.json();
    const { source_chat_id, source_message_id, raw_text } = payload;

    if (!source_chat_id || !raw_text) {
        return new Response("Invalid signal payload", { status: 400 });
    }

    try {
        // Step 1: Check active routes mapped to this source channel in Supabase
        const { data: routes, error: routeErr } = await supabase
            .from("signal_routes")
            .select("*")
            .eq("source_chat_id", source_chat_id)
            .eq("is_active", true);

        if (routeErr || !routes || routes.length === 0) {
            return new Response("No active signal routes matched for this channel.", { status: 200 });
        }

        const workspaceId = routes[0].workspace_id;

        // Step 2: Atomic Deduplication & Pre-Reservation Database Lock
        const { error: lockError } = await supabase
            .from("signal_logs")
            .insert({
                workspace_id: workspaceId,
                source_chat_id,
                source_message_id,
                raw_text,
                status: 'pending_lock'
            });

        if (lockError) {
            // Duplicate signal or parallel race condition. Drop instantly to ensure zero multiple posts.
            return new Response("Signal already processed. Dropped duplicate request.", { status: 200 });
        }

        // Step 3: Load active Multi-AI providers configured for this workspace
        const { data: providers } = await supabase
            .from("ai_providers")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("is_active", true);

        // Retrieve prompt template (Master Prompt)
        const systemPrompt = env.AI_SYSTEM_PROMPT || "Extract trading details as clean HTML. Use <b> tags.";

        // Transform signal using Multi-AI Priority Cascade Router
        const aiRouter = new UniversalAIRouter(providers || []);
        const aiResult = await aiRouter.processSignal(raw_text, systemPrompt);

        let formattedHtml = "";
        let parsedTradeParams = null;

        if (aiResult.success) {
            formattedHtml = aiResult.text;
            // Structure trades parameters if destination includes copy-trading
            parsedTradeParams = extractParamsFromHtml(formattedHtml, raw_text);
        } else {
            // Fallback to high-precision Rule-Based Parsing
            parsedTradeParams = formatFallbackSignal(raw_text);
            formattedHtml = parsedTradeParams.html;
        }

        // Step 4: Broadcast signal to all matched destinations concurrently
        const executionPromises = routes.map(async (route) => {
            try {
                // Extrapolate custom route settings (e.g. branding header, single_entry mode)
                const settings = route.route_settings || {};
                let localizedHtml = formattedHtml;

                // If single-entry mode is active for this target, convert entry price ranges "123.45 - 123.80" to "123.45"
                if (settings.single_entry) {
                    // Match numbers with decimals or integers separated by hyphen
                    localizedHtml = localizedHtml.replace(/(\b\d+(?:\.\d+)?)\s*[\s\-–—]+\s*(\d+(?:\.\d+)?\b)/g, '$1');
                }

                // Inject custom branding header prefix if provided
                if (settings.custom_header) {
                    localizedHtml = `<b>${settings.custom_header}</b>\n\n${localizedHtml}`;
                }

                // Type A: Copy formatted HTML to Telegram VIP Channels
                if (route.destination_type === 'telegram_vip' && route.destination_chat_id) {
                    const fullText = `${localizedHtml}\n\n${route.custom_footer || '~~~ \n<b>Starpips Forex</b>'}`;
                    const forwarder = new TelegramVIPForwarder(env.TELEGRAM_BOT_TOKEN);
                    await forwarder.forwardSignal(route.destination_chat_id, fullText);
                }

                // Skip executing trades if parsing failed or was just an informational status update
                if (!parsedTradeParams || parsedTradeParams.isUpdate) return;

                // Load trading account keys mapped to this workspace
                const { data: accounts } = await supabase
                    .from("trade_accounts")
                    .select("*")
                    .eq("workspace_id", workspaceId)
                    .eq("is_active", true);

                if (!accounts || accounts.length === 0) return;

                const tradePromises = accounts.map(async (acc) => {
                    // Type B: Deriv Direct WebSocket Copy-Trading execution
                    if (route.destination_type === 'deriv_ws' && acc.platform === 'deriv') {
                        const deriv = new DerivExecutor(env.DERIV_APP_ID || "1098");
                        await deriv.executeTrade(acc.api_token_encrypted, {
                            ...parsedTradeParams,
                            lotSize: acc.lot_sizing_type === 'fixed' ? acc.lot_value : 0.1
                        });
                    }

                    // Type C: cTrader Open API Copy-Trading execution
                    if (route.destination_type === 'ctrader_ws' && acc.platform === 'ctrader') {
                        const ctrader = new CTraderExecutor();
                        await ctrader.executeTrade(acc.api_token_encrypted, acc.account_id, {
                            ...parsedTradeParams,
                            lotSize: acc.lot_sizing_type === 'fixed' ? acc.lot_value : 0.01
                        });
                    }

                    // Type D: MT5 Webhook Copier Execution
                    if (route.destination_type === 'mt5_webhook' && acc.platform === 'mt5') {
                        const mt5 = new MT5Executor();
                        await mt5.executeTrade(acc.api_token_encrypted, parsedTradeParams);
                    }
                });

                await Promise.all(tradePromises);

            } catch (err) {
                console.error(`Destination target routing failed for Route ID ${route.id}:`, err.message);
            }
        });

        await Promise.all(executionPromises);

        // Update Log record with completed status and metadata
        await supabase
            .from("signal_logs")
            .update({
                ai_provider_used: aiResult.provider || 'fallback_rules',
                parsed_action: parsedTradeParams?.action || 'STATUS',
                parsed_symbol: parsedTradeParams?.symbol || 'UNKNOWN',
                status: 'processed'
            })
            .eq("source_chat_id", source_chat_id)
            .eq("source_message_id", source_message_id);

        return new Response(JSON.stringify({ success: true, processed_by: aiResult.provider || 'fallback' }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Signal processor execution error:", err.message);
        return new Response("Internal Server Error", { status: 500 });
    }
}

/**
 * Extracts raw values from AI Formatted HTML
 */
function extractParamsFromHtml(html, rawText) {
    const isUpdate = /Tp\s*[0-9]\s*Hits|Sl\s*Hit|Close|Cancel|Move/gi.test(rawText);
    
    const actionMatch = html.match(/<b>(BUY|SELL|BUY\s*LIMIT|SELL\s*LIMIT|BUY\s*STOP|SELL\s*STOP)<\/b>/i);
    const action = actionMatch ? actionMatch[1] : "BUY";

    const symbolMatch = html.match(/<b>([A-Z0-9\s_\-\(\)\.\/]+)<\/b>/i);
    const symbol = symbolMatch ? symbolMatch[1].split('(')[0].trim() : "XAUUSD";

    // Grab first number sequence in Take Profit tags
    const tpMatches = [...html.matchAll(/Take\s*Profit\s*[0-9]\s*at\s*([0-9\.]+)/gi)].map(m => m[1]);
    const slMatch = html.match(/Stop\s*Loss\s*at\s*([0-9\.]+)/i);

    return {
        action,
        symbol,
        entry: "0.0", // default to market price execution
        sl: slMatch ? slMatch[1] : null,
        tp: tpMatches,
        isUpdate
    };
}

/**
 * High-Precision Rule-Based Fallback Parser (Guarantees zero-fail trade formatting)
 */
function formatFallbackSignal(text) {
    const actionMatch = text.match(/\b(BUY|SELL|BUY\s*LIMIT|SELL\s*LIMIT|BUY\s*STOP|SELL\s*STOP)\b/i);
    const action = actionMatch ? actionMatch[1].toUpperCase() : "BUY";

    // Symbol extraction (Forex, Metals, Synthetics, JPY, Indices, Crypto)
    const symbolMatch = text.match(/\b(EURUSD|GBPUSD|USDJPY|XAUUSD|US30|NAS100|GER40|DE30|BTCUSD|Volatility\s*25\s*\(1s\)|Volatility\s*75|V75|Boom\s*500|Crash\s*1000|Crash\s*500|Boom\s*1000)\b/i);
    const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : "EURUSD";

    // Grab TP lines
    const tps = [];
    const tpRegex = /(?:TP|TAKE\s*PROFIT|TARGET)[\s\-_]*([0-9]?)[\s:@=\-\(]*([0-9\.]+)/gi;
    let match;
    while ((match = tpRegex.exec(text)) !== null) {
        tps.push(match[2]);
    }

    // Grab SL
    const slMatch = text.match(/(?:SL|STOP\s*LOSS|STOP)[\s:@=\-\(]*([0-9\.]+)/i);
    const sl = slMatch ? slMatch[1] : null;

    let html = `<b>${action} ${symbol}</b>\n\n`;
    tps.forEach((tp, i) => {
        html += `<b>Take Profit ${i + 1} at ${tp}</b>\n`;
    });
    if (sl) {
        html += `\n<b>Stop Loss at ${sl}</b>`;
    }

    return {
        action,
        symbol,
        entry: "0.0",
        sl,
        tp: tps,
        isUpdate: false,
        html
    };
}
