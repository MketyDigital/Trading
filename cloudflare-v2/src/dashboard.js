export function renderDashboard(env) {
    const supabaseUrl = env.SUPABASE_URL || '';
    const supabaseAnonKey = env.SUPABASE_ANON_KEY || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mkety Copier | Master Admin Panel</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    
    <style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #fcfbf9; color: #1e1b18; }
        .serif { font-family: 'Playfair Display', serif; }
        /* Smooth fade in */
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
    </style>
</head>
<body class="min-h-screen">
    <div id="root"></div>

    <script>
        window.ENV = {
            SUPABASE_URL: "${supabaseUrl}",
            SUPABASE_ANON_KEY: "${supabaseAnonKey}"
        };
    </script>

    <script type="text/babel">
        const { useState, useEffect } = React;
        
        class ErrorBoundary extends React.Component {
            constructor(props) { super(props); this.state = { hasError: false, error: null, info: null }; }
            static getDerivedStateFromError(error) { return { hasError: true, error }; }
            componentDidCatch(error, info) { console.error("React Error:", error, info); this.setState({ info }); }
            render() {
                if (this.state.hasError) {
                    return (
                        <div className="p-8 m-8 bg-red-50 border border-red-200 rounded-xl font-mono text-sm text-red-800">
                            <h2 className="text-lg font-bold mb-2">Dashboard Error</h2>
                            <p className="mb-4">The dashboard encountered a rendering error. Please check the console for details.</p>
                            <pre className="bg-white p-4 rounded overflow-auto text-xs">{this.state.error?.toString()}</pre>
                            <pre className="bg-white p-4 rounded overflow-auto text-xs mt-2">{this.state.info?.componentStack}</pre>
                        </div>
                    );
                }
                return this.props.children;
            }
        }

        // Safely instantiate Supabase only if environment variables are provided
        const hasEnv = !!window.ENV.SUPABASE_URL && window.ENV.SUPABASE_URL !== 'undefined' && window.ENV.SUPABASE_URL.trim() !== '';
        const supabase = hasEnv 
            ? window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY)
            : null;

        // Utility: Fetch data
        const useData = (table, workspaceId = 'default_workspace') => {
            const [data, setData] = useState([]);
            const [loading, setLoading] = useState(true);

            const fetchData = async () => {
                if (!supabase) {
                    setLoading(false);
                    return;
                }
                setLoading(true);
                try {
                    const { data: result, error } = await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(50);
                    if (!error && result) setData(result);
                } catch (e) {
                    console.error("Supabase fetch error:", e);
                }
                setLoading(false);
            };

            useEffect(() => {
                fetchData();
            }, [table]);

            return { data, loading, refetch: fetchData };
        };

        const Icon = ({ name, size = 20, className = '' }) => {
            const iconRef = React.useRef();
            useEffect(() => {
                try {
                    if (iconRef.current && window.lucide && window.lucide.icons[name]) {
                        const iconData = window.lucide.icons[name];
                        if (window.lucide.createElement) {
                            const svgNode = window.lucide.createElement(iconData);
                            svgNode.setAttribute('width', size);
                            svgNode.setAttribute('height', size);
                            svgNode.setAttribute('class', className);
                            iconRef.current.innerHTML = '';
                            iconRef.current.appendChild(svgNode);
                        }
                    }
                } catch (e) {
                    console.error("Icon render error:", e);
                }
            }, [name, size, className]);
            return <span ref={iconRef} className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }} />;
        };

        const StatCard = ({ title, value, icon, trend }) => (
            <div className="bg-white border border-[#e9e6df] rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-semibold text-[#706453]">{title}</span>
                    <Icon name={icon} className="text-[#a59984]" size={18} />
                </div>
                <div className="text-3xl font-bold text-[#1e1b18] mb-1">{value}</div>
                {trend && <div className="text-xs font-medium text-emerald-600 flex items-center gap-1"><Icon name="ArrowUpRight" size={14} /> {trend}</div>}
            </div>
        );

        const LogsView = () => {
            const { data, loading } = useData('signal_logs');
            
            if (loading) return <div className="p-8 text-center text-[#706453]">Loading logs...</div>;
            
            return (
                <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-[#e9e6df] bg-[#fcfbf9] flex justify-between items-center">
                        <h3 className="font-bold tracking-tight text-[#1e1b18]">Recent Signal Logs</h3>
                        <span className="text-xs font-medium bg-[#eef6ec] text-[#4d7f38] px-2.5 py-1 rounded-full">Live Monitor</span>
                    </div>
                    <div className="divide-y divide-[#e9e6df]">
                        {data.length === 0 ? (
                            <div className="p-8 text-center text-sm text-[#706453]">No signal logs found. Ensure Supabase is configured and signals are routing.</div>
                        ) : data.map(log => (
                            <div key={log.id} className="p-4 hover:bg-[#fcfbf9] transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono bg-[#f1efe9] text-[#5c5346] px-2 py-0.5 rounded">Chat: {log.source_chat_id}</span>
                                        <span className="text-xs font-mono bg-[#f1efe9] text-[#5c5346] px-2 py-0.5 rounded">Msg: {log.source_message_id}</span>
                                    </div>
                                    <span className={\`text-xs font-semibold px-2 py-1 rounded \${log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}\`}>
                                        {log.status.toUpperCase()}
                                    </span>
                                </div>
                                <div className="text-sm font-mono text-[#3a352e] bg-[#f8f7f5] p-3 rounded border border-[#f1efe9] whitespace-pre-wrap">
                                    {log.raw_text}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        const AIProvidersView = () => {
            const { data, loading } = useData('ai_providers');
            if (loading) return <div className="p-8 text-center">Loading AI providers...</div>;
            
            return (
                <div className="bg-white border border-[#e9e6df] rounded-xl overflow-hidden shadow-sm animate-fade-in">
                    <div className="px-6 py-4 border-b border-[#e9e6df] flex justify-between items-center">
                        <div>
                            <h3 className="font-bold tracking-tight text-[#1e1b18]">Multi-AI Providers</h3>
                            <p className="text-xs text-[#706453]">Cascade routing configuration</p>
                        </div>
                        <button className="text-xs font-semibold bg-[#1e1b18] text-white px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-[#332f2a] transition-colors">
                            <Icon name="Plus" size={14} /> Add Provider
                        </button>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[#fcfbf9] text-[#706453] text-xs uppercase border-b border-[#e9e6df]">
                            <tr>
                                <th className="px-6 py-3 font-semibold">Priority</th>
                                <th className="px-6 py-3 font-semibold">Provider</th>
                                <th className="px-6 py-3 font-semibold">Model Name</th>
                                <th className="px-6 py-3 font-semibold">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e9e6df]">
                            {data.length === 0 ? (
                                <tr><td colSpan="4" className="p-6 text-center text-[#706453]">No AI providers configured.</td></tr>
                            ) : data.map(p => (
                                <tr key={p.id} className="hover:bg-[#fcfbf9]">
                                    <td className="px-6 py-4 font-mono font-medium">{p.priority || '-'}</td>
                                    <td className="px-6 py-4 font-semibold capitalize flex items-center gap-2">
                                        <Icon name={p.provider_name.includes('gemini') ? 'Sparkles' : 'Cpu'} size={16} className="text-[#9d8d75]" />
                                        {p.provider_name}
                                    </td>
                                    <td className="px-6 py-4 text-[#5c5346] font-mono text-xs bg-[#f1efe9] rounded px-2 py-1 mx-6 my-3 inline-block">{p.model_name}</td>
                                    <td className="px-6 py-4">
                                        <span className={\`text-xs font-semibold px-2 py-1 rounded-full \${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}\`}>
                                            {p.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        };

        const Dashboard = () => {
            const [activeTab, setActiveTab] = useState('overview');
            const hasEnv = !!window.ENV.SUPABASE_URL;

            return (
                <div className="flex flex-col min-h-screen">
                    <header className="border-b border-[#e9e6df] bg-white px-8 py-5 sticky top-0 z-50 shadow-sm flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <div className="bg-[#1e1b18] p-2 rounded-lg text-white"><Icon name="Activity" size={24} /></div>
                            <div>
                                <span className="text-[10px] font-bold tracking-widest text-[#9d8d75] uppercase block mb-0.5">Control Center</span>
                                <h1 className="text-xl font-bold tracking-tight serif leading-none">Mkety Engine</h1>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {!hasEnv && (
                                <div className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-full font-semibold flex items-center gap-1.5">
                                    <Icon name="AlertCircle" size={14} /> Missing Supabase Env Vars
                                </div>
                            )}
                            <div className="flex gap-1 border border-[#e9e6df] p-1 rounded-lg bg-[#fcfbf9]">
                                {['overview', 'logs', 'ai'].map(tab => (
                                    <button 
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={\`px-4 py-1.5 text-xs font-semibold rounded-md transition-all \${activeTab === tab ? 'bg-white shadow-sm text-[#1e1b18] border border-[#e9e6df]' : 'text-[#706453] hover:text-[#1e1b18]'}\`}
                                    >
                                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </header>

                    <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-8">
                        {activeTab === 'overview' && (
                            <div className="space-y-6 animate-fade-in">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <StatCard title="Total Signals Processed" value="1,248" icon="ArrowRightLeft" trend="+12% this week" />
                                    <StatCard title="Active VIP Members" value="342" icon="Users" trend="+5 new today" />
                                    <StatCard title="Active AI Models" value="3" icon="BrainCircuit" />
                                    <StatCard title="MTProto Latency" value="12ms" icon="Zap" />
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                                    <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                                        <h3 className="font-bold tracking-tight text-[#1e1b18] mb-4">Quick Actions</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button className="p-4 border border-[#e9e6df] rounded-lg hover:border-[#9d8d75] hover:bg-[#fcfbf9] transition-all text-left group">
                                                <Icon name="PlusCircle" className="text-[#a59984] group-hover:text-[#1e1b18] mb-2" size={24} />
                                                <div className="text-sm font-semibold text-[#1e1b18]">New Route</div>
                                                <div className="text-xs text-[#706453] mt-1">Map channel to destination</div>
                                            </button>
                                            <button className="p-4 border border-[#e9e6df] rounded-lg hover:border-[#9d8d75] hover:bg-[#fcfbf9] transition-all text-left group">
                                                <Icon name="Bot" className="text-[#a59984] group-hover:text-[#1e1b18] mb-2" size={24} />
                                                <div className="text-sm font-semibold text-[#1e1b18]">Link Listener</div>
                                                <div className="text-xs text-[#706453] mt-1">Spawn MTProto Node</div>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-white border border-[#e9e6df] rounded-xl p-6 shadow-sm">
                                        <h3 className="font-bold tracking-tight text-[#1e1b18] mb-4">System Architecture</h3>
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3 text-sm">
                                                <Icon name="CheckCircle2" className="text-emerald-500" size={18} />
                                                <span className="font-medium text-[#3a352e]">Cloudflare Workers Runtime (V8)</span>
                                            </div>
                                            <div className="flex items-center gap-3 text-sm">
                                                <Icon name="CheckCircle2" className="text-emerald-500" size={18} />
                                                <span className="font-medium text-[#3a352e]">Durable Objects (SQLite Backend)</span>
                                            </div>
                                            <div className="flex items-center gap-3 text-sm">
                                                <Icon name="CheckCircle2" className="text-emerald-500" size={18} />
                                                <span className="font-medium text-[#3a352e]">Supabase Global Database</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeTab === 'logs' && <LogsView />}
                        {activeTab === 'ai' && <AIProvidersView />}
                    </main>
                </div>
            );
        };

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<ErrorBoundary><Dashboard /></ErrorBoundary>);
    </script>
</body>
</html>`;
}
