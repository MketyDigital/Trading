function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function card(title, body) {
  return `<section class="card"><h2>${esc(title)}</h2>${body}</section>`;
}

export function renderTradingLaunchConsole(env = {}) {
  const broker = enabled(env.BROKER_EXECUTION_ENABLED);
  const tradingAccess = enabled(env.TRADING_ACCESS_ENABLED);
  const customDomains = enabled(env.TRADING_CUSTOM_HOSTNAMES_ENABLED);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mkety Trading Launch Console</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui;color:#102033;background:#f5f7fb}body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:24px}.hero{background:#0f172a;color:white;border-radius:18px;padding:24px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:white;border:1px solid #dbe3ef;border-radius:14px;padding:18px;box-shadow:0 3px 14px rgba(15,23,42,.05)}h1,h2{margin:0 0 8px}.muted{color:#64748b}.hero .muted{color:#cbd5e1}.pill{display:inline-block;border-radius:999px;padding:5px 9px;background:#eef2ff;margin:4px 4px 0 0;font-size:12px;font-weight:700}.danger{background:#fee2e2;color:#991b1b}.ok{background:#dcfce7;color:#166534}.code{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:10px;padding:12px;font:12px ui-monospace,monospace;overflow:auto}.small{font-size:13px;line-height:1.5}.full{grid-column:1/-1}@media(max-width:760px){.grid{grid-template-columns:1fr}.shell{padding:12px}}
</style>
</head>
<body><main class="shell">
<div class="hero"><h1>Mkety Trading Launch Console</h1><p class="muted">One page for Mkety admin provisioning, enterprise owner setup, source-to-destination routing, MTProto wiring, AI formatting, domains, risk visibility, and audit testing.</p><div><span class="pill ${tradingAccess ? 'ok' : 'danger'}">TRADING_ACCESS_ENABLED=${tradingAccess}</span><span class="pill ${broker ? 'danger' : 'ok'}">BROKER_EXECUTION_ENABLED=${broker}</span><span class="pill ${customDomains ? 'ok' : ''}">TRADING_CUSTOM_HOSTNAMES_ENABLED=${customDomains}</span></div></div>
<div class="grid">
${card('Mkety Admin Access Codes', `<p class="small">For Mkety staff only. Create/list enterprise owner access codes using <code>MKETY_TRADING_ADMIN_SECRET</code>. The plain access code is shown once; only the hash is stored.</p><div class="code">GET  /api/v1/mkety-admin/access-codes\nPOST /api/v1/mkety-admin/access-codes</div>`)}
${card('Enterprise Owner Workspace', `<p class="small">Enterprise customers redeem one access code, receive a short-lived local Trading bearer, then manage only their exact workspace.</p><div class="code">POST /api/v1/access/redeem\nGET  /api/v1/admin/workspace\nGET  /api/v1/admin/members</div>`)}
${card('Sources', `<p class="small">Sources are where signals enter: Telegram MTProto, TradingView webhook, MT5/cTrader source bridges, or custom signed API.</p><span class="pill">external_mtproto</span><span class="pill">cloudflare_container_mtproto</span><span class="pill">cloudflare_do_mtproto</span><span class="pill">tradingview_webhook</span><span class="pill">mt5_source_bridge</span><span class="pill">ctrader_source</span><span class="pill">custom_signed_api</span><div class="code">/api/v1/admin/sources\n/api/v1/internal/source-event</div>`)}
${card('Destinations', `<p class="small">Destinations are where processed signals go. V1 supports Telegram destination setup, broker-account target records, internal webhook, audit-only destinations, and explicit source-to-destination routes.</p><div class="code">/api/v1/admin/destinations\n/api/v1/admin/routes</div>`)}
${card('AI Formatting', `<p class="small">AI is allowed to change presentation only. It must not change symbol, side, entry, stop loss, take profits, volume, risk, or management action. Fallback formatting remains deterministic.</p><span class="pill">none</span><span class="pill">clean</span><span class="pill">template</span><span class="pill">ai_then_fallback</span><div class="code">/api/v1/admin/templates</div>`)}
${card('MTProto Setup', `<p class="small"><b>External VM:</b> no Telegram credentials in Mkety. Mkety gives source ID, handoff URL, payload example, and signing/internal token name. <b>Container/DO:</b> Mkety hosts the listener and requires encrypted Telegram credentials.</p><div class="code">External VM → /api/v1/internal/source-event\nContainer/DO → SOURCE_EVENT_QUEUE + recovery cron</div>`)}
${card('Domains', `<p class="small">Canonical app host is <b>trade.mkety.com</b>. Customer hostnames are routing context only and must match the exact workspace after verification. They do not grant access by themselves.</p><div class="code">/api/v1/admin/hostnames</div>`)}
${card('Risk Inventory', `<p class="small">Current risk controls include account inactive default, execution disabled default, kill switch on default, allowed symbols, max lots, max risk percent, daily loss limit, max open risk, duplicate prevention, broker global fuse, and broker-side authority checks.</p><div class="code">Fixed lots | Risk percent | Fixed risk\nMarket | Limit | Stop | Stop-limit\nFast signal | Full signal | Management updates</div>`)}
${card('Operations & Audit', `<p class="small">Use audit to see exactly where each test stops: source receive, parse, route, format, destination delivery, broker blocked, retry, or failure class.</p><div class="code">/api/v1/admin/operations\n/api/v1/admin/events/{eventId}/audit</div>`)}
<section class="card full"><h2>Safe Testing Rule</h2><p class="small">This launch console is for end-to-end setup testing while broker execution remains disabled. Do not enable <code>BROKER_EXECUTION_ENABLED=true</code> until separate demo broker acceptance and live execution approval are complete.</p></section>
</div>
</main></body></html>`;
}
