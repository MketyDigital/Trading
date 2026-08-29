import os
import asyncio
import logging
import datetime
from aiohttp import ClientSession, ClientTimeout
from telethon import TelegramClient, events
from telethon.sessions import StringSession

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] - %(message)s'
)
logger = logging.getLogger("StarPipsMTProto")

# =========================================================
# MULTI-ENDPOINT & MULTI-ACCOUNT ENVIRONMENT CONFIGURATION
# =========================================================

# 1. Collect all Cloudflare Worker & Webhook Endpoints
WORKER_ENDPOINTS = []
primary_url = os.environ.get('CF_WORKER_URL')
if primary_url:
    WORKER_ENDPOINTS.append(primary_url)

# Scan for additional endpoints (e.g. CF_WORKER_URL_2, CF_WORKER_URL_3, WEBHOOK_URL_2, etc.)
for key, val in os.environ.items():
    if (key.startswith('CF_WORKER_URL_') or key.startswith('WEBHOOK_URL_') or key.startswith('WORKER_URL_')) and val:
        if val not in WORKER_ENDPOINTS:
            WORKER_ENDPOINTS.append(val)

if not WORKER_ENDPOINTS:
    logger.error("MISSING ENVIRONMENT VARIABLES! CF_WORKER_URL is strictly required.")
    exit(1)

# 2. Collect all Telegram MTProto Accounts
ACCOUNT_CONFIGS = []

# Account 1 (Primary)
api_id_1 = os.environ.get('API_ID')
api_hash_1 = os.environ.get('API_HASH')
session_str_1 = os.environ.get('SESSION_STRING', '')

if api_id_1 and api_hash_1:
    ACCOUNT_CONFIGS.append({
        "id": 1,
        "api_id": int(api_id_1),
        "api_hash": api_hash_1,
        "session": session_str_1,
        "file": "starpips_mtproto_session"
    })

# Accounts 2 through 10 (Dynamic environment variables: API_ID_2, API_HASH_2, SESSION_STRING_2, etc.)
for i in range(2, 11):
    a_id = os.environ.get(f'API_ID_{i}')
    a_hash = os.environ.get(f'API_HASH_{i}')
    s_str = os.environ.get(f'SESSION_STRING_{i}', '')
    
    if a_id and a_hash:
        ACCOUNT_CONFIGS.append({
            "id": i,
            "api_id": int(a_id),
            "api_hash": a_hash,
            "session": s_str,
            "file": f"starpips_session_{i}"
        })

if not ACCOUNT_CONFIGS:
    logger.error("MISSING ENVIRONMENT VARIABLES! API_ID and API_HASH are strictly required.")
    exit(1)

trading_keywords = [
    "BUY", "SELL", "TP", "SL", "ENTRY", "GOLD", "XAUUSD", "EURUSD", "GBPUSD", "BTC", 
    "PIPS", "HIT", "CLOSE", "CANCEL", "REENTER", "LIMIT", "SKIP",
    "VOLATILITY", "BOOM", "CRASH", "INDEX", "STEP", "JUMP", "V75", "V100", "V50", "V25", "V10"
]

# Synchronous memory caches to prevent duplicate processing between live events, retries, and catch-up scans
PROCESSED_MSG_KEYS = set()
PROCESSED_TEXT_TIMES = {}

def is_duplicate_msg(chat_id, message_id, text=""):
    now = datetime.datetime.now().timestamp()
    
    # 1. Message ID Check
    if message_id:
        msg_key = f"{chat_id}_{message_id}"
        if msg_key in PROCESSED_MSG_KEYS:
            return True
        PROCESSED_MSG_KEYS.add(msg_key)
        if len(PROCESSED_MSG_KEYS) > 10000:
            PROCESSED_MSG_KEYS.clear()

    # 2. Text Normalization Check (Drops identical texts received from same chat within 15s)
    if text:
        norm_text = text.strip().lower()
        text_key = f"{chat_id}_{norm_text}"
        last_time = PROCESSED_TEXT_TIMES.get(text_key, 0)
        if now - last_time < 15.0: # 15 seconds
            return True
        PROCESSED_TEXT_TIMES[text_key] = now
        
        if len(PROCESSED_TEXT_TIMES) > 2000:
            PROCESSED_TEXT_TIMES.clear()

    return False

