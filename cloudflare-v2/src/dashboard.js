export function renderDashboard(env) {
    const configuredAI = {
        gemini: !!env.GEMINI_API_KEY,
        openai: !!env.OPENAI_API_KEY,
        cloudflare: !!env.CLOUDFLARE_ACCOUNT_ID
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mkety SaaS | Control Center</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    
    <style>
        body { 
            font-family: 'Plus Jakarta Sans', sans-serif; 
            background-color: #fcfbf9; 
            color: #1e1b18; 
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.25s ease-out forwards; }
    </style>
</head>
<body class="min-h-screen">
    <div id="root"></div>

    <script>
        window.ENV = {
            AI: ${JSON.stringify(configuredAI)}
        };
    </script>

    <script type="text/babel">
        const { useState, useEffect } = React;
        
        // Database Proxy Client
        const dbProxy = async (table, action, match = {}, payload = {}) => {
            try {
                const res = await fetch('/api/admin/data/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table, action, match, payload })
                });
                return await res.json();
            } catch (err) {
                console.error("DB Proxy Error:", err);
                return [];
            }
        };

        // Custom React hook to fetch and sync table data from Proxy
        const useData = (table) => {
            const [data, setData] = useState([]);
            const [loading, setLoading] = useState(true);

            const load = async () => {
                const res = await dbProxy(table, 'select');
                if (Array.isArray(res)) setData(res);
                setLoading(false);
            };

            useEffect(() => {
                load();
            }, [table]);

            return { data, loading, refetch: load };
        };

        const Icon = ({ name, size = 18, className = '' }) => {
            const iconRef = React.useRef();
            useEffect(() => {
                if (iconRef.current && window.lucide && window.lucide.icons[name]) {
                    const svgNode = window.lucide.createElement(window.lucide.icons[name]);
                    svgNode.setAttribute('width', size);
                    svgNode.setAttribute('height', size);
                    svgNode.setAttribute('class', className);
                    iconRef.current.innerHTML = '';
                    iconRef.current.appendChild(svgNode);
                }
            }, [name, size, className]);
            return <span ref={iconRef} className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }} />;
        };

        const StatCard = ({ title, value, icon, subtitle }) => (
            <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm flex items-center justify-between">
                <div>
                    <span className="text-xs font-semibold text-[#706453] uppercase tracking-wider block mb-1">{title}</span>
                    <div className="text-3xl font-bold text-[#1e1b18]">{value}</div>
                    {subtitle && <p className="text-xs text-[#a59984] mt-1">{subtitle}</p>}
                </div>
                <div className="bg-[#f5f3ef] p-3 rounded-lg text-[#1e1b18]">
                    <Icon name={icon} size={22} />
                </div>
            </div>
        );

        // 1. WORKSPACES VIEW (Tenants & Bot Setup with 1-Click Webhook)
        const WorkspacesView = ({ selectedWorkspaceId, setSelectedWorkspaceId }) => {
            const [workspaces, setWorkspaces] = useState([]);
            const [isAdding, setIsAdding] = useState(false);
            const [editingId, setEditingId] = useState(null);
            const [form, setForm] = useState({ name: '', owner_email: '', tg_bot_token: '', tg_admin_chat_id: '', tg_vip_chat_id: '' });
            const [authStatus, setAuthStatus] = useState({});

            const fetchWorkspaces = async () => {
                const res = await dbProxy('workspaces', 'select');
                if (Array.isArray(res)) setWorkspaces(res);
            };

            useEffect(() => { fetchWorkspaces(); }, []);

            const handleSubmit = async (e) => {
                e.preventDefault();
                if (editingId) {
                    await dbProxy('workspaces', 'update', { id: editingId }, form);
                } else {
                    await dbProxy('workspaces', 'insert', {}, form);
                }
                setIsAdding(false);
                setEditingId(null);
                setForm({ name: '', owner_email: '', tg_bot_token: '', tg_admin_chat_id: '', tg_vip_chat_id: '' });
                fetchWorkspaces();
            };

            const handleEdit = (ws) => {
                setForm({
                    name: ws.name,
                    owner_email: ws.owner_email,
                    tg_bot_token: ws.tg_bot_token || '',
                    tg_admin_chat_id: ws.tg_admin_chat_id || '',
                    tg_vip_chat_id: ws.tg_vip_chat_id || ''
                });
                setEditingId(ws.id);
                setIsAdding(true);
            };

            const handleDelete = async (id) => {
                if (confirm("Are you sure you want to delete this tenant?")) {
                    await dbProxy('workspaces', 'delete', { id });
                    fetchWorkspaces();
                }
            };

            const authorizeBot = async (ws) => {
                if (!ws.tg_bot_token) return alert("Please specify a Bot Token first.");
                setAuthStatus(prev => {
                    const next = { ...prev };
                    next[ws.id] = 'loading';
                    return next;
                });
                try {
                    const res = await fetch('/api/admin/bot/authorize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workspace_id: ws.id, bot_token: ws.tg_bot_token })
                    });
                    const data = await res.json();
                    if (data.success) {
                        setAuthStatus(prev => {
                            const next = { ...prev };
                            next[ws.id] = 'success';
                            return next;
                        });
                        alert("✅ Webhook Authorized successfully! Telegram Bot is now connected to Mkety SaaS.");
                    } else {
                        setAuthStatus(prev => {
                            const next = { ...prev };
                            next[ws.id] = 'error';
                            return next;
                        });
                        alert("❌ Authorization failed: " + (data.error || 'Unknown error'));
                    }
                } catch (err) {
                    setAuthStatus(prev => {
                        const next = { ...prev };
                        next[ws.id] = 'error';
                        return next;
                    });
                    alert("❌ Connection Error.");
                }
            };

            return (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">SaaS Tenants & Bot Authorization</h2>
                            <p className="text-sm text-[#706453]">Register workspaces, input custom Telegram Bots, and activate 1-click webhook listeners.</p>
                        </div>
                        <button onClick={() => { setIsAdding(!isAdding); setEditingId(null); setForm({ name: '', owner_email: '', tg_bot_token: '', tg_admin_chat_id: '', tg_vip_chat_id: '' }); }} className="bg-[#1e1b18] hover:bg-[#3a352e] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                            <Icon name="Plus" size={16} /> {isAdding ? 'Close Panel' : 'Add Tenant'}
                        </button>
                    </div>

                    {isAdding && (
                        <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                            <h3 className="font-bold mb-4 text-[#1e1b18]">{editingId ? 'Edit Workspace' : 'Onboard New Tenant'}</h3>
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Tenant / Brand Name</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Mkety Premium Forex" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Owner Email Address</label>
                                    <input required type="email" className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.owner_email} onChange={e => setForm({...form, owner_email: e.target.value})} placeholder="trader@mkety.com" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Telegram Bot Token (Optional)</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" value={form.tg_bot_token} onChange={e => setForm({...form, tg_bot_token: e.target.value})} placeholder="12345678:AAH_..." />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Telegram Admin Channel ID (Optional)</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" value={form.tg_admin_chat_id} onChange={e => setForm({...form, tg_admin_chat_id: e.target.value})} placeholder="-100123456789" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Telegram VIP Chat/Group ID (Optional)</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" value={form.tg_vip_chat_id} onChange={e => setForm({...form, tg_vip_chat_id: e.target.value})} placeholder="-100987654321" />
                                </div>
                                <div className="md:col-span-2 pt-2">
                                    <button type="submit" className="bg-[#1e1b18] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#3a352e] transition-colors">
                                        {editingId ? 'Update Tenant' : 'Save Tenant'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4">
                        {workspaces.map(ws => (
                            <div key={ws.id} className={"bg-white border rounded-xl p-6 shadow-sm transition-all " + (selectedWorkspaceId === ws.id ? 'border-[#1e1b18] ring-1 ring-[#1e1b18]' : 'border-[#e9e6df]')}>
                                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <h4 className="font-bold text-lg">{ws.name}</h4>
                                            <span className="text-[10px] font-bold tracking-wider bg-[#f5f3ef] text-[#706453] px-2 py-0.5 rounded uppercase">ID: {ws.id.slice(0,8)}</span>
                                        </div>
                                        <p className="text-xs text-[#706453] mt-0.5">{ws.owner_email}</p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button onClick={() => setSelectedWorkspaceId(ws.id)} className={"text-xs font-semibold px-3 py-1.5 rounded-lg transition-all " + (selectedWorkspaceId === ws.id ? 'bg-[#1e1b18] text-white' : 'bg-[#f5f3ef] text-[#1e1b18] hover:bg-[#e9e6df]')}>
                                            {selectedWorkspaceId === ws.id ? 'Selected' : 'Select Workspace'}
                                        </button>
                                        <button onClick={() => handleEdit(ws)} className="p-1.5 border border-[#e9e6df] rounded-lg text-[#706453] hover:text-[#1e1b18] hover:bg-[#fcfbf9]">
                                            <Icon name="Edit" size={14} />
                                        </button>
                                        <button onClick={() => handleDelete(ws.id)} className="p-1.5 border border-[#e9e6df] rounded-lg text-red-600 hover:bg-red-50">
                                            <Icon name="Trash2" size={14} />
                                        </button>
                                        <button onClick={() => authorizeBot(ws)} className={"text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 " + (authStatus[ws.id] === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700 hover:bg-blue-100')}>
                                            <Icon name="Radio" size={12} />
                                            {authStatus[ws.id] === 'loading' ? 'Authorizing...' : authStatus[ws.id] === 'success' ? 'Authorized ✓' : 'Authorize Webhook'}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#f5f3ef] text-xs">
                                    <div>
                                        <span className="text-[#a59984] font-medium block">Bot Token</span>
                                        <span className="font-mono text-[#5c5346] truncate block">{ws.tg_bot_token || 'None provided'}</span>
                                    </div>
                                    <div>
                                        <span className="text-[#a59984] font-medium block">Admin Chat ID</span>
                                        <span className="font-mono text-[#5c5346] block">{ws.tg_admin_chat_id || 'None provided'}</span>
                                    </div>
                                    <div>
                                        <span className="text-[#a59984] font-medium block">VIP Chat ID</span>
                                        <span className="font-mono text-[#5c5346] block">{ws.tg_vip_chat_id || 'None provided'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        // 2. SIGNAL ROUTES VIEW (Source to Destination Mapping)
        const SignalRoutesView = ({ workspaceId }) => {
            const [routes, setRoutes] = useState([]);
            const [isAdding, setIsAdding] = useState(false);
            const [editingId, setEditingId] = useState(null);
            const [form, setForm] = useState({ route_name: '', source_chat_id: '', destination_chat_id: '', destination_type: 'telegram_vip', custom_footer: '~~~ \\n<b>Mkety AI Signal Hub</b>', transform_ai: true, route_settings: { single_entry: false, custom_prompt: '' } });

            const fetchRoutes = async () => {
                if (!workspaceId) return;
                const res = await dbProxy('signal_routes', 'select');
                if (Array.isArray(res)) {
                    setRoutes(res.filter(r => r.workspace_id === workspaceId));
                }
            };

            useEffect(() => { fetchRoutes(); }, [workspaceId]);

            const handleSubmit = async (e) => {
                e.preventDefault();
                const payload = { ...form, workspace_id: workspaceId };
                if (editingId) {
                    await dbProxy('signal_routes', 'update', { id: editingId }, payload);
                } else {
                    await dbProxy('signal_routes', 'insert', {}, payload);
                }
                setIsAdding(false);
                setEditingId(null);
                setForm({ route_name: '', source_chat_id: '', destination_chat_id: '', destination_type: 'telegram_vip', custom_footer: '~~~ \\n<b>Mkety AI Signal Hub</b>', transform_ai: true, route_settings: { single_entry: false, custom_prompt: '' } });
                fetchRoutes();
            };

            const handleEdit = (route) => {
                setForm({
                    route_name: route.route_name,
                    source_chat_id: route.source_chat_id,
                    destination_chat_id: route.destination_chat_id || '',
                    destination_type: route.destination_type,
                    custom_footer: route.custom_footer || '',
                    transform_ai: !!route.transform_ai,
                    route_settings: route.route_settings || { single_entry: false, custom_prompt: '' }
                });
                setEditingId(route.id);
                setIsAdding(true);
            };

            const handleDelete = async (id) => {
                if (confirm("Delete this route mapping?")) {
                    await dbProxy('signal_routes', 'delete', { id });
                    fetchRoutes();
                }
            };

            if (!workspaceId) return <div className="p-8 text-center text-[#706453]">⚠️ Please select an active Workspace/Tenant above to manage signal routes.</div>;

            return (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">Signal Route Mappings</h2>
                            <p className="text-sm text-[#706453]">Connect source Channels (via Webhook/MTProto) directly to copier engines and customize branding or prompts.</p>
                        </div>
                        <button onClick={() => { setIsAdding(!isAdding); setEditingId(null); }} className="bg-[#1e1b18] hover:bg-[#3a352e] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                            <Icon name="Plus" size={16} /> {isAdding ? 'Close Panel' : 'New Route Mapping'}
                        </button>
                    </div>

                    {isAdding && (
                        <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                            <h3 className="font-bold mb-4 text-[#1e1b18]">{editingId ? 'Edit Mapping' : 'Create Route'}</h3>
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Route Label</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.route_name} onChange={e => setForm({...form, route_name: e.target.value})} placeholder="e.g. VIP Forex Copy Trading" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Source Chat/Channel ID</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono" value={form.source_chat_id} onChange={e => setForm({...form, source_chat_id: e.target.value})} placeholder="e.g. -1004561234" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Destination Type</label>
                                    <select className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.destination_type} onChange={e => setForm({...form, destination_type: e.target.value})}>
                                        <option value="telegram_vip">Telegram VIP Channel Forwarding</option>
                                        <option value="deriv_ws">Deriv Direct Copy-Trading (WS)</option>
                                        <option value="ctrader_ws">cTrader Direct Copy-Trading (WS)</option>
                                        <option value="mt5_webhook">MT5 Webhook Copier Execution</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Destination Chat ID (Optional/Telegram)</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono" value={form.destination_chat_id} onChange={e => setForm({...form, destination_chat_id: e.target.value})} placeholder="e.g. -1009876543" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Custom Brand Footer / Copy signature</label>
                                    <textarea className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" rows="2" value={form.custom_footer} onChange={e => setForm({...form, custom_footer: e.target.value})} />
                                </div>
                                <div>
                                    <label className="flex items-center gap-2 mt-4 cursor-pointer">
                                        <input type="checkbox" checked={form.transform_ai} onChange={e => setForm({...form, transform_ai: e.target.checked})} className="rounded text-[#1e1b18] focus:ring-[#1e1b18]" />
                                        <span className="text-sm font-semibold text-[#1e1b18]">Transform and Format via Mkety AI</span>
                                    </label>
                                </div>
                                <div>
                                    <label className="flex items-center gap-2 mt-4 cursor-pointer">
                                        <input type="checkbox" checked={form.route_settings.single_entry} onChange={e => setForm({...form, route_settings: { ...form.route_settings, single_entry: e.target.checked } })} className="rounded text-[#1e1b18] focus:ring-[#1e1b18]" />
                                        <span className="text-sm font-semibold text-[#1e1b18]">Single Entry Zone Mode (Strip Range to Single Price)</span>
                                    </label>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Custom Route AI System Prompt (Bypasses Global Master Prompt)</label>
                                    <textarea className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-sans text-xs" rows="3" value={form.route_settings.custom_prompt} onChange={e => setForm({...form, route_settings: { ...form.route_settings, custom_prompt: e.target.value } })} placeholder="e.g. Extract only BUY setups, translate SL/TP labels to German..." />
                                </div>
                                <div className="md:col-span-2 pt-2">
                                    <button type="submit" className="bg-[#1e1b18] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#3a352e] transition-colors">
                                        {editingId ? 'Update Mapping' : 'Save Mapping'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-[#e9e6df] bg-[#f5f3ef] text-[#706453] text-xs font-bold uppercase tracking-wider">
                                    <th className="px-6 py-4">Route Name</th>
                                    <th className="px-6 py-4">Source ID</th>
                                    <th className="px-6 py-4">Destination Target</th>
                                    <th className="px-6 py-4">AI Filter</th>
                                    <th className="px-6 py-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e9e6df]">
                                {routes.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-8 text-center text-[#706453]">No mapping routes defined for this workspace.</td></tr>
                                ) : routes.map(route => (
                                    <tr key={route.id} className="hover:bg-[#fcfbf9] transition-colors">
                                        <td className="px-6 py-4 font-semibold text-[#1e1b18]">{route.route_name}</td>
                                        <td className="px-6 py-4 font-mono text-xs text-[#706453]">{route.source_chat_id}</td>
                                        <td className="px-6 py-4">
                                            <span className="font-mono text-xs bg-[#f5f3ef] text-[#1e1b18] px-2 py-1 rounded capitalize font-medium">{route.destination_type}</span>
                                            {route.destination_chat_id && <span className="block text-[11px] font-mono text-[#a59984] mt-1">{route.destination_chat_id}</span>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (route.transform_ai ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                                {route.transform_ai ? 'AI Active' : 'Direct Raw'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-2">
                                                <button onClick={() => handleEdit(route)} className="p-1.5 border border-[#e9e6df] rounded-lg text-[#706453] hover:text-[#1e1b18]">
                                                    <Icon name="Edit" size={14} />
                                                </button>
                                                <button onClick={() => handleDelete(route.id)} className="p-1.5 border border-[#e9e6df] rounded-lg text-red-600 hover:bg-red-50">
                                                    <Icon name="Trash2" size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        // 3. TRADE ACCOUNTS VIEW (Broker Keys & Risk Settings)
        const TradeAccountsView = ({ workspaceId }) => {
            const [accounts, setAccounts] = useState([]);
            const [isAdding, setIsAdding] = useState(false);
            const [editingId, setEditingId] = useState(null);
            const [form, setForm] = useState({ account_label: '', platform: 'deriv', account_id: '', api_token_encrypted: '', lot_sizing_type: 'fixed', lot_value: 0.01 });

            const fetchAccounts = async () => {
                if (!workspaceId) return;
                const res = await dbProxy('trade_accounts', 'select');
                if (Array.isArray(res)) {
                    setAccounts(res.filter(a => a.workspace_id === workspaceId));
                }
            };

            useEffect(() => { fetchAccounts(); }, [workspaceId]);

            const handleSubmit = async (e) => {
                e.preventDefault();
                const payload = { ...form, workspace_id: workspaceId };
                if (editingId) {
                    await dbProxy('trade_accounts', 'update', { id: editingId }, payload);
                } else {
                    await dbProxy('trade_accounts', 'insert', {}, payload);
                }
                setIsAdding(false);
                setEditingId(null);
                setForm({ account_label: '', platform: 'deriv', account_id: '', api_token_encrypted: '', lot_sizing_type: 'fixed', lot_value: 0.01 });
                fetchAccounts();
            };

            const handleEdit = (acc) => {
                setForm({
                    account_label: acc.account_label,
                    platform: acc.platform,
                    account_id: acc.account_id,
                    api_token_encrypted: acc.api_token_encrypted,
                    lot_sizing_type: acc.lot_sizing_type || 'fixed',
                    lot_value: parseFloat(acc.lot_value) || 0.01
                });
                setEditingId(acc.id);
                setIsAdding(true);
            };

            const handleDelete = async (id) => {
                if (confirm("Delete trade account credentials?")) {
                    await dbProxy('trade_accounts', 'delete', { id });
                    fetchAccounts();
                }
            };

            if (!workspaceId) return <div className="p-8 text-center text-[#706453]">⚠️ Please select an active Workspace/Tenant above to manage copy-trading broker accounts.</div>;

            return (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">Trade broker integrations</h2>
                            <p className="text-sm text-[#706453]">Connect and secure live execution API keys across MetaTrader, Deriv, and cTrader accounts.</p>
                        </div>
                        <button onClick={() => { setIsAdding(!isAdding); setEditingId(null); }} className="bg-[#1e1b18] hover:bg-[#3a352e] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                            <Icon name="Plus" size={16} /> {isAdding ? 'Close Panel' : 'Add Broker Key'}
                        </button>
                    </div>

                    {isAdding && (
                        <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                            <h3 className="font-bold mb-4 text-[#1e1b18]">{editingId ? 'Edit Credentials' : 'Link Trading Account'}</h3>
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Account Label</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.account_label} onChange={e => setForm({...form, account_label: e.target.value})} placeholder="e.g. Real MT5 Standard Account" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Broker Platform</label>
                                    <select className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.platform} onChange={e => setForm({...form, platform: e.target.value})}>
                                        <option value="deriv">Deriv WebSocket Broker</option>
                                        <option value="ctrader">cTrader OpenAPI</option>
                                        <option value="mt5">MT5 EA Webhook Endpoint</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Account / Login ID</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono" value={form.account_id} onChange={e => setForm({...form, account_id: e.target.value})} placeholder="e.g. CR5412586 or 8546112" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">API Token / Private Key (Encrypted)</label>
                                    <input required type="password" className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" value={form.api_token_encrypted} onChange={e => setForm({...form, api_token_encrypted: e.target.value})} placeholder="••••••••••••••••" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Lot Sizing Type</label>
                                    <select className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.lot_sizing_type} onChange={e => setForm({...form, lot_sizing_type: e.target.value})}>
                                        <option value="fixed">Fixed Lot Value</option>
                                        <option value="multiplier">Multiplier Coefficient</option>
                                        <option value="risk_percent">Percent Account Balance Risk</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Lot Sizing Value / Multiplier</label>
                                    <input type="number" step="0.001" min="0.001" required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono" value={form.lot_value} onChange={e => setForm({...form, lot_value: parseFloat(e.target.value) || 0.01})} />
                                </div>
                                <div className="md:col-span-2 pt-2">
                                    <button type="submit" className="bg-[#1e1b18] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#3a352e] transition-colors">
                                        {editingId ? 'Update Credentials' : 'Link Account'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-[#e9e6df] bg-[#f5f3ef] text-[#706453] text-xs font-bold uppercase tracking-wider">
                                    <th className="px-6 py-4">Account Description</th>
                                    <th className="px-6 py-4">Broker Engine</th>
                                    <th className="px-6 py-4">Broker Account ID</th>
                                    <th className="px-6 py-4">Sizing Configuration</th>
                                    <th className="px-6 py-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e9e6df]">
                                {accounts.length === 0 ? (
                                    <tr><td colSpan="5" className="px-6 py-8 text-center text-[#706453]">No broker account keys integrated for this workspace.</td></tr>
                                ) : accounts.map(acc => (
                                    <tr key={acc.id} className="hover:bg-[#fcfbf9] transition-colors">
                                        <td className="px-6 py-4 font-semibold text-[#1e1b18]">{acc.account_label}</td>
                                        <td className="px-6 py-4">
                                            <span className="font-mono text-xs bg-[#f5f3ef] text-[#1e1b18] px-2 py-1 rounded capitalize font-medium">{acc.platform}</span>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-sm text-[#706453]">{acc.account_id}</td>
                                        <td className="px-6 py-4">
                                            <span className="font-mono text-xs text-[#1e1b18] bg-[#fdfdfd] border rounded px-2 py-1 inline-block">
                                                {acc.lot_sizing_type.toUpperCase()}: {acc.lot_value}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-2">
                                                <button onClick={() => handleEdit(acc)} className="p-1.5 border border-[#e9e6df] rounded-lg text-[#706453] hover:text-[#1e1b18]">
                                                    <Icon name="Edit" size={14} />
                                                </button>
                                                <button onClick={() => handleDelete(acc.id)} className="p-1.5 border border-[#e9e6df] rounded-lg text-red-600 hover:bg-red-50">
                                                    <Icon name="Trash2" size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        // 4. VIP MEMBERSHIP VIEW (Subscribers & Status Kicker Engine)
        const VIPMembersView = ({ workspaceId }) => {
            const [members, setMembers] = useState([]);
            const [isAdding, setIsAdding] = useState(false);
            const [form, setForm] = useState({ telegram_id: '', username: '', first_name: '', expires_at: '', subscription_tier: 'monthly', invite_link: '' });

            const fetchMembers = async () => {
                if (!workspaceId) return;
                const res = await dbProxy('vip_members', 'select');
                if (Array.isArray(res)) {
                    setMembers(res.filter(m => m.workspace_id === workspaceId));
                }
            };

            useEffect(() => { fetchMembers(); }, [workspaceId]);

            const handleSubmit = async (e) => {
                e.preventDefault();
                const payload = { 
                    ...form, 
                    workspace_id: workspaceId, 
                    expires_at: new Date(form.expires_at).toISOString(),
                    status: 'active',
                    trial_used: form.subscription_tier === 'trial'
                };
                await dbProxy('vip_members', 'insert', {}, payload);
                setIsAdding(false);
                setForm({ telegram_id: '', username: '', first_name: '', expires_at: '', subscription_tier: 'monthly', invite_link: '' });
                fetchMembers();
            };

            const kickMember = async (id) => {
                if (confirm("Kick member? This updates database to 'expired' and system cron will kick them on next run.")) {
                    await dbProxy('vip_members', 'update', { id }, { status: 'expired' });
                    fetchMembers();
                }
            };

            if (!workspaceId) return <div className="p-8 text-center text-[#706453]">⚠️ Please select an active Workspace/Tenant above to manage VIP subscribers.</div>;

            return (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">VIP Active Members</h2>
                            <p className="text-sm text-[#706453]">Track active subscriber lifecycles, view unique invite keys, and manually provision or revoke access.</p>
                        </div>
                        <button onClick={() => setIsAdding(!isAdding)} className="bg-[#1e1b18] hover:bg-[#3a352e] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                            <Icon name="Plus" size={16} /> {isAdding ? 'Close Panel' : 'Provision User'}
                        </button>
                    </div>

                    {isAdding && (
                        <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                            <h3 className="font-bold mb-4 text-[#1e1b18]">Provision VIP Member Access</h3>
                            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">User Telegram ID (Chat ID)</label>
                                    <input required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono" value={form.telegram_id} onChange={e => setForm({...form, telegram_id: e.target.value})} placeholder="e.g. 5412854" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Telegram Username</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="e.g. johndoe" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">First Name</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} placeholder="John" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Access Tier Package</label>
                                    <select className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.subscription_tier} onChange={e => setForm({...form, subscription_tier: e.target.value})}>
                                        <option value="trial">Free Trial (3 Days)</option>
                                        <option value="monthly">Monthly Subscription</option>
                                        <option value="quarterly">Quarterly Subscription</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Access Expiration Date</label>
                                    <input type="datetime-local" required className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9]" value={form.expires_at} onChange={e => setForm({...form, expires_at: e.target.value})} />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-[#706453] mb-1 block">Assigned Invite Link (Optional)</label>
                                    <input className="w-full text-sm border border-[#e9e6df] rounded-lg p-2.5 bg-[#fcfbf9] font-mono text-xs" value={form.invite_link} onChange={e => setForm({...form, invite_link: e.target.value})} placeholder="https://t.me/+..." />
                                </div>
                                <div className="md:col-span-2 pt-2">
                                    <button type="submit" className="bg-[#1e1b18] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#3a352e] transition-colors">
                                        Provision Now
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-[#e9e6df] bg-[#f5f3ef] text-[#706453] text-xs font-bold uppercase tracking-wider">
                                    <th className="px-6 py-4">Name & Username</th>
                                    <th className="px-6 py-4">Telegram Chat ID</th>
                                    <th className="px-6 py-4">Assigned Invite Code</th>
                                    <th className="px-6 py-4">Expiry date</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e9e6df]">
                                {members.length === 0 ? (
                                    <tr><td colSpan="6" className="px-6 py-8 text-center text-[#706453]">No VIP members active.</td></tr>
                                ) : members.map(m => {
                                    const expiresAt = new Date(m.expires_at);
                                    const isExpired = expiresAt < new Date();
                                    return (
                                        <tr key={m.id} className="hover:bg-[#fcfbf9] transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-[#1e1b18]">{m.first_name || 'Trader'}</div>
                                                {m.username && <span className="text-xs text-[#a59984]">@{m.username}</span>}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs text-[#706453]">{m.telegram_id}</td>
                                            <td className="px-6 py-4 font-mono text-xs text-[#706453] truncate max-w-[150px]" title={m.invite_link}>
                                                {m.invite_link || 'Direct manual'}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                <span className={isExpired ? 'text-red-500 font-semibold' : 'text-[#706453]'}>
                                                    {expiresAt.toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (isExpired || m.status === 'expired' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                                                    {m.status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {m.status === 'active' && (
                                                    <button onClick={() => kickMember(m.id)} className="text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors">
                                                        Revoke & Kick
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        // 5. BANK APPROVALS VIEW (Interactive Receipts Manager)
        const BankApprovalsView = ({ workspaceId }) => {
            const [deposits, setDeposits] = useState([]);
            const [processingId, setProcessingId] = useState(null);

            const fetchDeposits = async () => {
                if (!workspaceId) return;
                const res = await dbProxy('bank_deposits', 'select');
                if (Array.isArray(res)) {
                    setDeposits(res.filter(d => d.workspace_id === workspaceId));
                }
            };

            useEffect(() => { fetchDeposits(); }, [workspaceId]);

            const handleDecision = async (dep, status) => {
                setProcessingId(dep.id);
                try {
                    const res = await fetch('/api/admin/bank/decision', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deposit_id: dep.id, action: status })
                    });
                    const data = await res.json();
                    if (data.success) {
                        alert("✅ Deposit receipt decision recorded successfully!");
                        fetchDeposits();
                    } else {
                        alert("❌ Error: " + (data.error || 'Server error.'));
                    }
                } catch (err) {
                    alert("❌ Connection decision failed.");
                }
                setProcessingId(null);
            };

            if (!workspaceId) return <div className="p-8 text-center text-[#706453]">⚠️ Please select an active Workspace/Tenant above to manage bank transfer receipts.</div>;

            return (
                <div className="space-y-6 animate-fade-in">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Interactive Bank Approval Queue</h2>
                        <p className="text-sm text-[#706453]">Review manual bank transfer receipt screenshots submitted by customers, verify receipt, and activate with 1-click.</p>
                    </div>

                    <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-[#e9e6df] bg-[#f5f3ef] text-[#706453] text-xs font-bold uppercase tracking-wider">
                                    <th className="px-6 py-4">Depositor</th>
                                    <th className="px-6 py-4">Sum Paid</th>
                                    <th className="px-6 py-4">Plan requested</th>
                                    <th className="px-6 py-4">Receipt Snapshot Key</th>
                                    <th className="px-6 py-4">Decision Status</th>
                                    <th className="px-6 py-4">Interactive Controls</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e9e6df]">
                                {deposits.length === 0 ? (
                                    <tr><td colSpan="6" className="px-6 py-8 text-center text-[#706453]">No bank deposit records on file.</td></tr>
                                ) : deposits.map(dep => (
                                    <tr key={dep.id} className="hover:bg-[#fcfbf9] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-[#1e1b18]">{dep.username ? "@" + dep.username : 'Private User'}</div>
                                            <span className="text-xs text-[#a59984] font-mono">ID: {dep.telegram_id}</span>
                                        </td>
                                        <td className="px-6 py-4 font-mono font-bold text-[#1e1b18]">\${dep.amount}</td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-semibold px-2 py-1 bg-[#f5f3ef] text-[#1e1b18] rounded uppercase">
                                                {dep.plan_requested}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-mono text-[#a59984] block truncate max-w-[150px]" title={dep.receipt_photo_file_id}>
                                                {dep.receipt_photo_file_id}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (dep.status === 'pending' ? 'bg-amber-100 text-amber-700' : dep.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                                                {dep.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {dep.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button disabled={processingId === dep.id} onClick={() => handleDecision(dep, 'approved')} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                                                        <Icon name="Check" size={12} /> Approve
                                                    </button>
                                                    <button disabled={processingId === dep.id} onClick={() => handleDecision(dep, 'declined')} className="text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                                                        <Icon name="X" size={12} /> Decline
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        // 6. AI SETTINGS & TEMPLATES VIEW
        const AISettingsView = () => {
            const aiConf = window.ENV.AI;
            const [masterPrompt, setMasterPrompt] = useState('Extract currency or commodity trading details as a clean, HTML formatted copy trading telegram message. Strictly enclose dynamic key variables in <b> tags.');

            return (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm">
                        <div className="px-6 py-5 border-b border-[#e9e6df] bg-slate-50 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold tracking-tight text-slate-800">Mkety AI Core Service Keys</h3>
                                <p className="text-xs text-slate-500 mt-1">Configured securely via system environment parameters.</p>
                            </div>
                            <span className="text-xs font-mono font-semibold bg-[#e9e6df] px-2 py-1 rounded">Read-Only Envs</span>
                        </div>
                        <div className="divide-y divide-slate-200">
                            <div className="p-5 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="bg-blue-100 p-3 rounded-lg text-blue-600"><Icon name="Sparkles" /></div>
                                    <div>
                                        <h4 className="font-semibold text-slate-800">Google Gemini</h4>
                                        <p className="text-xs text-slate-500">Fast, high-fidelity native processing.</p>
                                    </div>
                                </div>
                                <span className={"text-xs font-semibold px-3 py-1 rounded-full " + (aiConf.gemini ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                                    {aiConf.gemini ? 'Configured ✅' : 'Missing Env Var'}
                                </span>
                            </div>
                            <div className="p-5 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="bg-green-100 p-3 rounded-lg text-green-600"><Icon name="Cpu" /></div>
                                    <div>
                                        <h4 className="font-semibold text-slate-800">OpenAI (ChatGPT)</h4>
                                        <p className="text-xs text-slate-500">Fallback priority processor.</p>
                                    </div>
                                </div>
                                <span className={"text-xs font-semibold px-3 py-1 rounded-full " + (aiConf.openai ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                                    {aiConf.openai ? 'Configured ✅' : 'Missing Env Var'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm space-y-4">
                        <h3 className="font-bold tracking-tight text-slate-800">Global Signal Parsing Master Prompt</h3>
                        <p className="text-xs text-slate-500">The default system-wide instructions used by Mkety AI to normalize raw copy signals.</p>
                        <textarea className="w-full text-xs font-mono border border-slate-200 rounded-lg p-3 bg-slate-50" rows="4" value={masterPrompt} onChange={e => setMasterPrompt(e.target.value)} />
                        <div className="text-right">
                            <button onClick={() => alert("✅ Master Prompt Instructions simulated save successful!")} className="bg-[#1e1b18] text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-slate-800">
                                Save Settings
                            </button>
                        </div>
                    </div>
                </div>
            );
        };

        // 7. SYSTEM RECENT LOGS VIEW
        const LogsView = ({ workspaceId }) => {
            const { data, loading } = useData('signal_logs');

            if (!workspaceId) return <div className="p-8 text-center text-[#706453]">⚠️ Please select an active Workspace/Tenant above to view logs.</div>;
            if (loading) return <div className="p-8 text-center text-[#706453]">Loading central system logs...</div>;

            const filteredLogs = data.filter(l => l.workspace_id === workspaceId);

            return (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold tracking-tight text-slate-800">Recent Signals & Logs Activity</h3>
                    </div>
                    <div className="divide-y divide-slate-200">
                        {filteredLogs.length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-500">No signals or logs detected on file for this workspace.</div>
                        ) : filteredLogs.map(log => (
                            <div key={log.id} className="p-5 hover:bg-slate-50 transition-colors">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex gap-2">
                                        <span className="text-xs font-mono bg-[#f5f3ef] text-[#1e1b18] px-2.5 py-0.5 rounded font-medium">Chat ID: {log.source_chat_id}</span>
                                        <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded">Msg: #{log.source_message_id}</span>
                                    </div>
                                    <span className={"text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase " + (log.status === 'processed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                        {log.status}
                                    </span>
                                </div>
                                <div className="text-xs font-mono text-slate-700 bg-slate-50 p-3 rounded border border-slate-200 whitespace-pre-wrap">{log.raw_text}</div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        const Dashboard = () => {
            const [activeTab, setActiveTab] = useState('overview');
            const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
            const { data: workspaces } = useData('workspaces');

            useEffect(() => {
                if (workspaces.length > 0 && !selectedWorkspaceId) {
                    setSelectedWorkspaceId(workspaces[0].id);
                }
            }, [workspaces]);

            return (
                <div className="flex flex-col min-h-screen bg-[#fcfbf9]">
                    <header className="border-b border-[#e9e6df] bg-white px-8 py-4 sticky top-0 z-50 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-[#1e1b18] p-2.5 rounded-xl text-white"><Icon name="Activity" size={22} /></div>
                            <div>
                                <h1 className="text-lg font-bold tracking-tight leading-none text-slate-900">Mkety SaaS</h1>
                                <span className="text-[10px] font-bold text-[#9d8d75] uppercase tracking-wider block mt-0.5">Control Center</span>
                            </div>
                        </div>

                        {/* Top Selector to filter all tables by tenant */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#706453] uppercase">Tenant Context:</span>
                            <select className="text-xs font-semibold border border-[#e9e6df] bg-[#fcfbf9] p-2 rounded-lg" value={selectedWorkspaceId || ''} onChange={e => setSelectedWorkspaceId(e.target.value)}>
                                <option value="">-- Choose Workspace --</option>
                                {workspaces.map(ws => (
                                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 overflow-x-auto max-w-full">
                            {[
                                { id: 'overview', label: 'Overview' },
                                { id: 'workspaces', label: 'Tenants' },
                                { id: 'routes', label: 'Routes' },
                                { id: 'accounts', label: 'Broker Keys' },
                                { id: 'vip', label: 'VIP Members' },
                                { id: 'deposits', label: 'Bank Approvals' },
                                { id: 'ai', label: 'AI Models' },
                                { id: 'logs', label: 'Logs' }
                            ].map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={"px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap " + (activeTab === tab.id ? 'bg-white shadow-sm text-slate-900 border border-slate-200' : 'text-slate-500 hover:text-slate-900')}>
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </header>

                    <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-8">
                        {activeTab === 'overview' && (
                            <div className="space-y-6 animate-fade-in">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <StatCard title="Active Tenants" value={workspaces.length} icon="Users" subtitle="Registered multi-tenants" />
                                    <StatCard title="AI Copier Status" value="Online" icon="Sparkles" subtitle="Gemini-assisted model" />
                                    <StatCard title="Central Listener" value="Ready" icon="Radio" subtitle="Awaiting incoming streams" />
                                    <StatCard title="SaaS Mode" value="Active" icon="Activity" subtitle="OIDC authentication ready" />
                                </div>

                                <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                                    <h3 className="font-bold tracking-tight text-slate-800 mb-4 flex items-center gap-2">
                                        <Icon name="Activity" size={16} /> Welcome to Mkety Multi-Tenant SaaS
                                    </h3>
                                    <p className="text-sm text-[#706453] leading-relaxed">
                                        Use the headers to switch tabs and filter by your specific tenant's context. Securely manage automated signal routers, link individual Telegram Bot APIs, configure private trader copy-brokering lot parameters, and interactive bank decision queues.
                                    </p>
                                </div>
                            </div>
                        )}
                        {activeTab === 'workspaces' && <WorkspacesView selectedWorkspaceId={selectedWorkspaceId} setSelectedWorkspaceId={setSelectedWorkspaceId} />}
                        {activeTab === 'routes' && <SignalRoutesView workspaceId={selectedWorkspaceId} />}
                        {activeTab === 'accounts' && <TradeAccountsView workspaceId={selectedWorkspaceId} />}
                        {activeTab === 'vip' && <VIPMembersView workspaceId={selectedWorkspaceId} />}
                        {activeTab === 'deposits' && <BankApprovalsView workspaceId={selectedWorkspaceId} />}
                        {activeTab === 'ai' && <AISettingsView />}
                        {activeTab === 'logs' && <LogsView workspaceId={selectedWorkspaceId} />}
                    </main>
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<Dashboard />);
    </script>
</body>
</html>`;
}
