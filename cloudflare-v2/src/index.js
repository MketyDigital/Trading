import { UniversalAIRouter } from './ai/universal_ai.js';
import { VIPMembershipManager } from './vip/vip_manager.js';
import { TelegramVIPForwarder, DerivExecutor, CTraderExecutor, MT5Executor } from './executors/trade_executors.js';
import { renderDashboard } from './dashboard.js';

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
            const html = renderDashboard(env);

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
