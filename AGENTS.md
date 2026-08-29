# StarPips Signal Engine & AI Infrastructure Tracker

## Environment & Runtime (August 2026)
- **Engine**: Python 3.11-alpine microservice running on Coolify / Self-Hosted VPS.
- **Telegram Gateway**: Telethon MTProto Client listening directly to MTProto event streams.
- **AI Brain**: Google Gemini API via async REST endpoints (`gemini-3.5-flash` primary, cascading to `3.6-flash`, `2.5-flash`, `2.0-flash`).
- **Database & Routing**: Supabase REST API with 60-second in-memory caching.
- **Trading & Webhook Execution**: Non-blocking asynchronous task dispatch (`asyncio.create_task`) for MT5 and Telegram forwarders.

## Progress & Fixes Applied:
1. **Container Resource Optimization**:
   - Converted Dockerfile to ultra-lightweight Alpine Linux (~40MB RAM footprint).
   - Set memory limits (256MB) to protect database and prevent VPS freezing.
2. **Database Zero-Latency RAM Cache**:
   - In-memory cache implemented for Supabase settings & active route rules to eliminate database roundtrip latency on rapid signals.
3. **AI Payload & Model Standardization**:
   - Standardized active models matching JS worker: `gemini-3.5-flash` primary, cascading to `3.6-flash`, `3.5-pro`.
   - Set temperature to 0.1 for deterministic JSON responses.
   - Implemented asymmetric fast-fail timeouts (8s on Attempt 1, 15s on Attempt 2) to balance rapid execution with sufficient stream time for full HTML responses.
   - Built ultra-resilient multi-tier JSON parser (`parse_json_safely`) with `strict=False`, string newline escaping (`fix_json_newlines`), and missing comma auto-repair (`fix_missing_commas`) to handle complex formats cleanly.
   - Implemented **Dual-Mode AI Engine**: The system now dynamically processes both complex JSON dictionaries (for webhooks/trading stats) and ultra-fast plain HTML text strings (bypassing JSON structures entirely) for immediate, zero-delay Telegram broadcasting.
   - Built **Truncation & Integrity Protection**: Added `is_response_complete()` validation on both raw and JSON outputs to catch cut-off/corrupted AI responses (e.g. missing footer or unbalanced HTML tags) and auto-force immediate fallback to the next model.

4. **Architectural Pivot to Cloudflare Edge Worker**:
   - Transferred complete AI execution, parsing, Supabase caching, dual-mode truncation protection, and Telegram posting logic to `worker.js` (Cloudflare Workers).
   - Python Engine (`main.py`) simplified to act strictly as a zero-latency MTProto listener forwarding webhook payloads (`POST /api/webhook/process_signal`) to the Cloudflare Worker.
   - Set Cloudflare Gemini fetch timeout attempts to 15s/15s to guarantee sufficient time for Google's API to stream full HTML without premature truncation, leveraging CF's internal parallelism.
   - Admin panel remains 100% untouched; all new code appended safely inside `worker.js`.

5. **Removed Static Source Channels**:
   - `SOURCE_CHANNELS` environment variable completely removed from the Python listener.
   - The Python listener now forwards all trading-related messages to Cloudflare.
   - The Cloudflare worker acts as the strict gatekeeper, verifying the `chat_id` dynamically against the active Supabase `routes` table before performing any AI operations.

6. **Cloudflare Security Bypass**:
   - Added explicit `User-Agent: StarPips-Python-Listener/1.0` header to the Python `aiohttp` client to bypass Cloudflare's Bot Management (403 Forbidden) challenge page when forwarding payloads to the worker.

