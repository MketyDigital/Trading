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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #f8fafc; color: #0f172a; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
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
        
        // Generic DB Proxy Client
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

        const useData = (table) => {
            const [data, setData] = useState([]);
            const [loading, setLoading] = useState(true);

            const fetchData = async () => {
                setLoading(true);
                const result = await dbProxy(table, 'select');
                if (Array.isArray(result)) setData(result);
                setLoading(false);
            };

            useEffect(() => { fetchData(); }, [table]);
            return { data, loading, refetch: fetchData };
        };

        const Icon = ({ name, size = 20, className = '' }) => {
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

        const StatCard = ({ title, value, icon, trend }) => (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-semibold text-slate-500">{title}</span>
                    <Icon name={icon} className="text-slate-400" size={18} />
                </div>
                <div className="text-3xl font-bold text-slate-800 mb-1">{value}</div>
                {trend && <div className="text-xs font-medium text-blue-600 flex items-center gap-1"><Icon name="ArrowUpRight" size={14} /> {trend}</div>}
            </div>
        );

        const WorkspacesView = () => {
            const { data, loading, refetch } = useData('workspaces');
            const [isAdding, setIsAdding] = useState(false);
            const [form, setForm] = useState({ name: '', owner_email: '', tg_bot_token: '', tg_admin_chat_id: '', tg_vip_chat_id: '' });

            const handleSubmit = async (e) => {
                e.preventDefault();
                await dbProxy('workspaces', 'insert', {}, form);
                setIsAdding(false);
                setForm({ name: '', owner_email: '', tg_bot_token: '', tg_admin_chat_id: '', tg_vip_chat_id: '' });
                refetch();
            };

            if (loading) return <div className="p-8 text-center text-slate-500">Loading workspaces...</div>;
            
            return (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold tracking-tight text-slate-800">SaaS Tenants & Bots</h3>
                        <button onClick={() => setIsAdding(!isAdding)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-md transition-colors">
                            {isAdding ? 'Cancel' : '+ New Tenant'}
                        </button>
                    </div>
                    
                    {isAdding && (
                        <div className="p-6 bg-blue-50/50 border-b border-slate-200">
                            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 max-w-3xl">
                                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">Tenant Name</label><input required className="w-full text-sm border rounded p-2" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. VIP Signals Pro" /></div>
                                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">Owner Email</label><input required type="email" className="w-full text-sm border rounded p-2" value={form.owner_email} onChange={e => setForm({...form, owner_email: e.target.value})} placeholder="admin@domain.com" /></div>
                                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">Bot Token</label><input className="w-full text-sm border rounded p-2" value={form.tg_bot_token} onChange={e => setForm({...form, tg_bot_token: e.target.value})} placeholder="1234:ABCDEF..." /></div>
                                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">Admin Chat ID</label><input className="w-full text-sm border rounded p-2" value={form.tg_admin_chat_id} onChange={e => setForm({...form, tg_admin_chat_id: e.target.value})} placeholder="-100..." /></div>
                                <div><label className="text-xs font-semibold text-slate-600 mb-1 block">VIP Chat ID</label><input className="w-full text-sm border rounded p-2" value={form.tg_vip_chat_id} onChange={e => setForm({...form, tg_vip_chat_id: e.target.value})} placeholder="-100..." /></div>
                                <div className="col-span-2 pt-2"><button type="submit" className="bg-slate-800 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-slate-700">Save Tenant</button></div>
                            </form>
                        </div>
                    )}

                    <div className="divide-y divide-slate-200">
                        {data.length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-500">No tenants created yet. Click "+ New Tenant" to onboard a user.</div>
                        ) : data.map(ws => (
                            <div key={ws.id} className="p-4 hover:bg-slate-50 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h4 className="font-semibold text-slate-800">{ws.name}</h4>
                                        <span className="text-xs text-slate-500">{ws.owner_email}</span>
                                    </div>
                                    <span className={\`text-xs font-semibold px-2 py-1 rounded \${ws.tg_bot_token ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}\`}>
                                        {ws.tg_bot_token ? 'Bot Active' : 'No Bot'}
                                    </span>
                                </div>
                                <div className="text-xs font-mono bg-slate-100 text-slate-600 p-2 rounded flex gap-4">
                                    <span>Admin: {ws.tg_admin_chat_id || 'Not set'}</span>
                                    <span>VIP: {ws.tg_vip_chat_id || 'Not set'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        const AIView = () => {
            const aiConf = window.ENV.AI;
            return (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                        <h3 className="font-bold tracking-tight text-slate-800">Mkety AI Models (Global Config)</h3>
                        <p className="text-xs text-slate-500 mt-1">Configured securely via Environment Variables.</p>
                    </div>
                    <div className="divide-y divide-slate-200">
                        <div className="p-6 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="bg-blue-100 p-3 rounded-lg"><Icon name="Sparkles" className="text-blue-600" /></div>
                                <div>
                                    <h4 className="font-semibold text-slate-800">Google Gemini</h4>
                                    <p className="text-xs text-slate-500">Default fallback for signal parsing.</p>
                                </div>
                            </div>
                            <span className={\`text-xs font-semibold px-3 py-1 rounded-full \${aiConf.gemini ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}\`}>
                                {aiConf.gemini ? 'Configured ✅' : 'Missing Env Var'}
                            </span>
                        </div>
                        <div className="p-6 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="bg-green-100 p-3 rounded-lg"><Icon name="Cpu" className="text-green-600" /></div>
                                <div>
                                    <h4 className="font-semibold text-slate-800">OpenAI (ChatGPT)</h4>
                                    <p className="text-xs text-slate-500">High-precision text parsing.</p>
                                </div>
                            </div>
                            <span className={\`text-xs font-semibold px-3 py-1 rounded-full \${aiConf.openai ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}\`}>
                                {aiConf.openai ? 'Configured ✅' : 'Missing Env Var'}
                            </span>
                        </div>
                        <div className="p-6 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="bg-orange-100 p-3 rounded-lg"><Icon name="Cloud" className="text-orange-600" /></div>
                                <div>
                                    <h4 className="font-semibold text-slate-800">Mkety Native (Cloudflare AI)</h4>
                                    <p className="text-xs text-slate-500">Zero-cost Llama 3 processing.</p>
                                </div>
                            </div>
                            <span className={\`text-xs font-semibold px-3 py-1 rounded-full \${aiConf.cloudflare ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}\`}>
                                {aiConf.cloudflare ? 'Configured ✅' : 'Missing Env Var'}
                            </span>
                        </div>
                    </div>
                </div>
            );
        };

        const LogsView = () => {
            const { data, loading } = useData('signal_logs');
            if (loading) return <div className="p-8 text-center text-slate-500">Loading logs...</div>;
            return (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                        <h3 className="font-bold tracking-tight text-slate-800">Recent Signals</h3>
                    </div>
                    <div className="divide-y divide-slate-200">
                        {data.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No logs found.</div> : data.map(log => (
                            <div key={log.id} className="p-4 hover:bg-slate-50">
                                <div className="flex justify-between mb-2">
                                    <div className="flex gap-2">
                                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Chat: {log.source_chat_id}</span>
                                    </div>
                                    <span className="text-xs font-semibold px-2 py-1 rounded bg-slate-100">{log.status.toUpperCase()}</span>
                                </div>
                                <div className="text-sm font-mono text-slate-700 bg-slate-50 p-3 rounded border border-slate-200 whitespace-pre-wrap">{log.raw_text}</div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        const Dashboard = () => {
            const [activeTab, setActiveTab] = useState('overview');

            return (
                <div className="flex flex-col min-h-screen">
                    <header className="border-b border-slate-200 bg-white px-8 py-4 sticky top-0 z-50 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="bg-slate-900 p-2 rounded-lg text-white"><Icon name="Activity" size={20} /></div>
                            <div>
                                <h1 className="text-lg font-bold tracking-tight leading-none text-slate-900">Mkety SaaS</h1>
                                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Super Admin</span>
                            </div>
                        </div>
                        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                            {['overview', 'workspaces', 'ai', 'logs'].map(tab => (
                                <button key={tab} onClick={() => setActiveTab(tab)} className={\`px-4 py-1.5 text-xs font-semibold rounded-md transition-all \${activeTab === tab ? 'bg-white shadow-sm text-slate-900 border border-slate-200' : 'text-slate-500 hover:text-slate-900'}\`}>
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>
                    </header>
                    <main className="flex-1 max-w-5xl w-full mx-auto px-8 py-8">
                        {activeTab === 'overview' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
                                <StatCard title="Active Tenants" value="Active" icon="Users" />
                                <StatCard title="AI Engine" value="Online" icon="BrainCircuit" />
                                <StatCard title="Mkety Listener" value="Ready" icon="Radio" />
                            </div>
                        )}
                        {activeTab === 'workspaces' && <WorkspacesView />}
                        {activeTab === 'ai' && <AIView />}
                        {activeTab === 'logs' && <LogsView />}
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
