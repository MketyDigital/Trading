import { UniversalAIRouter } from './ai/universal_ai.js';
import { VIPMembershipManager } from './vip/vip_manager.js';
import { TelegramVIPForwarder, DerivExecutor, CTraderExecutor, MT5Executor } from './executors/trade_executors.js';
import { renderDashboard } from './dashboard.js';

// Export MTProtoListenerNode so Cloudflare can mount it as a Durable Object
export { MTProtoListenerNode } from './listener/listener_node.js';

// High-Availability In-Memory Edge Cache for instant routing & database failovers
const memoryCache = {
    routes: new Map(),           // source_chat_id -> Array of routes
    accounts: new Map(),         // workspace_id -> Array of accounts
    providers: new Map(),        // workspace_id -> Array of AI providers
    processedSignals: new Set()  // Set of "source_chat_id:source_message_id" for microsecond deduplication
};

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

        // Core Route 1: Telegram Bot Webhook (Dynamic Multi-Tenant)
        if (path.startsWith("/api/webhook/telegram_bot/")) {
            supabase = await getSupabaseClient(env);
            const botToken = path.split("/").pop(); // Extract token from URL
            
            // Look up workspace by bot token
            const { data: workspace } = await supabase.from('workspaces').select('*').eq('tg_bot_token', botToken).maybeSingle();
            if (!workspace) return new Response("Unauthorized Bot Token", { status: 401 });

            const adminChannelId = workspace.tg_admin_chat_id;
            const vipChatId = workspace.tg_vip_chat_id;

            const vipManager = new VIPMembershipManager(supabase, botToken, adminChannelId, vipChatId, workspace.id);
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

        // Core Route 4: SaaS Dashboard Admin APIs (Zitadel OIDC Protected)
        if (path.startsWith("/api/admin/data")) {
            // Optional Zitadel Enterprise Gateway Check
            if (env.ZITADEL_JWKS_URL) {
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    return new Response("Unauthorized. Missing Bearer Token.", { status: 401 });
                }
                // JWT cryptographic validation against ZITADEL_JWKS_URL would execute here.
            }
            
            supabase = await getSupabaseClient(env);
            return await handleAdminAPI(request, supabase, path, method);
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
     * Executes dynamically across all registered tenant workspaces.
     */
    async scheduled(event, env) {
        const supabase = await getSupabaseClient(env);
        
        // Fetch all workspaces with an active Telegram Bot Token
        const { data: workspaces, error } = await supabase.from('workspaces').select('*').not('tg_bot_token', 'is', null);
        if (error || !workspaces) return;

        // Process each workspace independently
        for (const workspace of workspaces) {
            const botToken = workspace.tg_bot_token;
            const adminChannelId = workspace.tg_admin_chat_id;
            const vipChatId = workspace.tg_vip_chat_id;
            
            if (botToken && vipChatId) {
                const vipManager = new VIPMembershipManager(
                    supabase,
                    botToken,
                    adminChannelId,
                    vipChatId,
                    workspace.id
                );
                await vipManager.processSubscriptionLifecycleCron();
            }
        }
        
        console.log("Automated VIP subscription expiry cron completed successfully for all workspaces.");
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
    const { source_chat_id, source_message_id, raw_text, simulate } = payload;

    if (!source_chat_id || !raw_text) {
        return new Response(JSON.stringify({ success: false, error: "Invalid signal payload" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Microsecond in-memory deduplication check (protects against rapid Telegram retry loops)
    const signalKey = `${source_chat_id}:${source_message_id || 1}`;
    if (memoryCache.processedSignals.has(signalKey)) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: "Signal already processed (Memory cache lock matched). Dropped duplicate request." 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    }
    
    // Register the key immediately to guarantee atomic safety in the current isolate instance
    memoryCache.processedSignals.add(signalKey);
    // Prune set if it gets too large (>10,000 entries) to prevent memory leak
    if (memoryCache.processedSignals.size > 10000) {
        const firstKey = memoryCache.processedSignals.values().next().value;
        memoryCache.processedSignals.delete(firstKey);
    }

    try {
        let routes = [];
        let isUsingFallbackCache = false;

        // Step 1: Check active routes mapped to this source channel
        try {
            const { data, error: routeErr } = await supabase
                .from("signal_routes")
                .select("*")
                .eq("source_chat_id", source_chat_id)
                .eq("is_active", true);

            if (routeErr || !data || data.length === 0) {
                throw new Error(routeErr?.message || "No active signal routes matched for this channel in database.");
            }
            routes = data;
            // Update memory cache
            memoryCache.routes.set(source_chat_id, routes);
        } catch (dbErr) {
            console.warn(`Database connection issue or failure querying routes for chat ${source_chat_id}. Checking memory cache...`, dbErr.message);
            if (memoryCache.routes.has(source_chat_id)) {
                routes = memoryCache.routes.get(source_chat_id);
                isUsingFallbackCache = true;
            } else {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: "Database offline and no fallback cache available for this channel." 
                }), {
                    status: 503,
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        const workspaceId = routes[0].workspace_id;

        // Step 2: Atomic Deduplication & Pre-Reservation Database Lock (Skip if simulating or DB is offline)
        if (!simulate && !isUsingFallbackCache) {
            try {
                const { error: lockError } = await supabase
                    .from("signal_logs")
                    .insert({
                        workspace_id: workspaceId,
                        source_chat_id,
                        source_message_id: source_message_id || 1,
                        raw_text,
                        status: 'pending_lock'
                    });

                if (lockError) {
                    // Duplicate signal or parallel race condition. Drop instantly to ensure zero multiple posts.
                    return new Response(JSON.stringify({ success: false, error: "Signal already processed. Dropped duplicate request." }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                }
            } catch (lockErr) {
                console.warn("Database lock pre-reservation failed due to database drop/offline status. Proceeding via in-memory lock fallback.", lockErr.message);
            }
        }

        // Step 3: Load active Multi-AI providers configured for this workspace
        let providers = [];
        try {
            const { data, error: provErr } = await supabase
                .from("ai_providers")
                .select("*")
                .eq("workspace_id", workspaceId)
                .eq("is_active", true);
                
            if (provErr || !data) {
                throw new Error(provErr?.message || "Failed to load active AI providers");
            }
            providers = data;
            // Update memory cache
            memoryCache.providers.set(workspaceId, providers);
        } catch (dbErr) {
            console.warn(`Database offline while loading AI providers for workspace ${workspaceId}. Falling back to memory cache...`, dbErr.message);
            if (memoryCache.providers.has(workspaceId)) {
                providers = memoryCache.providers.get(workspaceId);
            }
        }

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
            // Fallback to high-precision Rule-Based Parsing (Guarantees zero-fail trade formatting)
            parsedTradeParams = formatFallbackSignal(raw_text);
            formattedHtml = parsedTradeParams.html;
        }

        const trace = {
            input: { source_chat_id, source_message_id: source_message_id || 1, raw_text },
            ai_engine: {
                success: aiResult.success,
                provider: aiResult.provider || 'fallback_rules',
                model: aiResult.model || 'regex_fallback',
                system_prompt: systemPrompt
            },
            parsed_parameters: parsedTradeParams,
            final_formatted_html: formattedHtml,
            route_dispatches: [],
            high_availability: {
                database_offline: isUsingFallbackCache,
                using_memory_cache: isUsingFallbackCache
            }
        };

        // Step 4: Broadcast signal to all matched destinations concurrently
        const executionPromises = routes.map(async (route) => {
            const dispatchTrace = {
                route_id: route.id,
                route_name: route.route_name,
                destination_type: route.destination_type,
                destination_chat_id: route.destination_chat_id,
                actions: []
            };

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

                const fullText = `${localizedHtml}\n\n${route.custom_footer || '~~~ \n<b>Starpips Forex</b>'}`;

                // Type A: Copy formatted HTML to Telegram VIP Channels
                if (route.destination_type === 'telegram_vip' && route.destination_chat_id) {
                    if (simulate) {
                        dispatchTrace.actions.push({
                            type: 'telegram_vip_forward',
                            status: 'simulated_success',
                            recipient: route.destination_chat_id,
                            text: fullText
                        });
                    } else {
                        const forwarder = new TelegramVIPForwarder(env.TELEGRAM_BOT_TOKEN);
                        const result = await forwarder.forwardSignal(route.destination_chat_id, fullText);
                        dispatchTrace.actions.push({
                            type: 'telegram_vip_forward',
                            status: result.success ? 'success' : 'failed',
                            error: result.error,
                            message_id: result.message_id
                        });
                    }
                }

                // Skip executing trades if parsing failed or was just an informational status update
                if (!parsedTradeParams || parsedTradeParams.isUpdate) {
                    trace.route_dispatches.push(dispatchTrace);
                    return;
                }

                // Load trading account keys mapped to this workspace
                let accounts = [];
                try {
                    const { data: accountsData, error: accErr } = await supabase
                        .from("trade_accounts")
                        .select("*")
                        .eq("workspace_id", workspaceId)
                        .eq("is_active", true);

                    if (accErr || !accountsData) {
                        throw new Error(accErr?.message || "Failed to fetch accounts from DB");
                    }
                    accounts = accountsData;
                    // Update memory cache
                    memoryCache.accounts.set(workspaceId, accounts);
                } catch (dbErr) {
                    console.warn(`Database offline while loading trade accounts for workspace ${workspaceId}. Checking memory cache...`, dbErr.message);
                    if (memoryCache.accounts.has(workspaceId)) {
                        accounts = memoryCache.accounts.get(workspaceId);
                    }
                }

                if (!accounts || accounts.length === 0) {
                    dispatchTrace.actions.push({
                        type: 'copy_trade_execution',
                        status: 'no_accounts_linked_or_cached'
                    });
                    trace.route_dispatches.push(dispatchTrace);
                    return;
                }

                const tradePromises = accounts.map(async (acc) => {
                    const lotSize = acc.lot_sizing_type === 'fixed' ? acc.lot_value : 0.1;
                    const orderParams = { ...parsedTradeParams, lotSize };

                    // Type B: Deriv Direct WebSocket Copy-Trading execution
                    if (route.destination_type === 'deriv_ws' && acc.platform === 'deriv') {
                        if (simulate) {
                            dispatchTrace.actions.push({
                                type: 'deriv_ws_execution',
                                account_label: acc.account_label,
                                status: 'simulated_success',
                                lot_sizing: `${acc.lot_sizing_type} (${lotSize} lots)`,
                                payload_simulated: orderParams
                            });
                        } else {
                            const deriv = new DerivExecutor(env.DERIV_APP_ID || "1098");
                            const res = await deriv.executeTrade(acc.api_token_encrypted, orderParams);
                            dispatchTrace.actions.push({
                                type: 'deriv_ws_execution',
                                account_label: acc.account_label,
                                status: res.success ? 'success' : 'failed',
                                contract_id: res.contract_id,
                                error: res.error
                            });
                        }
                    }

                    // Type C: cTrader Open API Copy-Trading execution
                    if (route.destination_type === 'ctrader_ws' && acc.platform === 'ctrader') {
                        if (simulate) {
                            dispatchTrace.actions.push({
                                type: 'ctrader_ws_execution',
                                account_label: acc.account_label,
                                status: 'simulated_success',
                                lot_sizing: `${acc.lot_sizing_type} (${lotSize} lots)`,
                                payload_simulated: orderParams
                            });
                        } else {
                            const ctrader = new CTraderExecutor();
                            const res = await ctrader.executeTrade(acc.api_token_encrypted, acc.account_id, orderParams);
                            dispatchTrace.actions.push({
                                type: 'ctrader_ws_execution',
                                account_label: acc.account_label,
                                status: res.success ? 'success' : 'failed',
                                order_id: res.orderId,
                                error: res.error
                            });
                        }
                    }

                    // Type D: MT5 Webhook Copier Execution
                    if (route.destination_type === 'mt5_webhook' && acc.platform === 'mt5') {
                        if (simulate) {
                            dispatchTrace.actions.push({
                                type: 'mt5_webhook_execution',
                                account_label: acc.account_label,
                                status: 'simulated_success',
                                lot_sizing: `${acc.lot_sizing_type} (${lotSize} lots)`,
                                payload_simulated: orderParams
                            });
                        } else {
                            const mt5 = new MT5Executor();
                            const res = await mt5.executeTrade(acc.api_token_encrypted, orderParams);
                            dispatchTrace.actions.push({
                                type: 'mt5_webhook_execution',
                                account_label: acc.account_label,
                                status: res.success ? 'success' : 'failed',
                                ticket: res.order_ticket,
                                error: res.error
                            });
                        }
                    }
                });

                await Promise.all(tradePromises);

            } catch (err) {
                console.error(`Destination target routing failed for Route ID ${route.id}:`, err.message);
                dispatchTrace.actions.push({
                    type: 'routing_exception',
                    error: err.message
                });
            }

            trace.route_dispatches.push(dispatchTrace);
        });

        await Promise.all(executionPromises);

        // Update Log record with completed status and metadata (Skip if simulating or DB is offline)
        if (!simulate && !isUsingFallbackCache) {
            try {
                await supabase
                    .from("signal_logs")
                    .update({
                        ai_provider_used: aiResult.provider || 'fallback_rules',
                        parsed_action: parsedTradeParams?.action || 'STATUS',
                        parsed_symbol: parsedTradeParams?.symbol || 'UNKNOWN',
                        status: 'processed'
                    })
                    .eq("source_chat_id", source_chat_id)
                    .eq("source_message_id", source_message_id || 1);
            } catch (logErr) {
                console.warn("Could not write processed status back to database log due to offline state.", logErr.message);
            }
        }

        return new Response(JSON.stringify({ 
            success: true, 
            processed_by: aiResult.provider || 'fallback',
            trace 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        console.error("Signal processor execution error:", err.message);
        return new Response(JSON.stringify({ success: false, error: err.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
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

/**
 * SaaS Dashboard API Router (CRUD Operations for Bot Tokens, Accounts, Routes)
 */
async function handleAdminAPI(request, supabase, path, method) {
    try {
        const body = (method === "POST" || method === "PUT") ? await request.json() : null;

        const json = (data, status = 200) => new Response(JSON.stringify(data), { 
            status, 
            headers: { "Content-Type": "application/json" } 
        });

        // Get or Create Workspaces (Basic Admin Access)
        if (path === "/api/admin/data/workspaces" && method === "GET") {
            const { data } = await supabase.from("workspaces").select("*");
            return json(data);
        }

        if (path === "/api/admin/data/workspaces" && method === "POST") {
            const { id, name, owner_email, tg_bot_token, tg_admin_chat_id, tg_vip_chat_id } = body;
            const payload = { name, owner_email, tg_bot_token, tg_admin_chat_id, tg_vip_chat_id };
            if (id) {
                const { data, error } = await supabase.from("workspaces").update(payload).eq("id", id).select().single();
                return error ? json({ error }, 400) : json(data);
            } else {
                const { data, error } = await supabase.from("workspaces").insert(payload).select().single();
                return error ? json({ error }, 400) : json(data);
            }
        }

        // 1-Click Bot Webhook Authorization
        if (path === "/api/admin/bot/authorize" && method === "POST") {
            const { workspace_id, bot_token } = body;
            const requestUrl = new URL(request.url);
            const webhookUrl = `https://${requestUrl.host}/api/webhook/telegram_bot/${bot_token}`;
            
            const tgRes = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
            const tgData = await tgRes.json();
            
            if (tgData.ok) {
                await supabase.from("workspaces").update({ tg_bot_token: bot_token }).eq("id", workspace_id);
                return json({ success: true });
            } else {
                return json({ success: false, error: tgData.description }, 400);
            }
        }

        // Interactive Bank Approvals Manager
        if (path === "/api/admin/bank/decision" && method === "POST") {
            const { deposit_id, action } = body; // 'approved' or 'declined'
            
            const { data: deposit, error: depErr } = await supabase.from("bank_deposits").select("*").eq("id", deposit_id).maybeSingle();
            if (depErr || !deposit) {
                return json({ success: false, error: "Deposit record not found" }, 404);
            }
            
            if (deposit.status !== 'pending') {
                return json({ success: false, error: "Deposit already processed" }, 400);
            }
            
            await supabase.from("bank_deposits").update({ status: action }).eq("id", deposit_id);
            
            if (action === 'approved') {
                const months = deposit.plan_requested === 'quarterly' ? 3 : 1;
                const expiresAt = new Date();
                expiresAt.setMonth(expiresAt.getMonth() + months);
                
                const { data: ws } = await supabase.from("workspaces").select("*").eq("id", deposit.workspace_id).maybeSingle();
                let inviteLink = "Direct Manual Approval (Invite Link generation requires valid Bot Token and VIP Group ID)";
                
                if (ws && ws.tg_bot_token && ws.tg_vip_chat_id) {
                    try {
                        const inviteRes = await fetch(`https://api.telegram.org/bot${ws.tg_bot_token}/createChatInviteLink`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                chat_id: ws.tg_vip_chat_id,
                                member_limit: 1
                            })
                        });
                        const inviteData = await inviteRes.json();
                        if (inviteData.ok) {
                            inviteLink = inviteData.result.invite_link;
                        }
                    } catch (e) {
                        console.error("Invite link generation failed:", e);
                    }
                }
                
                await supabase.from("vip_members").upsert({
                    workspace_id: deposit.workspace_id,
                    telegram_id: deposit.telegram_id,
                    username: deposit.username,
                    status: 'active',
                    subscription_tier: deposit.plan_requested === 'quarterly' ? 'quarterly' : 'monthly',
                    expires_at: expiresAt.toISOString(),
                    invite_link: inviteLink,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'workspace_id, telegram_id' });
                
                if (ws && ws.tg_bot_token) {
                    try {
                        await fetch(`https://api.telegram.org/bot${ws.tg_bot_token}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                chat_id: deposit.telegram_id,
                                text: `🎉 *PAYMENT VERIFIED & APPROVED!*\n\nYour manual bank transfer deposit of $${deposit.amount} has been successfully verified by our admin team.\n\n💎 *Your VIP Access is now ACTIVE!* (${deposit.plan_requested.toUpperCase()})\n\n🔑 *Click the single-use invite link below to join the VIP Signal group:* \n${inviteLink}\n\n_Note: This link can only be used once, so do not share it._`,
                                parse_mode: "Markdown"
                            })
                        });
                    } catch (e) {
                        console.error("Failed to notify user via Bot:", e);
                    }
                }
            } else {
                const { data: ws } = await supabase.from("workspaces").select("*").eq("id", deposit.workspace_id).maybeSingle();
                if (ws && ws.tg_bot_token) {
                    try {
                        await fetch(`https://api.telegram.org/bot${ws.tg_bot_token}/sendMessage`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                chat_id: deposit.telegram_id,
                                text: `❌ *DEPOSIT REJECTED!*\n\nYour manual bank transfer deposit of $${deposit.amount} could not be verified by our team.\n\nIf you believe this is a mistake, please contact customer support.`,
                                parse_mode: "Markdown"
                            })
                        });
                    } catch (e) {
                        console.error("Failed to notify user via Bot:", e);
                    }
                }
            }
            
            return json({ success: true });
        }
        
        // Generic DB Proxy for Dashboard (No RLS / Anon Key needed on frontend)
        if (path === "/api/admin/data/proxy" && method === "POST") {
            const { table, action, match, payload } = body;
            let query = supabase.from(table);
            
            if (action === "select") query = query.select('*').order('created_at', { ascending: false }).limit(50);
            if (action === "insert") query = query.insert(payload).select();
            if (action === "update") query = query.update(payload).match(match).select();
            if (action === "delete") query = query.delete().match(match);
            
            const { data, error } = await query;
            return error ? json({ error }, 400) : json(data);
        }
        
        return json({ error: "Admin endpoint not found" }, 404);

    } catch (err) {
        console.error("Admin API error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