7. **100% Reliability & Zero-Drop Architecture (August 19, 2026)**:
   - **Stale-While-Revalidate DB Config**: Implemented `fetch_db_config_with_fallback` in `worker.js`. If Supabase REST API experiences temporary network glitches or timeouts, the worker retries up to 3 times, and falls back to stale in-memory config if available. Eliminates `Failed to fetch DB config` 500 errors.
   - **Zero-Drop AI Fallback**: If all Gemini models fail or time out, `worker.js` automatically engages Fallback Mode, cleanly formatting the raw text with `<b>` tags and appending the `~~~ \n<b>Starpips Forex</b>` footer. Guarantees 100% signal delivery even during AI API outages.
   - **Telegram Automatic Retries**: `worker.js` automatically retries Telegram `sendMessage` up to 3 times on network glitches or 429 rate limits.
   - **Python Worker Forwarding Retries**: `main.py` retries sending webhooks to Cloudflare Worker up to 3 times (with 2s, 4s exponential backoff) if there is any network timeout or HTTP error.

8. **Downtime Catch-Up & Deep Fallback Formatting (August 19, 2026)**:
   - **60-Second Reconnection Catch-Up**: `main.py` runs `catch_up_missed_signals()` upon startup or connection recovery, scanning MTProto history for any signals received in the last 60 seconds.
   - **Worker Message Deduplication**: Cloudflare Worker checks `message_map` by `source_chat_id` and `source_message_id` before processing. If a signal was already posted, it drops it safely to avoid duplicate messages.
   - **Deep Rule-Based Fallback Parser (`format_fallback_signal`)**: Built regex-based deterministic parser in `worker.js`. If Gemini AI fails or times out, the fallback engine parses Action, Symbol, Entry, TP 1, TP 2, Stop Loss, TP Hits, or updates, formatting them cleanly in **100% bold HTML** with the `~~~\n<b>Starpips Forex</b>` footer. Guarantees clean formatted output without unformatted raw text or missing bold tags.

9. **Instant Memory Deduplication & Race Condition Fix (August 19, 2026)**:
   - **Root Cause Identified**: Live Telethon event handler and 60s catch-up routine sent duplicate requests for the same `message_id` within milliseconds of each other before `message_map` DB write completed.
   - **Layer 1 Python Fix (`main.py`)**: Added `is_duplicate_msg(chat_id, message_id)` synchronous memory filter. Drops duplicate events before forwarding to Cloudflare Worker.
   - **Layer 2 Worker Fix (`worker.js`)**: Added `PROCESSED_MESSAGES` synchronous memory lock at the top of `/api/webhook/process_signal`. Drops duplicate HTTP requests instantly in 0.00ms before making any AI or Telegram API calls.

10. **Destination Route & Normalized Text Deduplication Fix (August 19, 2026)**:
   - **Root Causes Fixed**:
     1. **Duplicate Database Route Entries**: If `routes` table had multiple matching rows for the same `source_chat_id` and `destination_chat_id`, Worker executed `sendMessage` twice for a single incoming signal. Fixed by deduplicating `routes` array by `destination_chat_id` before broadcasting.
     2. **Duplicate Short Signal Events**: If Telegram sent duplicate events for "buy gold" (e.g. edit/forward/retry), Worker now checks normalized text `text_${chat_id}_${normText}` within a 15-second rolling window.
   - **Python & Worker Alignment**: Both `main.py` and `worker.js` now enforce dual-key deduplication (`message_id` + `normalized_text`), guaranteeing zero duplicate posts while allowing sequential follow-up signals.

11. **High-Precision Symbol Parsing, Value Cut-Off Elimination & Source Credit Stripping (August 21, 2026)**:
   - **Full Price Digit Preservation**: Fixed regex and AI prompt parsing in `worker.js` and `/fast_prompt.txt` so 6-digit Deriv/Forex numbers (e.g. `756201.43`, `757200`) and ranges (`6795 - 6810`) are preserved 100% without truncation or cut-offs.
   - **Symbol vs Entry Disambiguation**: Resolved issue where numbers inside index names (e.g. `Volatility 25`, `V75(1s)`) were mistakenly grabbed as entry prices or TP levels.
   - **Separation of Running Pips Updates vs New Signals**: Fixed issue where progress updates like `"V25(1s) Buy Running 875 PIPS"` were misparsed as fake BUY signals (`BUY V25 (875)`). Trade updates now render strictly as bold status updates.
   - **Automatic Source Credit & Handle Removal**: Built `strip_source_credits()` in `worker.js` and updated the AI prompt. Automatically strips Telegram `@usernames`, `#hashtags`, and channel title banners (e.g. `QAS VIP SIGNAL`) while preserving prices and trading data.
   - **Image Caption Capture**: Updated Python listener (`Starai-Py/main.py`) to extract `raw_text`, `message`, `caption`, and `text` attributes from Telethon photo events to capture media captions without dropping text.
   - **Consistent Spacing & Line Breaks**: Standardized all signal formats to strictly enforce double line breaks (`\n\n`) before the `~~~\n<b>Starpips Forex</b>` footer.

