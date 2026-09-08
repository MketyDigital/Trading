export function renderMketyAdminAccessCodesPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mkety Staff Access Codes</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef4ff;background:#07111f}
    body{margin:0;background:#07111f;color:#eef4ff}.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 64px}
    h1{margin:0 0 8px;font-size:32px}.muted{color:#9fb2cc}.card{background:#0c1a2c;border:1px solid #203a59;border-radius:16px;padding:20px;margin-top:20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.field{display:flex;flex-direction:column;gap:6px}
    label{font-size:13px;color:#b9c9dd}input,select{background:#081522;color:#eef4ff;border:1px solid #2b496b;border-radius:10px;padding:10px 12px}
    button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#38a3ff;color:#04101c}.secondary{background:#17304b;color:#eef4ff}.danger{background:#8f3141;color:white}
    .checks{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.checks label{display:flex;align-items:center;gap:7px;background:#0a1727;border:1px solid #203a59;border-radius:10px;padding:9px 11px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:11px 9px;border-bottom:1px solid #203a59;vertical-align:top}th{font-size:12px;color:#9fb2cc;text-transform:uppercase;letter-spacing:.04em}
    .once{margin-top:14px;padding:13px;border-radius:10px;background:#0d2b20;border:1px solid #27694e;display:none;word-break:break-all}.error{color:#ff9ca8;margin-top:10px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    code{background:#091624;padding:2px 5px;border-radius:5px}
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Mkety Staff Access Codes</h1>
    <p class="muted">Create, review, and revoke Trading workspace access codes. New plaintext codes are shown once after creation and are never returned by list/revoke operations.</p>

    <section class="card">
      <div class="field">
        <label for="staffSecret">Mkety staff secret (memory only)</label>
        <input id="staffSecret" type="password" autocomplete="off" placeholder="Enter staff secret for this page session" />
      </div>
      <div class="toolbar"><button class="secondary" id="refreshBtn" type="button">Refresh access codes</button></div>
      <div id="pageError" class="error" role="alert"></div>
    </section>

    <section class="card">
      <h2>Create access code</h2>
      <div class="grid">
        <div class="field"><label for="ownerEmail">Owner email</label><input id="ownerEmail" type="email" /></div>
        <div class="field"><label for="ownerName">Owner name</label><input id="ownerName" /></div>
        <div class="field"><label for="workspaceName">Workspace name</label><input id="workspaceName" /></div>
        <div class="field"><label for="expiresAt">Expires at</label><input id="expiresAt" type="datetime-local" /></div>
      </div>
      <div class="checks">
        <label><input id="tradingExecutionDestination" type="checkbox" checked /> Trading execution destination</label>
        <label><input id="telegramDestination" type="checkbox" /> Telegram destination</label>
        <label><input id="customSubdomain" type="checkbox" /> Custom subdomain</label>
        <label><input id="customHostname" type="checkbox" /> Custom hostname</label>
      </div>
      <div class="toolbar">
        <button class="secondary preset" type="button" data-preset="trading">Trading Only</button>
        <button class="secondary preset" type="button" data-preset="tradingTelegram">Trading + Telegram</button>
        <button class="secondary preset" type="button" data-preset="full">Full Access</button>
        <button id="createBtn" type="button">Create access code</button>
      </div>
      <div id="plainCode" class="once"></div>
    </section>

    <section class="card">
      <h2>Issued access codes</h2>
      <p class="muted">API: <code>/api/v1/mkety-admin/access-codes</code></p>
      <table>
        <thead><tr><th>Workspace</th><th>Owner</th><th>Status</th><th>Entitlements</th><th>Expires</th><th>Action</th></tr></thead>
        <tbody id="rows"><tr><td colspan="6" class="muted">Enter the staff secret and refresh.</td></tr></tbody>
      </table>
    </section>
  </main>
<script>
(() => {
  const API = '/api/v1/mkety-admin/access-codes';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const staffHeaders = (json = false) => {
    const headers = { 'X-Mkety-Admin-Secret': $('staffSecret').value };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  };
  const setError = (msg = '') => { $('pageError').textContent = msg; };
  const entitlementSummary = (ent = {}) => {
    const items = [];
    if (ent.tradingExecutionDestination) items.push('Trading execution');
    if (ent.telegramDestination || (Array.isArray(ent.destinations) && ent.destinations.includes('telegram'))) items.push('Telegram');
    if (ent.customSubdomain) items.push('Subdomain');
    if (ent.customHostname) items.push('Hostname');
    return items.length ? items.join(', ') : 'Restricted';
  };
  async function request(path, options = {}) {
    const response = await fetch(path, options);
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok || !body.ok) throw new Error(body.reason || ('HTTP ' + response.status));
    return body;
  }
  async function refresh() {
    setError();
    try {
      const body = await request(API, { headers: staffHeaders() });
      const rows = body.accessCodes || [];
      $('rows').innerHTML = rows.length ? rows.map((item) => '<tr>' +
        '<td>' + esc(item.workspaceDisplayName || item.workspaceId) + '</td>' +
        '<td>' + esc(item.ownerEmail || '') + '</td>' +
        '<td>' + esc(item.status || '') + '</td>' +
        '<td>' + esc(entitlementSummary(item.entitlements)) + '</td>' +
        '<td>' + esc(item.expiresAt || '') + '</td>' +
        '<td>' + (item.status === 'active' ? '<button class="danger revoke" data-id="' + esc(item.id) + '" type="button">Revoke</button>' : '') + '</td>' +
      '</tr>').join('') : '<tr><td colspan="6" class="muted">No access codes.</td></tr>';
    } catch (error) { setError(error.message); }
  }
  function applyPreset(name) {
    const full = name === 'full';
    $('tradingExecutionDestination').checked = true;
    $('telegramDestination').checked = name === 'tradingTelegram' || full;
    $('customSubdomain').checked = full;
    $('customHostname').checked = full;
  }
  async function createCode() {
    setError(); $('plainCode').style.display = 'none'; $('plainCode').textContent = '';
    const expiresValue = $('expiresAt').value;
    const payload = {
      ownerEmail: $('ownerEmail').value,
      ownerName: $('ownerName').value,
      workspaceName: $('workspaceName').value,
      expiresAt: expiresValue ? new Date(expiresValue).toISOString() : undefined,
      entitlements: {
        tradingExecutionDestination: $('tradingExecutionDestination').checked,
        telegramDestination: $('telegramDestination').checked,
        customSubdomain: $('customSubdomain').checked,
        customHostname: $('customHostname').checked,
        destinations: [
          ...($('tradingExecutionDestination').checked ? ['trading_execution'] : []),
          ...($('telegramDestination').checked ? ['telegram'] : []),
          'audit_only'
        ],
        sourceTypes: ['telegram', 'tradingview'], brokerModes: ['demo'], liveExecution: false, maxTeamMembers: 1
      }
    };
    try {
      const body = await request(API, { method: 'POST', headers: staffHeaders(true), body: JSON.stringify(payload) });
      $('plainCode').textContent = 'Shown once — copy now: ' + body.accessCode.plainCode;
      $('plainCode').style.display = 'block';
      await refresh();
    } catch (error) { setError(error.message); }
  }
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('refreshBtn').addEventListener('click', refresh);
  $('createBtn').addEventListener('click', createCode);
  $('rows').addEventListener('click', async (event) => {
    const button = event.target.closest('.revoke'); if (!button) return;
    setError();
    try { await request(API + '/' + encodeURIComponent(button.dataset.id) + '/revoke', { method: 'POST', headers: staffHeaders() }); await refresh(); }
    catch (error) { setError(error.message); }
  });
})();
</script>
</body>
</html>`;
}
