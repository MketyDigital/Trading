import http from 'http';
import { createClient } from '@supabase/supabase-js';
import { renderDashboard } from './cloudflare-v2/src/dashboard.js';

const PORT = 3000;

// Initialize Supabase using environment variables
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || 
                    process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_KEY || 
                    process.env.SUPABASE_SERVICE_KEY || 
                    process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log("Supabase Client initialized successfully in server.js preview mode!");
    } catch (e) {
        console.error("Failed to initialize Supabase:", e.message);
    }
} else {
    console.warn("⚠️ Warning: SUPABASE_URL and key are missing in the environment variables.");
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Helper to send JSON responses
    const sendJSON = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    // Helper to parse JSON body
    const getJSONBody = () => {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({}); }
            });
            req.on('error', err => reject(err));
        });
    };

    try {
        // Route 1: Database Proxy for Dashboard (Runs in development applet context)
        if (path === "/api/admin/data/proxy" && method === "POST") {
            if (!supabase) {
                return sendJSON({ error: "Supabase not configured in preview environment variables." }, 500);
            }
            const body = await getJSONBody();
            const { table, action, match, payload } = body;
            let query = supabase.from(table);
            
            if (action === "select") query = query.select('*').order('created_at', { ascending: false }).limit(50);
            if (action === "insert") query = query.insert(payload).select();
            if (action === "update") query = query.update(payload).match(match).select();
            if (action === "delete") query = query.delete().match(match);
            
            const { data, error } = await query;
            return error ? sendJSON({ error }, 400) : sendJSON(data);
        }

        // Route 2: 1-Click Bot Webhook Authorization
        if (path === "/api/admin/bot/authorize" && method === "POST") {
            if (!supabase) {
                return sendJSON({ error: "Supabase not configured." }, 500);
            }
            const body = await getJSONBody();
            const { workspace_id, bot_token } = body;
            const webhookUrl = `https://${req.headers.host}/api/webhook/telegram_bot/${bot_token}`;
            
            const tgRes = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
            const tgData = await tgRes.json();
            
            if (tgData.ok) {
                await supabase.from("workspaces").update({ tg_bot_token: bot_token }).eq("id", workspace_id);
                return sendJSON({ success: true });
            } else {
                return sendJSON({ success: false, error: tgData.description }, 400);
            }
        }

        // Route 3: Bank Approvals Decision Manager
        if (path === "/api/admin/bank/decision" && method === "POST") {
            if (!supabase) {
                return sendJSON({ error: "Supabase not configured." }, 500);
            }
            const body = await getJSONBody();
            const { deposit_id, action } = body; // 'approved' or 'declined'
            
            const { data: deposit, error: depErr } = await supabase.from("bank_deposits").select("*").eq("id", deposit_id).maybeSingle();
            if (depErr || !deposit) {
                return sendJSON({ success: false, error: "Deposit record not found" }, 404);
            }
            
            if (deposit.status !== 'pending') {
                return sendJSON({ success: false, error: "Deposit already processed" }, 400);
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
            
            return sendJSON({ success: true });
        }

        // Route 4: Render SaaS Master Dashboard
        if (path === "/" || path === "/admin") {
            const html = renderDashboard(process.env);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // Fallback 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end("Not Found");

    } catch (err) {
        console.error("Preview Server API error:", err);
        sendJSON({ error: err.message }, 500);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Development Server listening on port ${PORT}`);
});