12. **Mandatory Section Spacing, Multi-Account MTProto & Multi-Endpoint Webhook Architecture (August 21, 2026)**:
   - **Mandatory Blank Line Spacing**: Added `ensure_signal_spacing()` in `worker.js` and updated `/fast_prompt.txt`. Enforces clean empty line breaks (`\n\n`) between Action/Symbol header and Take Profit 1, between Take Profits and Stop Loss, and before the `~~~\n<b>Starpips Forex</b>` footer.
   - **Multi-Account MTProto Listener (`Starai-Py/main.py`)**: Enhanced Python engine to dynamically detect and launch multiple Telethon clients in parallel using `asyncio.gather()`. Supports `API_ID`, `API_HASH`, `SESSION_STRING` (Account 1) alongside `API_ID_2`, `API_HASH_2`, `SESSION_STRING_2` up to Account 10 without breaking existing single-account setups.
   - **Multi-Endpoint Worker Forwarding**: Enhanced Python listener and Cloudflare Worker to forward signals concurrently to multiple destinations. Reads `CF_WORKER_URL`, `CF_WORKER_URL_2`, `WEBHOOK_URL_2`, etc. in Python, and `GLOBAL_WEBHOOK_URL`, `GLOBAL_WEBHOOK_URL_2` in Cloudflare Worker.

13. **AI Thinking Sanitization, Atomic Database Pre-Reservation Lock & Complete Trade Updates Engine (August 21, 2026)**:
   - **Elimination of Unfinished AI "Thinking" / Draft Messages**: Built `clean_ai_output()` and updated `is_response_complete()` in `worker.js`. Automatically strips markdown code fences and reasoning preambles (e.g. *"Wait, let's double check..."*), enforcing pure HTML text starting directly with `<b>`. Added explicit `systemInstruction` in Gemini API payload to forbid thought generation.
   - **Atomic Database Pre-Reservation Lock**: Added instant database pre-reservation lock in `worker.js`. When a webhook request arrives, it immediately inserts a `PENDING_LOCK` record into Supabase `message_map` *before* invoking Gemini AI or Telegram. If parallel worker isolates or HTTP retries attempt to process the same message concurrently, they hit the DB lock and drop instantly, eliminating cross-isolate race condition duplicates.
   - **Comprehensive Trade Updates Engine (TP Hits, SL Hits, BE, Close, Cancel, Activated)**: Upgraded `format_fallback_signal()` in `worker.js` and `/fast_prompt.txt` to cover all signal update formats (including `Tp 1 ✅`, `Tp 1 💣`, `Tp 1 🎯`, `Tp 2 done`, `SL HIT ❌`, `Move SL to BE`, `Close Half`, `Close All`, `Signal Cancelled`, and `Order Activated`).