async def send_to_single_endpoint(base_url, payload, account_id):
    endpoint = f"{base_url.rstrip('/')}/api/webhook/process_signal"
    headers = {
        "User-Agent": f"StarPips-Python-Listener-Acc{account_id}/1.0",
        "Content-Type": "application/json"
    }
    
    for attempt in range(1, 4):
        try:
            async with ClientSession(headers=headers) as session:
                async with session.post(endpoint, json=payload, timeout=ClientTimeout(total=30)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.info(f"✅ [Acc {account_id}] Delivered to {base_url} (Attempt {attempt}): {data}")
                        return True
                    else:
                        resp_body = await resp.text()
                        logger.warning(f"⚠️ [Acc {account_id}] Endpoint {base_url} returned HTTP {resp.status} (Attempt {attempt}): {resp_body}")
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [Acc {account_id}] Timeout reaching {base_url} (>30s) on Attempt {attempt}.")
        except Exception as e:
            logger.warning(f"⚠️ [Acc {account_id}] Error reaching {base_url} on Attempt {attempt}: {e}")
            
        if attempt < 3:
            await asyncio.sleep(2 * attempt)
            
    logger.error(f"❌ [Acc {account_id}] Failed delivery to {base_url} after 3 attempts.")
    return False

async def process_signal(account_id, text, chat_id, chat_title, message_id, reply_to_id):
    logger.info(f"🧠 [Acc {account_id}] Forwarding signal from '{chat_title}' (Chat ID: {chat_id}, Msg ID: {message_id}) to {len(WORKER_ENDPOINTS)} worker endpoint(s)...")
    
    payload = {
        "text": text,
        "chat_id": chat_id,
        "chat_title": chat_title,
        "message_id": message_id,
        "reply_to_id": reply_to_id,
        "account_id": account_id
    }
    
    # Broadcast in parallel to ALL configured worker endpoints
    tasks = [send_to_single_endpoint(url, payload, account_id) for url in WORKER_ENDPOINTS]
    await asyncio.gather(*tasks)

async def catch_up_missed_signals(client, account_id):
    """Scans all joined channels/groups for any missed trading signals sent in the last 60 seconds."""
    logger.info(f"🔄 [Acc {account_id}] [Catch-Up] Checking for missed signals from the last 60 seconds...")
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(seconds=60)
    
    try:
        async for dialog in client.iter_dialogs(limit=40):
            if not (dialog.is_channel or dialog.is_group):
                continue
            
            chat = dialog.entity
            chat_id = str(dialog.id)
            chat_title = getattr(chat, 'title', 'Channel')
            
            async for message in client.iter_messages(chat, limit=5):
                if not message.date or message.date < cutoff:
                    break
                
                message_text = message.raw_text or getattr(message, 'message', '') or getattr(message, 'caption', '') or getattr(message, 'text', '')
                if not message_text:
                    continue
                
                if any(k in message_text.upper() for k in trading_keywords):
                    if is_duplicate_msg(chat_id, message.id, message_text):
                        logger.info(f"⏭️ [Acc {account_id}] [Catch-Up] Skipping message ID {message.id} (Already processed)")
                        continue
                        
                    reply_to_id = message.reply_to_msg_id if message.is_reply else None
                    logger.info(f"⚡ [Acc {account_id}] [Catch-Up] Processing recent signal from '{chat_title}' ({message.date})")
                    asyncio.create_task(process_signal(
                        account_id,
                        message_text,
                        chat_id,
                        chat_title,
                        message.id,
                        reply_to_id
                    ))
        logger.info(f"✅ [Acc {account_id}] [Catch-Up] Check complete.")
    except Exception as e:
        logger.error(f"⚠️ [Acc {account_id}] [Catch-Up] Error during catch-up scan: {e}")

async def run_single_account(config):
    acc_id = config["id"]
    logger.info(f"🔑 Initializing Telegram Client for Account {acc_id}...")
    
    if config["session"]:
        client = TelegramClient(StringSession(config["session"]), config["api_id"], config["api_hash"])
    else:
        client = TelegramClient(config["file"], config["api_id"], config["api_hash"])

    @client.on(events.NewMessage())
    async def signal_handler(event):
        if not (event.is_channel or event.is_group):
            return

        message_text = event.raw_text or getattr(event.message, 'message', '') or getattr(event.message, 'caption', '') or getattr(event.message, 'text', '')
        if not message_text:
            return

        chat = await event.get_chat()
        chat_title = getattr(chat, 'title', 'Channel')
        chat_id = str(event.chat_id)

        # Fast trading signal detection
        if not any(k in message_text.upper() for k in trading_keywords):
            return

        # Check for duplicate message ID or duplicate short text within 15s
        if is_duplicate_msg(chat_id, event.id, message_text):
            logger.info(f"⏭️ [Acc {acc_id}] [Live] Message ID {event.id} or duplicate text already processed. Dropping duplicate.")
            return

        # Dispatch to background task instantly
        asyncio.create_task(process_signal(
            acc_id,
            message_text,
            chat_id,
            chat_title,
            event.id,
            event.message.reply_to_msg_id
        ))

    await client.start()
    logger.info(f"🎧 [Acc {acc_id}] Connected & Listening for live signals...")
    
    # Run catch-up check on startup
    asyncio.create_task(catch_up_missed_signals(client, acc_id))
    
    await client.run_until_disconnected()

async def main():
    logger.info("=" * 60)
    logger.info("⚡ StarPips Bulletproof Multi-Account & Multi-Endpoint Engine")
    logger.info(f"📱 Loaded Accounts: {len(ACCOUNT_CONFIGS)}")
    logger.info(f"🌐 Loaded Worker Endpoints: {len(WORKER_ENDPOINTS)}")
    logger.info("=" * 60)
    
    # Run all configured Telegram clients in parallel
    await asyncio.gather(*(run_single_account(config) for config in ACCOUNT_CONFIGS))

if __name__ == '__main__':
    asyncio.run(main())
