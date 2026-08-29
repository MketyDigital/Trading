import { TelegramClient, BaseTelegramClient } from '@mtcute/web';

/**
 * MKETY MULTI-TENANT MTPROTO LISTENER NODE (CLOUDFLARE DURABLE OBJECT)
 * 100% Zero-VPS Always-On Persistent State Actor using @mtcute/web
 * Tracks sessions, handles direct TCP connections via cloudflare:sockets,
 * and maintains 24/7 background listening to multiple Telegram Channels.
 */
export class MTProtoListenerNode {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.client = null;
        this.isActive = false;
        
        // Auto-restart MTProto client upon DO spinup/resurrection
        this.state.blockConcurrencyWhile(async () => {
            this.isActive = await this.state.storage.get("is_active") || false;
            if (this.isActive) {
                await this.startListener();
            }
        });
    }

    /**
     * Accepts HTTP controls from the core Worker API (e.g. Start Node, Stop Node, Send Code)
     */
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === "/start") {
                const body = await request.json();
                await this.state.storage.put("api_id", body.apiId);
                await this.state.storage.put("api_hash", body.apiHash);
                await this.state.storage.put("phone", body.phone);
                await this.state.storage.put("is_active", true);
                this.isActive = true;

                await this.startListener();
                return new Response(JSON.stringify({ status: "started", message: "MTProto listener initialising..." }), { headers: { "Content-Type": "application/json" } });
            
            } else if (path === "/send_code") {
                const body = await request.json();
                if (!this.client) return new Response("Client not running", { status: 400 });

                // Pass the verification code to complete the Telegram login handshake
                await this.client.signIn({
                    phone: await this.state.storage.get("phone"),
                    code: body.code
                });

                // Retrieve and persist the session string
                const sessionString = await this.client.exportSession();
                await this.state.storage.put("session_string", sessionString);

                return new Response(JSON.stringify({ status: "authenticated", sessionString }), { headers: { "Content-Type": "application/json" } });

            } else if (path === "/stop") {
                await this.state.storage.put("is_active", false);
                this.isActive = false;
                await this.stopListener();
                return new Response(JSON.stringify({ status: "stopped" }), { headers: { "Content-Type": "application/json" } });

            } else if (path === "/status") {
                const status = this.isActive ? (this.client?.isConnected?.() ? "connected" : "connecting") : "idle";
                return new Response(JSON.stringify({ status, isActive: this.isActive }), { headers: { "Content-Type": "application/json" } });
            }
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        return new Response("Not Found", { status: 404 });
    }

    /**
     * Initializes and starts the persistent `@mtcute/web` Telegram client
     */
    async startListener() {
        const apiId = await this.state.storage.get("api_id");
        const apiHash = await this.state.storage.get("api_hash");
        const sessionString = await this.state.storage.get("session_string");

        if (!apiId || !apiHash) {
            console.error("MTProto credentials missing in DO storage.");
            return;
        }

        // Initialize custom storage driver mapping mtcute's internal key-values directly to DO storage API
        const customStorageDriver = {
            get: async (key) => await this.state.storage.get(`mtcute_${key}`),
            set: async (key, val) => await this.state.storage.put(`mtcute_${key}`, val),
            delete: async (key) => await this.state.storage.delete(`mtcute_${key}`)
        };

        // Instantiate the runtime-agnostic base client
        this.client = new TelegramClient({
            apiId,
            apiHash,
            storage: customStorageDriver,
            testMode: false
        });

        if (sessionString) {
            await this.client.importSession(sessionString);
        }

        // Establish connection via cloudflare:sockets
        await this.client.connect();

        // Register incoming message event listener
        this.client.on('new_message', async (msg) => {
            await this.handleIncomingMessage(msg);
        });

        console.log(`Durable Object MTProto Listener active for API ID ${apiId}`);
    }

    /**
     * Event handler for incoming signals and trading messages
     */
    async handleIncomingMessage(msg) {
        // Drop outgoing messages or messages from bots/groups unless configured
        if (msg.isOutgoing) return;

        const chatId = msg.chat.id;
        const text = msg.text || msg.caption || "";

        console.log(`[MTProto DO] Received message from chat ${chatId}: ${text.substring(0, 40)}...`);

        // Check against active routing rules mapped to this source channel in Supabase
        try {
            const routerUrl = `${this.env.GLOBAL_ROUTER_URL || 'https://trade.mkety.com/api/webhook/process_signal'}`;
            const res = await fetch(routerUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mkety-MTProto-Listener/2.0'
                },
                body: JSON.stringify({
                    source_chat_id: chatId,
                    source_message_id: msg.id,
                    raw_text: text,
                    media: msg.media ? true : false,
                    timestamp: new Date().toISOString()
                })
            });

            if (!res.ok) {
                console.error(`Core Router webhook failed with status: ${res.status}`);
            }
        } catch (err) {
            console.error("Failed to forward signal to Core AI Router:", err.message);
        }
    }

    /**
     * Gracefully disconnects and stops the client connection
     */
    async stopListener() {
        if (this.client) {
            try {
                await this.client.close();
            } catch (err) {
                console.error("Error closing client:", err.message);
            }
            this.client = null;
        }
    }
}