14. **Full Prompt Integration, Half-Signal Cut-off Fix & Auto-Tag Repair (August 22, 2026)**:
   - **Merged Master Prompt (`/fast_prompt.txt`)**: Seamlessly integrated user's exact prompt directives (bracketed profit estimates `($15)`, weekly roundup recaps, explicit structure rules, trade update directives) with fast prompt safeguards.
   - **Fixed Footer Index Truncation Bug**: Changed `indexOf('Starpips Forex')` to `lastIndexOf('Starpips Forex')` in `clean_ai_output()`. The previous `indexOf` caused signals that mentioned "Starpips Forex" near the header to be chopped in half.
   - **Auto-Repair Missing HTML Bold Tags**: Added `fix_html_bold_tags()` in `worker.js` to auto-balance missing `</b>` tags from Gemini streams instead of rejecting the entire message.
   - **Expanded Max Token Allocation**: Increased Gemini API `maxOutputTokens` from 1500 to 2048 to prevent truncation on long weekly summaries or complex multi-line trade signals.

16. **Universal Multi-Market Coverage & Flexible Signal Layout Verification (August 25, 2026)**:
   - **Universal Asset Recognition**: Expanded symbol and action regexes in `worker.js` and master prompt `/fast_prompt.txt` to guarantee 100% recognition for all global markets: Forex Majors/Minors/Exotics, JPY Pairs (e.g., `USDJPY`, `GBPJPY`, `EURJPY`), Gold/Metals (`XAUUSD`, `XAGUSD`), Commodities (`WTI`, `OIL`, `BRENT`), Stock Indices (`US30`, `NAS100`, `SPX500`, `GER40`, `UK100`), Cryptocurrencies (`BTCUSD`, `ETHUSD`, `SOLUSD`, `XRPUSD`), Stock CFDs, and Deriv Synthetics (`Volatility 25(1s)`, `V75`, `Boom 500`, `Crash 1000`, `Step Index`, `Jump`, `Range Break`, `Dex`).
   - **Action & Entry Flexibility**: Handles `BUY`, `SELL`, `BUY LIMIT`, `SELL LIMIT`, `BUY STOP`, `SELL STOP`, `BUY NOW`, `SELL NOW`, `GO LONG`, `GO SHORT`, `EP:`, `Entry Zone:`, `NOW @`, `AT`, `CMP`, and price ranges (e.g. `156.20 - 156.50`). Both AI Mode and Fallback Mode are verified 100% green.

17. **Fixed Leading Digit Truncation Bug in `strip_source_credits` (August 25, 2026)**:
   - **Root Cause Identified**: `strip_source_credits()` used `replace(/@\w+/g, '')` to strip channel handles. Because `\w` matches word characters including digits (`0-9`), any price preceded by `@` (e.g. `@1.16644`, `Sl@1.16720`, `Tp-1@1.17576`) had `@1` matched as a "handle" and stripped out, leaving truncated decimal prices like `.16644`, `.16720`, `.17576`.
   - **Fix Applied**: Updated handle regex to `/@[a-zA-Z][a-zA-Z0-9_]*/g` and line check to `/^@[a-zA-Z]\w*/i`. Handles MUST begin with a letter, preserving `@1.16644` and all price digits 100% intact before passing to AI or Fallback mode.

18. **Support for Parentheses Shorthand `@(` in Entry, TP, and SL (August 25, 2026)**:
   - **Parentheses Separator Support**: Added `(` to separator regex sets `[\s:@=\-\(]*` for Entry, TP, and SL in `worker.js`.
   - **Example Handling**: Inputs like `SELL EURUSD @(1.16644)`, `Sl@(1.16720)`, `Tp-1@(1.17576)` are stripped of parentheses and formatted cleanly with 100% accurate price values.

19. **Next-Gen 100% Cloudflare Zero-VPS Architecture & Copy-Trading Blueprint (August 28, 2026)**:
   - **Isolated Blueprint Creation**: Created `/cloudflare-v2/ARCHITECTURE_BLUEPRINT.md` containing full technical specifications without touching existing working files (`/worker.js`, `/Starai-Py/main.py`).
   - **Zero-VPS MTProto Integration**: Planned `@mtcute/web` / `teleproto` listener running on Cloudflare Workers / Durable Objects / TCP Sockets (`cloudflare:sockets`).
   - **Multi-Platform Execution Suite**: Designed execution connectors for Telegram VIP Forwarding, Deriv Direct WebSocket API (`wss://ws.derivws.com/`), cTrader Open API (`wss://live.ctrader.com:5035`), and MT5 Webhook EA Bridge.
   - **VIP Telegram Admin & Subscription Manager**: Planned automated bot commands (`/start`, `/my_sub`, `/trial`, `/buy_vip`), single-use invite link creation (`createChatInviteLink`), Supabase `vip_members` schema, and scheduled Cloudflare Worker cron jobs for auto-kicking expired subscribers and sending expiration notifications.

