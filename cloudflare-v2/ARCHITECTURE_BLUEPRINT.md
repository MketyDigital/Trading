# Starpips Next-Gen Cloudflare All-In-One Architecture Blueprint (100% Zero-VPS Setup)

## Overview & Vision
This architecture migrates the entire signal pipeline, copy-trading execution suite, universal multi-AI processing engine, and VIP Telegram membership & payment management system into a 100% serverless, zero-VPS stack hosted on **Cloudflare Workers**, **Cloudflare Durable Objects / Sockets**, **teleproto (Pure JS MTProto)**, **Deriv Direct WebSocket API**, **cTrader Open API**, and **Supabase (Free Tier Database & Auth)**.

---

## 1. System Architecture Components

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLOUDFLARE INFRASTRUCTURE                               │
│                                                                                        │
│  ┌─────────────────────────┐     ┌────────────────────────┐     ┌───────────────────┐  │
│  │ MTProto Listener Worker │ ──> │ Universal Multi-AI     │ ──> │ VIP Admin &       │  │
│  │  (teleproto + Sockets)  │     │ Engine (Dynamic Router)│     │ Payment Manager   │  │
│  └─────────────────────────┘     └────────────────────────┘     └───────────────────┘  │
└────────────┬─────────────────────────────────┬────────────────────────────┬────────────┘
             │                                 │                            │
             ▼                                 ▼                            ▼
┌──────────────────────────┐    ┌───────────────────────────┐    ┌──────────────────────┐
│  Multi-Platform Copying  │    │ Dynamic Model Providers   │    │ Telegram Stars /     │
│  - Telegram VIP Channels │    │ - Google Gemini (Primary) │    │ Manual Bank Receipt  │
│  - Deriv WebSocket API   │    │ - OpenAI (GPT-4o)         │    │ Deposit Verification │
│  - cTrader Open API      │    │ - Cloudflare Workers AI   │    │ Interactive Approval │
│  - MT5 Webhook Bridge    │    │ - GCP Vertex AI / Bedrock │    │ Bot Channel Buttons  │
└──────────────────────────┘    │ - DeepSeek / Groq / Azure │    └──────────────────────┘
                                └───────────────────────────┘
```

---

## 2. Core Service Specifications

### A. MTProto Listener (`/cloudflare-v2/src/listener/`)
- **Technology**: Cloudflare Worker + `cloudflare:sockets` / Durable Objects using **`teleproto`** (Pure JavaScript MTProto library, zero C++/native build dependencies).
- **Purpose**: Establishes a zero-VPS TCP/WebSocket session directly with Telegram's MTProto DC servers.
- **Behavior**: Listens for incoming messages across configured source channels/groups and forwards payloads internally to the Universal Multi-AI Router.

### B. Universal Multi-AI Provider Router (`/cloudflare-v2/src/ai/`)
- **Technology**: Cloudflare Worker API + Unified Provider Interface.
- **Supported Providers**:
  - **Google Gemini** (Flash 3.5 / Pro)
  - **OpenAI** (GPT-4o / o3-mini)
  - **Cloudflare Workers AI** (`@cf/meta/llama-3.3-70b-instruct`)
  - **Google Vertex AI** (GCP Enterprise API)
  - **AWS Bedrock** (Claude 3.5 Sonnet / Llama)
  - **Azure OpenAI**
  - **Groq & DeepSeek** (Ultra-fast LLM APIs)
- **Admin Dynamic Configuration**:
  - All API Keys, Model Names, Base URLs, and Priority Chains stored in Supabase (`ai_providers` table).
  - Admin can enable/disable providers, adjust model parameters, or reorder fallbacks dynamically from the Admin Panel or Telegram Bot.

### C. Multi-Platform Trade Copying Suite (`/cloudflare-v2/src/executors/`)
1. **Telegram VIP Forwarder**: Distributes formatted signals with custom footers to target Telegram channels.
2. **Deriv Direct WebSocket API**: Connects to `wss://ws.derivws.com/websockets/v3?app_id=YOUR_APP_ID`. Sends `authorize` with client API token and calls `buy` for Synthetics (Volatility 25, V75, Boom/Crash).
3. **cTrader Open API**: Connects to cTrader Protobuf WebSocket (`wss://live.ctrader.com:5035`) to send order execution packets directly.
4. **MT5 Webhook / EA Bridge**: Sends structured execution payloads to MT5 EA (`WebRequest`) or lightweight REST bridge.

### D. VIP Membership & Payment Gateway Manager (`/cloudflare-v2/src/vip/`)
- **Payment Gateways Supported**:
  - **Telegram Native Payments (Telegram Stars / Invoices)**.
  - **Manual Bank Transfer & Deposit Verification**: User clicks `[💳 Manual Bank Transfer]` in bot $\rightarrow$ receives bank account details $\rightarrow$ uploads payment receipt photo/PDF $\rightarrow$ Bot forwards receipt to Admin Channel with interactive inline buttons: `[✅ Approve (1 Mo)]` `[✅ Approve (3 Mo)]` `[❌ Reject]`.
  - **Online Gateway Webhooks** (Stripe, Crypto/NowPayments, Paystack, Flutterwave).
- **Subscriber Lifecycle Engine**:
  - **Single-Use Invite Links**: Calls Telegram Bot API `createChatInviteLink` (`member_limit: 1`).
  - **Scheduled Auto-Kick Cron**: Cloudflare Worker Cron runs every 15 minutes to kick expired users (`banChatMember`) and revoke invite links.
  - **Automated Expiration Alerts**: DMs sent 3 days, 1 day, and 12 hours before expiration.

---

## 3. Directory Layout Blueprint

```text
cloudflare-v2/
├── ARCHITECTURE_BLUEPRINT.md    <-- System Architecture Specifications
├── db/
│   └── schema.sql              <-- Complete Supabase Database Tables & RLS Rules
├── src/
│   ├── listener/               <-- Module 1: teleproto MTProto Listener
│   ├── ai/                     <-- Module 2: Universal Multi-AI Router & Adapters
│   ├── executors/              <-- Module 3: Trade Copying Suite (Deriv, cTrader, MT5, TG)
│   ├── vip/                    <-- Module 4: VIP Bot, Manual Bank Receipts, Auto-Kick Cron
│   └── admin/                  <-- Module 5: Admin Management & Configuration API
```

---

## 4. Strict Isolation Guarantee
All files for this next-gen platform will reside **exclusively inside `/cloudflare-v2/`**. The existing production files (`/worker.js`, `/Starai-Py/main.py`, `/fast_prompt.txt`) remain completely untouched.
