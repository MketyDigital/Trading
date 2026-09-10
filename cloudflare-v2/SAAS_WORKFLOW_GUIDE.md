# Mkety Multi-Tenant SaaS: GitHub, Zitadel Enterprise, Per-Destination Customization & Durable Objects Guide

This guide details how to structure, customize, secure, and deploy the **Mkety Trading & Copier SaaS** (`trade.mkety.com`) with full isolation and integration.

---

## 1. Structuring your GitHub Repository for Cloudflare Auto-Builds

To enable **Continuous Deployment (CD)** from GitHub directly into Cloudflare Workers without using any CLI command lines, your repository should be structured to keep your core SaaS separate from the copier worker.

### Recommended Repository Layout
```text
your-github-repo/
├── .github/workflows/         # Optional Github Actions for main site
├── main-app-ui/               # Your primary dashboard (app.mkety.com)
│   ├── package.json
│   ├── src/
│   └── public/
└── cloudflare-v2/             # Isolated Copier Engine (trade.mkety.com)
    ├── wrangler.toml          # Cloudflare configuration file
    ├── db/
    │   └── schema.sql         # Supabase setup SQL
    ├── src/
    │   ├── index.js           # Core SaaS Entry Point & Routing Handler
    │   ├── ai/
    │   │   └── universal_ai.js # Multi-AI Cascade Engine
    │   ├── vip/
    │   │   └── vip_manager.js  # Private Bot & Subscription lifecycle
    │   ├── executors/
    │   │   └── trade_executors.js # Trading connectors (Deriv, cTrader, MT5)
    │   └── listener/
    │       └── listener_node.js # Stateful MTProto DO socket listener
    └── package.json
```

---

## 2. Setting Up Durable Objects: Is it Automatic?

**No, Durable Objects require a one-time binding configuration.** Since they run on dedicated CPU and RAM slices, Cloudflare needs to know which class inside your code corresponds to the Durable Object namespace.

### Option A: The Zero-CLI Cloudflare Dashboard Method (100% Web UI)
1. Navigate to the **Cloudflare Dashboard** $\rightarrow$ **Workers & Pages** $\rightarrow$ select your Worker.
2. Click **Settings** $\rightarrow$ **Variables**.
3. Scroll down to **Durable Object Bindings** and click **Add Binding**.
4. Enter the configuration:
   - **Name (Variable Name)**: `MTPROTO_LISTENER_NAMESPACE`
   - **Type**: Durable Object
   - **Class**: `MTProtoListenerNode` (This matches the class name exported in `src/index.js`).
5. Click **Save and Deploy**. Cloudflare automatically provisions and links the Durable Object namespace!

### Option B: The `wrangler.toml` Method (Versioned in Git)
If you prefer to define configuration inside your repository, add a `wrangler.toml` file inside `/cloudflare-v2/` with these lines:

```toml
name = "mkety-copier-engine"
main = "src/index.js"
compatibility_date = "2026-08-28"

[durable_objects]
bindings = [
  { name = "MTPROTO_LISTENER_NAMESPACE", class_name = "MTProtoListenerNode" }
]

[[migrations]]
tag = "v1"
new_classes = ["MTProtoListenerNode"]
```

When Cloudflare builds the worker from your GitHub push, it reads the `[[migrations]]` block and **automatically registers, provisions, and upgrades the Durable Object** without you needing to do anything.

---

## 3. Zitadel Gated "Enterprise-Only" SaaS Provisioning

Since `app.mkety.com` uses Zitadel for authentication, we can grant copier access *only* to Custom or Enterprise accounts without adding complex billing layers on `trade.mkety.com`.

### Gated Authorization Flow
Rather than users clicking "Subscribe" and entering credit cards on the copier, the SaaS Admin provisions access on Zitadel:

1. **Step 1: Assign User Role on Zitadel**:
   - In your Zitadel Console, navigate to your Project $\rightarrow$ Roles.
   - Create a role named `copier_access` or `enterprise_user`.
   - Assign this role to custom or enterprise clients manually.
2. **Step 2: Token Verification in the Worker**:
   - The admin UI at `trade.mkety.com` handles login by redirecting to Zitadel and receiving an OIDC Access Token.
   - For every settings modification or view action, the browser includes this token in the header: `Authorization: Bearer <token>`.
   - The worker validates the JWT signature against Zitadel’s public JWKS endpoint (`env.ZITADEL_JWKS_URL`) and reads the claims:
     ```javascript
     const roles = decodedToken["urn:zitadel:iam:org:project:roles"] || {};
     const hasAccess = roles["copier_access"] || roles["enterprise_user"];
     if (!hasAccess) {
         return new Response("Unauthorized: Gated for Custom/Enterprise accounts only", { status: 403 });
     }
     ```

---

## 4. Per-Destination Custom Formatting & Branding (How It Works)

We added a database column called `route_settings` (JSONB) to the `signal_routes` table. This allows setting options for **each individual target chat** dynamically without altering the core AI parser or affecting other destinations:

### Supported Per-Destination Settings:
* `single_entry` (Boolean): If set to `true`, the worker automatically strips entry price ranges (e.g., `1234.50 - 1238.90`) to a single entry price (e.g., `1234.50`).
* `custom_header` (String): If provided, inserts a unique branding header (e.g., `🏆 PREMIUM FOREX ALERTS`) at the top of the formatted HTML.
* `custom_footer` (String): If provided, overrides the default footer for that destination channel (e.g., replacing `Starpips Forex` with the client's own brand).

### Execution Engine in `index.js`:
```javascript
// Extrapolate custom route settings per-destination
const settings = route.route_settings || {};
let localizedHtml = formattedHtml;

// Convert price ranges to a single entry if requested
if (settings.single_entry) {
    localizedHtml = localizedHtml.replace(/(\b\d+(?:\.\d+)?)\s*[\s\-–—]+\s*(\d+(?:\.\d+)?\b)/g, '$1');
}

// Prefix custom branding header if provided
if (settings.custom_header) {
    localizedHtml = `<b>${settings.custom_header}</b>\n\n${localizedHtml}`;
}
```

---

## 5. File Isolation: Can you safely edit individual features?

**Yes.** Each feature is placed inside its own module under `src/` to prevent side effects when editing:

* **If you want to add or optimize AI prompts/models**: Edit only `/cloudflare-v2/src/ai/universal_ai.js`.
* **If you want to modify private Bot commands, trials, or manual receipt validation**: Edit only `/cloudflare-v2/src/vip/vip_manager.js`.
* **If you want to update trade lot sizes, custom execution rules, or add a new broker**: Edit only `/cloudflare-v2/src/executors/trade_executors.js`.
* **If you want to adjust listener connection streams**: Edit only `/cloudflare-v2/src/listener/listener_node.js`.
* **If you want to adjust API request/response structures**: Edit only `/cloudflare-v2/src/index.js`.

This absolute modularity ensures that any edits you or AI models make in the future will be safely contained within the target module, keeping the rest of the application 100% green and error-free
