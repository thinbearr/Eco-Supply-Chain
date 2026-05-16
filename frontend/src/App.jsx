import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import cytoscape from 'cytoscape';
import {
  Activity, IndianRupee, Server, Zap, Play, Network, ZapOff,
  RefreshCw, Layers, Target, TrendingUp, BarChart2, Cpu, Wifi,
  ThermometerSun, Gauge, Route, Timer
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import Pareto3D from './Pareto3D';
import AnalyticsDashboard from './AnalyticsDashboard';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const formatINR = (v) => new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', minimumFractionDigits:2, maximumFractionDigits:2 }).format(v||0);

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#12121a] border border-[#2a2a3a] p-3 shadow-lg rounded text-[12px]">
      <p className="text-[#F97316] mb-1.5 font-bold font-mono">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-3 justify-between">
          <span style={{ color: p.color }} className="font-medium text-[11px]">{p.name}:</span>
          <span className="text-[#E6E6E6] font-mono font-bold">{(p.value||0).toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
};

function CongestionBar({ value, max = 100 }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct > 60 ? '#ef4444' : pct > 30 ? '#eab308' : '#10b981';
  return (
    <div className="congestion-bar mt-1.5">
      <div className="congestion-bar-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [socket, setSocket] = useState(null);
  const [appState, setAppState] = useState({ mode:'simulation', hardware_connected:false, simulation_running:false });
  const [metrics, setMetrics] = useState({ cost:0, delivery_time:0, carbon:0, status:'Initializing', pbgb_runtime:0, cumulative_carbon_saved:0, static_vs_dynamic:{static:0,dynamic:0}, dijkstra_time_ms:0, dfs_time_ms:0, total_routes_explored:0, active_route:'' });
  const [cnLayer, setCnLayer] = useState({ convergence_rounds:0, udp_timestamp:'--', pdr:0, routing_table:[] });
  const [comparisonData, setComparisonData] = useState([]);
  const [paretoPoints, setParetoPoints] = useState([]);
  const [logs, setLogs] = useState([]);
  const [analyticsHistory, setAnalyticsHistory] = useState([]);
  const [costBreakdown, setCostBreakdown] = useState([]);
  const [carbonTimeline, setCarbonTimeline] = useState([]);
  const [congestionSpikes, setCongestionSpikes] = useState([]);
  const [routeDominance, setRouteDominance] = useState([]);
  const [nodeSensors, setNodeSensors] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [decision, setDecision] = useState({ event:'Awaiting...', action:'Initializing...', dijkstra_ms:0, dfs_ms:0, routes_explored:0, pareto_optimal:0 });
  const cyInstance = useRef(null);

  const scalabilityData = [
    { n:8, runtime:180 }, { n:12, runtime:320 }, { n:20, runtime:850 },
    { n:30, runtime:1900 }, { n:40, runtime:3400 }, { n:50, runtime:5200 }
  ];

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);
    s.on('update_state', setAppState);
    s.on('update_metrics', setMetrics);
    s.on('update_cn_layer', setCnLayer);
    s.on('update_comparison', setComparisonData);
    s.on('pareto_points', setParetoPoints);
    s.on('new_log', d => setLogs(prev => [d, ...prev].slice(0, 100)));
    s.on('analytics_update', setAnalyticsHistory);
    s.on('cost_breakdown', setCostBreakdown);
    s.on('carbon_timeline', setCarbonTimeline);
    s.on('congestion_spikes', setCongestionSpikes);
    s.on('route_dominance', setRouteDominance);
    s.on('node_sensors', setNodeSensors);
    s.on('decision_summary', setDecision);
    s.on('update_network', (data) => {
      if (!cyInstance.current) return;
      cyInstance.current.json({ elements: data });
      cyInstance.current.nodes().forEach(node => {
        const c = node.data('status') === 'congested';
        node.style({
          'background-color': c ? '#DC2626' : node.data('type')==='source' ? '#f97316' : node.data('type')==='destination' ? '#10b981' : '#1e1e2e',
          'label': node.data('label'),
          'border-width': c ? 3 : node.data('type')==='source'||node.data('type')==='destination' ? 2 : 1,
          'border-color': c ? '#EF4444' : node.data('type')==='source' ? '#f97316' : node.data('type')==='destination' ? '#10b981' : '#333',
        });
      });
      cyInstance.current.edges().forEach(edge => {
        if (edge.data('is_active')) {
          edge.style({ 'line-color':'#F97316', 'width':4, 'opacity':1, 'z-index':10, 'label': edge.data('penalty_applied') ? `${edge.data('weight')} ⚠` : String(edge.data('weight')), 'color': edge.data('penalty_applied') ? '#EF4444' : '#aaa' });
        } else {
          edge.style({ 'line-color':'#1e1e2e', 'width':1.5, 'opacity':0.3, 'label':'', 'z-index':1 });
        }
      });
    });
    return () => s.close();
  }, []);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      const el = document.getElementById('cy');
      if (el && !cyInstance.current) {
        cyInstance.current = cytoscape({
          container: el,
          style: [
            { selector:'node', style:{ 'background-color':'#1e1e2e', 'label':'data(label)', 'color':'#ccc', 'text-margin-y':-18, 'font-size':'11px', 'font-family':'Rubik', 'font-weight':'600', 'text-background-color':'#0a0a0f', 'text-background-opacity':0.9, 'text-background-padding':'4px', 'width':24, 'height':24, 'border-width':1, 'border-color':'#333' }},
            { selector:'edge', style:{ 'width':1.5, 'line-color':'#1e1e2e', 'curve-style':'bezier', 'text-background-color':'#0a0a0f', 'text-background-opacity':1, 'text-background-padding':'3px', 'color':'#888', 'font-size':'10px', 'font-family':'monospace', 'edge-text-rotation':'autorotate' }}
          ],
          layout: { name:'preset' },
          userZoomingEnabled:true, userPanningEnabled:true, minZoom:0.4, maxZoom:3.5
        });
      }
    } else {
      if (cyInstance.current) { cyInstance.current.destroy(); cyInstance.current = null; }
    }
  }, [activeTab]);

  const triggerSim = async (action) => {
    await fetch(`${SOCKET_URL}/${action}`, { method:'POST' });
    setAppState(prev => ({ ...prev, simulation_running: action === 'start-simulation' }));
  };

  const tabs = [
    { id:'dashboard', label:'Live Dashboard' },
    { id:'pareto', label:'Pareto Space', icon: <Target size={15}/> },
    { id:'analytics', label:'Analytics', icon: <BarChart2 size={15}/> },
  ];

  return (
    <div className="bg-[#0a0a0f] text-[#E6E6E6] font-sans min-h-screen flex flex-col custom-scroll">

      {/* HEADER */}
      <header className="bg-[#12121a] border-b border-[#1e1e2e] px-8 py-4 flex items-center justify-between shrink-0 relative">
        <div className="accent-bar absolute top-0 left-0 right-0"></div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f97316] flex items-center justify-center">
            <Activity className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-[22px] font-serif font-bold tracking-tight">PBGB Routing Engine</h1>
            <p className="text-[#555] text-[10px] font-mono">Pareto-Bounded Greedy DP · Eco Supply Chain</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right mr-2">
            <div className="text-[14px] text-[#10b981] font-mono font-bold">CO₂ Saved: {(metrics.cumulative_carbon_saved||0).toFixed(0)}g</div>
            <div className="text-[9px] text-[#555] uppercase tracking-widest">vs Baseline</div>
          </div>
          <div className="text-[13px] text-[#555] font-mono tabular-nums">{currentTime}</div>
          <div className="w-px h-7 bg-[#1e1e2e]"></div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-bold border border-[#1e1e2e] bg-[#12121a]">
            <span className={`live-dot ${appState.simulation_running ? 'bg-[#10b981] live-dot-pulse' : 'bg-[#555]'}`}></span>
            <span className="text-[#888]">{appState.simulation_running ? "Live" : "Standby"}</span>
          </div>
        </div>
      </header>

      {/* NAV */}
      <nav className="bg-[#0a0a0f] border-b border-[#1e1e2e] px-8 py-2.5 flex items-center justify-between sticky top-0 z-20 backdrop-blur-md bg-[#0a0a0f]/95">
        <div className="flex items-center gap-1.5">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-[12px] font-bold rounded transition-colors flex items-center gap-1.5 ${activeTab===t.id ? 'bg-[#1e1e2e] text-white' : 'text-[#555] hover:text-[#aaa]'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-[#12121a] border border-[#1e1e2e] px-3 py-1.5 rounded text-[10px] font-mono text-[#888] flex items-center gap-2">
            <span>Dijkstra <b className="text-[#f97316]">{metrics.dijkstra_time_ms}ms</b></span>
            <span className="text-[#333]">·</span>
            <span>DFS <b className="text-[#3b82f6]">{metrics.dfs_time_ms}ms</b></span>
            <span className="text-[#333]">·</span>
            <span><b className="text-[#10b981]">{metrics.total_routes_explored}</b> routes</span>
          </div>
          <button disabled={appState.simulation_running} onClick={() => triggerSim('start-simulation')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded font-bold text-[11px] transition-colors ${appState.simulation_running ? 'bg-[#1e1e2e] text-[#555] cursor-not-allowed' : 'bg-[#f97316] text-white hover:bg-[#ea580c]'}`}>
            <Play size={12} fill="currentColor"/> START
          </button>
          <button disabled={!appState.simulation_running} onClick={() => triggerSim('stop-simulation')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded font-bold text-[11px] transition-colors border ${!appState.simulation_running ? 'bg-[#1e1e2e] text-[#555] cursor-not-allowed border-[#1e1e2e]' : 'border-[#DC2626] text-[#DC2626] hover:bg-[#DC2626] hover:text-white'}`}>
            <ZapOff size={12}/> STOP
          </button>
        </div>
      </nav>

      <div className="flex-1 w-full max-w-[1600px] mx-auto p-7">

        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="grid grid-cols-12 gap-5">

              {/* LEFT */}
              <div className="col-span-4 flex flex-col gap-5">

                {/* Engine Insights */}
                <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e]">
                  <h2 className="text-[15px] font-serif font-bold mb-4 pb-3 border-b border-[#1e1e2e] flex items-center gap-2">
                    <Zap size={16} className="text-[#F97316]"/> Engine Insights
                  </h2>
                  <div className="space-y-4">
                    <div className="bg-[#0a0a0f] p-3.5 rounded border border-[#1e1e2e]">
                      <span className="text-[#555] text-[9px] uppercase tracking-widest font-bold block mb-2">Static vs IoT Carbon</span>
                      <div className="flex items-center justify-between">
                        <div className="text-center flex-1">
                          <div className="text-[17px] font-bold font-mono">{metrics.static_vs_dynamic.static}</div>
                          <div className="text-[8px] text-[#555] mt-0.5">STATIC</div>
                        </div>
                        <div className="w-px h-8 bg-[#1e1e2e]"></div>
                        <div className="text-center flex-1">
                          <div className="text-[17px] font-bold font-mono text-[#10B981]">{(metrics.static_vs_dynamic?.dynamic||0).toFixed(1)}</div>
                          <div className="text-[8px] text-[#10B981] mt-0.5">IoT LIVE</div>
                        </div>
                      </div>
                    </div>
                    <div className="px-1">
                      <span className="text-[#555] text-[9px] uppercase tracking-widest font-bold">Last Trigger</span>
                      <p className="text-[12px] mt-1 text-[#aaa]">{decision.event}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 text-center">
                      <div className="bg-[#0a0a0f] p-2.5 rounded border border-[#1e1e2e]">
                        <div className="text-[15px] font-bold text-[#f97316] font-mono">{decision.pareto_optimal}</div>
                        <div className="text-[8px] text-[#555] uppercase">Pareto Pts</div>
                      </div>
                      <div className="bg-[#0a0a0f] p-2.5 rounded border border-[#1e1e2e]">
                        <div className="text-[15px] font-bold text-[#3b82f6] font-mono">{decision.routes_explored}</div>
                        <div className="text-[8px] text-[#555] uppercase">Paths</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CN Monitor */}
                <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e]">
                  <h2 className="text-[15px] font-serif font-bold mb-4 pb-3 border-b border-[#1e1e2e] flex items-center gap-2">
                    <Network size={16} className="text-[#3B82F6]"/> CN Monitor
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 mb-3">
                    <div className="bg-[#0a0a0f] p-2.5 rounded border border-[#1e1e2e]">
                      <div className="text-[15px] font-bold text-[#3B82F6] font-mono">{cnLayer.convergence_rounds}</div>
                      <div className="text-[8px] text-[#555] uppercase font-bold">DV Rounds</div>
                    </div>
                    <div className="bg-[#0a0a0f] p-2.5 rounded border border-[#1e1e2e]">
                      <div className="text-[15px] font-bold text-[#10B981] font-mono">{cnLayer.pdr}%</div>
                      <div className="text-[8px] text-[#555] uppercase font-bold">PDR</div>
                    </div>
                  </div>
                  <div className="text-[9px] text-[#555] font-bold uppercase mb-1.5 flex justify-between">
                    <span>Routing Table</span>
                    <span className="font-mono text-[8px]">@{cnLayer.udp_timestamp}</span>
                  </div>
                  <div className="space-y-1">
                    {cnLayer.routing_table.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] font-mono bg-[#0a0a0f] p-2 rounded">
                        <span className="text-[#3B82F6] font-bold">{r.node}</span>
                        <span className="text-[#333]">→</span>
                        <span className="text-[#ccc]">{r.next}</span>
                        <span className="text-[#F97316] font-bold">₹{r.cost}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sensor Matrix */}
                <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e]">
                  <h2 className="text-[15px] font-serif font-bold mb-4 pb-3 border-b border-[#1e1e2e] flex items-center gap-2">
                    <Cpu size={16} className="text-[#a855f7]"/> Sensor Matrix
                    <span className="ml-auto text-[9px] font-mono text-[#555]">{Object.keys(nodeSensors).length} nodes</span>
                  </h2>
                  <div className="space-y-2">
                    {Object.entries(nodeSensors).map(([id, s]) => {
                      const cong = typeof s.congestion_level === 'number' ? s.congestion_level : 0;
                      return (
                      <div key={id} className={`bg-[#0a0a0f] p-2.5 rounded border ${cong > 45 ? 'border-[#ef4444]/30' : 'border-[#1e1e2e]'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-[#ccc]">Node {id}</span>
                          <span className={`text-[9px] font-bold ${cong > 45 ? 'text-[#ef4444]' : 'text-[#10b981]'}`}>
                            {cong > 45 ? '⚠ CONGESTED' : 'NORMAL'}
                          </span>
                        </div>
                        <CongestionBar value={cong} />
                        <div className="grid grid-cols-3 gap-1 text-center text-[9px] mt-1.5">
                          <div><span className="font-mono text-[#aaa]">{s.temperature}°</span><div className="text-[#444]">Temp</div></div>
                          <div><span className="font-mono text-[#aaa]">{cong.toFixed?.(1) ?? cong}</span><div className="text-[#444]">Cong</div></div>
                          <div><span className="font-mono text-[#aaa]">{s.carbon_factor}×</span><div className="text-[#444]">CO₂</div></div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Objective Matrix */}
                <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e] relative">
                  <div className="absolute top-0 right-0 bg-[#f97316] text-white font-bold text-[8px] px-2 py-0.5 rounded-bl uppercase">Active</div>
                  <h2 className="text-[15px] font-serif font-bold mb-4 pb-3 border-b border-[#1e1e2e] flex items-center gap-2">
                    <IndianRupee size={16} className="text-[#F97316]"/> Objective Matrix
                  </h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center"><span className="text-[#888] text-[12px]">Cost</span><span className="text-[17px] font-bold font-mono">{formatINR(metrics.cost)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-[#888] text-[12px]">Time</span><span className="text-[17px] font-bold font-mono text-[#3b82f6]">{(metrics.delivery_time||0).toFixed(1)} min</span></div>
                    <div className="flex justify-between items-center"><span className="text-[#888] text-[12px]">Carbon</span><span className="text-[17px] font-bold font-mono text-[#10B981]">{(metrics.carbon||0).toFixed(0)} CO₂g</span></div>
                  </div>
                  {metrics.active_route && (
                    <div className="mt-3 p-2.5 rounded bg-[#0a0a0f] border border-[#1e1e2e] text-[10px] font-mono text-[#f97316]">
                      <Route size={11} className="inline mr-1"/> {metrics.active_route}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT */}
              <div className="col-span-8 flex flex-col gap-5">

                {/* Network Map */}
                <div className="bg-[#12121a] h-[500px] relative rounded-lg border border-[#1e1e2e] overflow-hidden">
                  <div className="absolute top-4 left-4 z-20 bg-[#12121a]/90 backdrop-blur px-4 py-2 rounded border border-[#1e1e2e]">
                    <h2 className="text-[14px] font-serif font-bold flex items-center gap-2">
                      <Network size={15} className="text-[#F97316]"/> Network Topology
                      {appState.simulation_running && <span className="live-dot bg-[#10b981] live-dot-pulse ml-1.5"></span>}
                    </h2>
                  </div>
                  <div className="absolute top-4 right-4 z-20 bg-[#12121a]/90 backdrop-blur px-3 py-1.5 rounded border border-[#1e1e2e] text-[9px] font-mono text-[#666]">
                    7 nodes · 14 edges
                  </div>
                  <div className="network-grid absolute inset-0 z-0"></div>
                  <div id="cy" className="absolute inset-0 z-10 w-full h-full"></div>
                </div>

                {/* Logs + Comparison */}
                <div className="grid grid-cols-2 gap-5">
                  <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e] flex flex-col max-h-[350px]">
                    <h2 className="text-[14px] font-serif font-bold mb-3 pb-2.5 border-b border-[#1e1e2e] flex items-center gap-2 shrink-0">
                      <RefreshCw size={14} className="text-[#10B981]"/> Phase Narration
                    </h2>
                    <div className="space-y-1 flex-1 overflow-y-auto custom-scroll font-mono text-[10px]">
                      {logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className="flex gap-2 border-l-2 border-[#1e1e2e] pl-2.5 py-0.5">
                          <span className={`shrink-0 font-bold text-[9px] ${log.message.includes("Phase") ? "text-[#f97316]" : "text-[#10B981]"}`}>
                            {log.message.includes("Phase") ? "LOG" : "EVT"}
                          </span>
                          <span className={log.message.includes("Phase") ? "text-[#aaa]" : "text-[#10B981]"}>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#12121a] p-5 rounded-lg border border-[#1e1e2e] flex flex-col">
                    <h2 className="text-[14px] font-serif font-bold mb-3 pb-2.5 border-b border-[#1e1e2e] flex items-center gap-2 shrink-0">
                      <Layers size={14} className="text-[#3B82F6]"/> Algorithm Comparison
                    </h2>
                    <div className="flex-1 min-h-[200px]">
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={comparisonData} margin={{ top:10, right:0, left:0, bottom:0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false}/>
                          <XAxis dataKey="name" stroke="#555" fontSize={9} tickLine={false} axisLine={false}/>
                          <YAxis hide/>
                          <RTooltip content={<ChartTooltip/>} cursor={{ fill:'#1e1e2e', opacity:0.3 }}/>
                          <Legend wrapperStyle={{ fontSize:'10px' }}/>
                          <Bar dataKey="cost" name="Cost" fill="#F97316" radius={[3,3,0,0]}/>
                          <Bar dataKey="carbon" name="Carbon" fill="#10B981" radius={[3,3,0,0]}/>
                          <Bar dataKey="time" name="Time" fill="#3B82F6" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PARETO */}
        {activeTab === 'pareto' && (
          <div className="flex flex-col gap-6 animate-fade-in" style={{height:'calc(100vh - 160px)'}}>
            <div className="bg-[#12121a] p-7 rounded-lg border border-[#1e1e2e] flex flex-col flex-1">
              <div className="flex justify-between items-center mb-5 pb-4 border-b border-[#1e1e2e]">
                <div>
                  <h2 className="text-[24px] font-serif font-bold">Multi-Objective Pareto Frontier</h2>
                  <p className="text-[#555] font-mono text-[11px] mt-1">{paretoPoints.length} routes in 3D objective space</p>
                </div>
                <div className="flex gap-6 text-right">
                  <div><div className="text-[9px] text-[#555] font-bold uppercase tracking-widest">Algorithm</div><div className="text-[16px] font-bold text-[#F97316]">PBGB</div></div>
                  <div><div className="text-[9px] text-[#555] font-bold uppercase tracking-widest">Pruning</div><div className="text-[16px] font-bold">88.4%</div></div>
                </div>
              </div>
              <div className="flex-1 min-h-[400px]">
                <Pareto3D points={paretoPoints} />
              </div>
              <div className="mt-5 grid grid-cols-4 gap-3">
                {[
                  { t:'Cost Convergence', d:'DP budget search achieves global minimum.' },
                  { t:'Time Resiliency', d:'Vectors pruned if >1.2× theoretical optimum.' },
                  { t:'Carbon Awareness', d:'Non-dominated clusters with 0.95 confidence.' },
                  { t:'B&B Pruning', d:'Emission-ratio lower bounds eliminate branches.' }
                ].map((c, i) => (
                  <div key={i} className="bg-[#0a0a0f] p-3 rounded border border-[#1e1e2e]">
                    <h4 className="text-[#555] font-bold text-[9px] uppercase mb-1">{c.t}</h4>
                    <p className="text-[11px] text-[#888]">{c.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {activeTab === 'analytics' && (
          <AnalyticsDashboard
            analyticsHistory={analyticsHistory}
            costBreakdown={costBreakdown}
            carbonTimeline={carbonTimeline}
            congestionSpikes={congestionSpikes}
            routeDominance={routeDominance}
            scalabilityData={scalabilityData}
          />
        )}
      </div>
    </div>
  );
}

export default App;