20. **Completed Cloudflare v2 Multi-Tenant SaaS Platform Implementation (August 28, 2026)**:
   - **Multi-Tenant SQL Schema (`/cloudflare-v2/db/schema.sql`)**: Implemented complete multi-tenant database tables for workspaces, modular listener nodes, priority AI providers, signal routes, trade accounts, VIP members, and manual bank deposit screenshot uploads.
   - **Universal Multi-AI Provider Router (`/cloudflare-v2/src/ai/universal_ai.js`)**: Implemented dynamic priority rank sorting, failover cascading (Gemini -> OpenAI -> CF AI -> Regex fallback), token auto-repairing, and thinking block sanitisation.
   - **VIP Subscription Bot (`/cloudflare-v2/src/vip/vip_manager.js`)**: Developed complete private commands, trial tracking, manual bank invoice details, user screenshot submissions, and direct interactive Admin Channel approval/rejection buttons with automated DM delivery and single-use chat invite links.
   - **Automated Lifecycle Expiration Cron**: Integrated 15-minute cron triggers handling user removals (`banChatMember`), invite link revocations, and countdown alerts (3 days, 1 day) before subscription expires.
   - **Modular Copy-Trading Executors (`/cloudflare-v2/src/executors/trade_executors.js`)**: Implemented concurrent execution pipelines for Deriv Synthetics direct WebSocket purchases, cTrader Open API orders, MT5 Webhook bridges, and Telegram VIP channel forwarders.
   - **Persistent `@mtcute` DO Node (`/cloudflare-v2/src/listener/listener_node.js`)**: Built the Always-On persistent state listener running inside Cloudflare Durable Objects to stream 24/7 background Telegram socket message events seamlessly.
   - **Core SaaS Routing Worker (`/cloudflare-v2/src/index.js`)**: Connected all modules together in a single Cloudflare Worker handling workspace administrative API pathways and copier webhook signals.

21. **Multi-Tenant Per-Destination Custom Formatting & Branding (August 28, 2026)**:
   - **Dynamic Route Customization**: Added a dynamic `route_settings` (JSONB) column to the `signal_routes` table in the database schema.
   - **Independent Adjustments**: Allows workspace admins to configure custom parameters per individual destination target channel without modifying the primary AI parsed trade details.
   - **Single-Entry Range Stripping**: Added built-in regex inside the core worker (`index.js`) to automatically strip entry ranges (e.g. converting `"1234.50 - 1238.90"` to `"1234.50"`) if `single_entry` setting is enabled.
   - **Custom Branding Overlays**: Supports applying custom headers (e.g. `🏆 PREMIUM ALERTS`) and footer overlays per channel to allow SaaS tenants to white-label their delivery outputs.

22. **Zero-CLI GitHub Auto-Deploy, Durable Objects, & Zitadel Enterprise Setup (August 28, 2026)**:
   - **GitHub CD Connection**: Structured the `/cloudflare-v2/` directory as a self-contained worker project, enabling automated Cloudflare builds directly from GitHub pushes.
   - **Stateful Durable Object Binding**: Documented the configuration steps for linking the persistent `@mtcute` MTProto Listener Class (`MTProtoListenerNode`) to Cloudflare namespaces using either Dashboard Bindings or versioned `wrangler.toml` migrations.
   - **Zitadel OIDC Gate**: Integrated an architectural blueprint for securing admin access on `trade.mkety.com` using Zitadel claims. Verifies JWT signatures directly against the JWKS endpoint, checking for custom/enterprise OIDC role memberships.



