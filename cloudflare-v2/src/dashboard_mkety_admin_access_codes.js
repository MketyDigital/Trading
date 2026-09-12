export function renderMketyAdminAccessCodesPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mkety Staff Trading Admin</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef4ff;background:#07111f}
    body{margin:0;background:#07111f;color:#eef4ff}.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 64px}
    h1{margin:0 0 8px;font-size:32px}h2{margin:0 0 8px}.muted{color:#9fb2cc}.card{background:#0c1a2c;border:1px solid #203a59;border-radius:16px;padding:20px;margin-top:20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.field{display:flex;flex-direction:column;gap:6px}
    label{font-size:13px;color:#b9c9dd}input,select{background:#081522;color:#eef4ff;border:1px solid #2b496b;border-radius:10px;padding:10px 12px}
    button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#38a3ff;color:#04101c}.secondary{background:#17304b;color:#eef4ff}.danger{background:#8f3141;color:white}.success{background:#1c7d53;color:white}
    .checks{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.checks label{display:flex;align-items:center;gap:7px;background:#0a1727;border:1px solid #203a59;border-radius:10px;padding:9px 11px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:11px 9px;border-bottom:1px solid #203a59;vertical-align:top}th{font-size:12px;color:#9fb2cc;text-transform:uppercase;letter-spacing:.04em}
    .once{margin-top:14px;padding:13px;border-radius:10px;background:#0d2b20;border:1px solid #27694e;display:none;word-break:break-all}.error{color:#ff9ca8;margin-top:10px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    code{background:#091624;padding:2px 5px;border-radius:5px}.status{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.pill{padding:7px 10px;border-radius:999px;background:#15283e;border:1px solid #294765;font-size:13px}.warning{padding:12px;border-radius:10px;background:#2c2410;border:1px solid #725a1e;color:#ffe5a6}.okbox{padding:12px;border-radius:10px;background:#0d2b20;border:1px solid #27694e;color:#b9f4d6}
    .control-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:16px}.control{background:#081522;border:1px solid #203a59;border-radius:14px;padding:16px}.control h3{margin:0 0 6px}.control .state{font-weight:800;margin-top:10px}.state-on{color:#8ef0bd}.state-off{color:#ffb2bb}
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Mkety Staff Trading Admin</h1>
    <p class="muted">Manage Trading owner access and global runtime safety controls. Changes below are stored in the database and take effect without a redeploy. The staff secret stays only in memory for this page session.</p>

    <section class="card">
      <div class="field">
        <label for="staffSecret">Mkety Trading admin secret (memory only)</label>
        <input id="staffSecret" type="password" autocomplete="off" placeholder="Enter MKETY_TRADING_ADMIN_SECRET" />
      </div>
      <div class="toolbar"><button class="secondary" id="refreshBtn" type="button">Refresh admin state</button></div>
      <div id="pageError" class="error" role="alert"></div>
    </section>

    <section class="card">
      <h2>Global runtime controls</h2>
      <p class="muted">These are the platform-wide safety switches. Account-level Active, Execution and Kill Switch controls remain separate inside each enterprise workspace.</p>
      <div class="control-grid">
        <div class="control">
          <h3>Trading system</h3>
          <p class="muted">Master switch for V1 signal ingestion and trading operations. Turn OFF to stop trading operations platform-wide.</p>
          <div id="tradingSystemStatus" class="state">State: unknown</div>
          <div class="toolbar">
            <button class="danger" id="disableTradingBtn" type="button">Turn trading system OFF</button>
            <button class="success" id="enableTradingBtn" type="button">Turn trading system ON</button>
          </div>
        </div>
        <div class="control">
          <h3>Broker execution</h3>
          <p class="muted">Master broker-dispatch switch. Even when ON, workspace, account, route, symbol, risk and kill-switch rules must still pass.</p>
          <div id="brokerStatus" class="state">State: unknown</div>
          <div class="toolbar">
            <button class="danger" id="disableBrokerBtn" type="button">Turn broker execution OFF</button>
            <button class="success" id="enableBrokerBtn" type="button">Turn broker execution ON</button>
          </div>
        </div>
        <div class="control">
          <h3>Live broker execution</h3>
          <p class="muted">Extra real-money safety lock. Keep OFF during demo acceptance. Demo accounts do not require this live-money switch.</p>
          <div id="liveBrokerStatus" class="state">State: unknown</div>
          <div class="toolbar">
            <button class="danger" id="disableLiveBtn" type="button">Turn live execution OFF</button>
            <button class="success" id="enableLiveBtn" type="button">Turn live execution ON</button>
          </div>
        </div>
      </div>
      <div class="status">
        <span class="pill" id="effectiveStatus">Effective broker execution: unknown</span>
        <span class="pill" id="effectiveLiveStatus">Effective live execution: unknown</span>
      </div>
      <div id="brokerSafetyMessage" class="warning">Enter the admin secret and refresh before changing controls.</div>
    </section>

    <section class="card">
      <h2>Create or reissue access code</h2>
      <p class="muted">Leave Existing workspace ID blank for a new customer. For a returning owner on a new browser/device, paste their existing workspace ID to issue a replacement one-time code without creating another workspace.</p>
      <div class="grid">
        <div class="field"><label for="ownerEmail">Owner email</label><input id="ownerEmail" type="email" /></div>
        <div class="field"><label for="ownerName">Owner name</label><input id="ownerName" /></div>
        <div class="field"><label for="workspaceName">Workspace name</label><input id="workspaceName" /></div>
        <div class="field"><label for="workspaceId">Existing workspace ID (optional)</label><input id="workspaceId" placeholder="Reuse only for access reissue" /></div>
        <div class="field"><label for="expiresAt">Code expires at</label><input id="expiresAt" type="datetime-local" /></div>
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
      <p class="muted">Use Reissue to prepare the form for the same workspace. Plaintext codes are shown only once.</p>
      <table>
        <thead><tr><th>Workspace</th><th>Owner</th><th>Status</th><th>Entitlements</th><th>Expires</th><th>Action</th></tr></thead>
        <tbody id="rows"><tr><td colspan="6" class="muted">Enter the staff secret and refresh.</td></tr></tbody>
      </table>
    </section>
  </main>
<script>
(() => {
  const API = '/api/v1/mkety-admin/access-codes';
  const RUNTIME_API = '/api/v1/mkety-admin/runtime-controls';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let accessRows = [];
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
  function stateText(id, enabled) {
    const node = $(id);
    node.textContent = 'State: ' + (enabled ? 'ON' : 'OFF');
    node.className = 'state ' + (enabled ? 'state-on' : 'state-off');
  }
  function renderRuntime(body) {
    const trading = body.tradingAccessEnabled === true;
    const broker = body.brokerExecutionEnabled === true;
    const live = body.liveBrokerExecutionEnabled === true;
    const effective = body.effectiveBrokerExecutionEnabled === true;
    const effectiveLive = body.effectiveLiveBrokerExecutionEnabled === true;
    stateText('tradingSystemStatus', trading);
    stateText('brokerStatus', broker);
    stateText('liveBrokerStatus', live);
    $('effectiveStatus').textContent = 'Effective broker execution: ' + (effective ? 'ON' : 'BLOCKED');
    $('effectiveLiveStatus').textContent = 'Effective live execution: ' + (effectiveLive ? 'ON' : 'BLOCKED');
    $('brokerSafetyMessage').className = effectiveLive ? 'warning' : 'okbox';
    $('brokerSafetyMessage').textContent = effectiveLive
      ? 'LIVE MONEY EXECUTION IS ENABLED. Use only after demo acceptance and explicit production approval.'
      : !trading
        ? 'Trading system is OFF. V1 trading operations are globally blocked.'
        : !broker
          ? 'Trading system is ON, but broker execution is globally blocked.'
          : live
            ? 'Broker execution is ON and live execution is enabled.'
            : 'Demo-ready posture: broker execution can run, while the separate live-money safety lock remains OFF.';
  }
  async function refreshRuntime() {
    const body = await request(RUNTIME_API, { headers: staffHeaders() });
    renderRuntime(body);
  }
  async function setRuntimeControl(field, next, confirmation) {
    setError();
    if (confirmation && !confirm(confirmation)) return;
    try {
      const payload = {}; payload[field] = next;
      const body = await request(RUNTIME_API, { method: 'PATCH', headers: staffHeaders(true), body: JSON.stringify(payload) });
      renderRuntime(body);
    } catch (error) { setError(error.message); }
  }
  async function refreshCodes() {
    const body = await request(API, { headers: staffHeaders() });
    accessRows = body.accessCodes || [];
    $('rows').innerHTML = accessRows.length ? accessRows.map((item) => '<tr>' +
      '<td><b>' + esc(item.workspaceDisplayName || item.workspaceId) + '</b><div class="muted">' + esc(item.workspaceId || '') + '</div></td>' +
      '<td>' + esc(item.ownerEmail || '') + '</td>' +
      '<td>' + esc(item.status || '') + '</td>' +
      '<td>' + esc(entitlementSummary(item.entitlements)) + '</td>' +
      '<td>' + esc(item.expiresAt || '') + '</td>' +
      '<td><div class="toolbar"><button class="secondary reissue" data-id="' + esc(item.id) + '" type="button">Reissue</button>' + (item.status === 'active' ? '<button class="danger revoke" data-id="' + esc(item.id) + '" type="button">Revoke</button>' : '') + '</div></td>' +
    '</tr>').join('') : '<tr><td colspan="6" class="muted">No access codes.</td></tr>';
  }
  async function refresh() {
    setError();
    try { await Promise.all([refreshCodes(), refreshRuntime()]); }
    catch (error) { setError(error.message); }
  }
  function applyPreset(name) {
    const full = name === 'full';
    $('tradingExecutionDestination').checked = true;
    $('telegramDestination').checked = name === 'tradingTelegram' || full;
    $('customSubdomain').checked = full;
    $('customHostname').checked = full;
  }
  function applyEntitlements(ent = {}) {
    $('tradingExecutionDestination').checked = ent.tradingExecutionDestination === true;
    $('telegramDestination').checked = ent.telegramDestination === true || (Array.isArray(ent.destinations) && ent.destinations.includes('telegram'));
    $('customSubdomain').checked = ent.customSubdomain === true;
    $('customHostname').checked = ent.customHostname === true;
  }
  function prepareReissue(id) {
    const item = accessRows.find((x) => String(x.id) === String(id));
    if (!item) return;
    $('ownerEmail').value = item.ownerEmail || '';
    $('ownerName').value = item.ownerName || '';
    $('workspaceName').value = item.workspaceDisplayName || '';
    $('workspaceId').value = item.workspaceId || '';
    $('expiresAt').value = '';
    applyEntitlements(item.entitlements || {});
    $('plainCode').style.display = 'none';
    window.scrollTo({ top: $('ownerEmail').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
  }
  async function createCode() {
    setError(); $('plainCode').style.display = 'none'; $('plainCode').textContent = '';
    const expiresValue = $('expiresAt').value;
    const payload = {
      ownerEmail: $('ownerEmail').value,
      ownerName: $('ownerName').value,
      workspaceName: $('workspaceName').value,
      workspaceId: $('workspaceId').value.trim() || undefined,
      expiresAt: expiresValue ? new Date(expiresValue).toISOString() : undefined,
      entitlements: {
        tradingExecutionDestination: $('tradingExecutionDestination').checked,
        telegramDestination: $('telegramDestination').checked,
        customSubdomain: $('customSubdomain').checked,
        customHostname: $('customHostname').checked,
        destinations: [
          ...($('tradingExecutionDestination').checked ? ['broker_account'] : []),
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
      await refreshCodes();
    } catch (error) { setError(error.message); }
  }
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('refreshBtn').addEventListener('click', refresh);
  $('createBtn').addEventListener('click', createCode);
  $('disableTradingBtn').addEventListener('click', () => setRuntimeControl('tradingAccessEnabled', false, 'Turn the entire V1 trading system OFF? This blocks trading operations platform-wide.'));
  $('enableTradingBtn').addEventListener('click', () => setRuntimeControl('tradingAccessEnabled', true, 'Turn the V1 trading system ON?'));
  $('disableBrokerBtn').addEventListener('click', () => setRuntimeControl('brokerExecutionEnabled', false, 'Turn all broker execution OFF?'));
  $('enableBrokerBtn').addEventListener('click', () => setRuntimeControl('brokerExecutionEnabled', true, 'Enable broker execution? Account, route, risk and kill-switch gates still apply.'));
  $('disableLiveBtn').addEventListener('click', () => setRuntimeControl('liveBrokerExecutionEnabled', false, 'Turn real-money broker execution OFF?'));
  $('enableLiveBtn').addEventListener('click', () => setRuntimeControl('liveBrokerExecutionEnabled', true, 'HIGH RISK: enable the platform-wide real-money execution lock? Do this only after demo acceptance and explicit production approval.'));
  $('rows').addEventListener('click', async (event) => {
    const reissue = event.target.closest('.reissue');
    if (reissue) { prepareReissue(reissue.dataset.id); return; }
    const button = event.target.closest('.revoke'); if (!button) return;
    setError();
    try { await request(API + '/' + encodeURIComponent(button.dataset.id) + '/revoke', { method: 'POST', headers: staffHeaders() }); await refreshCodes(); }
    catch (error) { setError(error.message); }
  });
})();
</script>
</body>
</html>`;
}
