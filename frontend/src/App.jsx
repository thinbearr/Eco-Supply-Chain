import { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import cytoscape from 'cytoscape';
import { Activity, Clock, IndianRupee, Server, Info, FileText, Cpu, Zap, ShieldAlert, BarChart2, Play, Square, Settings, ZoomIn, ZoomOut, RefreshCw, BookOpen } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'https://eco-supply-chain.onrender.com';

const formatINR = (value) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [socket, setSocket] = useState(null);
  const [state, setState] = useState({ mode: 'simulation', hardware_connected: false, simulation_running: false });
  const [metrics, setMetrics] = useState({ cost: 0, delivery_time: 0, carbon: 0, status: 'Initializing' });
  const [logs, setLogs] = useState([]);
  const [sensorData, setSensorData] = useState({ node: '--', temp: '--', congestion: '--', carbon_factor: '--', timestamp: '--' });
  const [calcData, setCalcData] = useState({ edge_name: '--', base_distance: '--', congestion_multiplier: '--', carbon_multiplier: '--', final_cost: '--' });
  const [analyticsHistory, setAnalyticsHistory] = useState([]);
  const [liveInsights, setLiveInsights] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  const [routeEval, setRouteEval] = useState({ candidates: [], selected: '--', reason: '--' });
  const [costBreakdown, setCostBreakdown] = useState({ distance: 0, congestion: 0, carbon: 0, total: 0 });
  const [decision, setDecision] = useState({ event: 'Awaiting Event...', action: 'Calculating initial paths...' });

  const [showTooltip, setShowTooltip] = useState({ cost: false, cong: false, freq: false, carb: false });

  const cyRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('update_state', setState);
    newSocket.on('update_metrics', setMetrics);
    newSocket.on('new_log', data => setLogs(prev => [data, ...prev].slice(0, 100)));
    newSocket.on('sensor_data', setSensorData);
    newSocket.on('calculation_data', setCalcData);
    newSocket.on('analytics_update', setAnalyticsHistory);
    newSocket.on('route_evaluation', setRouteEval);
    newSocket.on('cost_breakdown', setCostBreakdown);
    newSocket.on('decision_summary', setDecision);
    newSocket.on('live_insights', setLiveInsights);

    newSocket.on('update_network', (data) => {
      if (cyRef.current) {
        cyRef.current.json({ elements: data });
        cyRef.current.nodes().forEach(node => {
          if (node.data('status') === 'congested') {
            node.style({ 'background-color': '#DC2626', 'label': node.data('label'), 'border-width': 1, 'border-color': '#EF4444' });
          } else {
            node.style({ 'background-color': '#2A2A2A', 'label': node.data('label'), 'border-width': 1, 'border-color': '#4B5563' });
          }
        });
        cyRef.current.edges().forEach((edge, idx) => {
          let offset = idx % 2 === 0 ? -12 : 12;
          if (edge.data('is_active')) {
            edge.style({ 'line-color': '#F97316', 'width': 3, 'opacity': 1, 'label': edge.data('weight'), 'text-margin-y': offset });
          } else {
            edge.style({ 'line-color': '#2A2A2A', 'width': 1, 'opacity': 0.6, 'label': edge.data('weight'), 'text-margin-y': offset });
          }
        });
      }
    });
    return () => newSocket.close();
  }, []);

  // Isolate Map initialization into a resize-safe observer
  useEffect(() => {
    let resizeObserver;
    if (activeTab === 'dashboard') {
      // Allow React to paint the DOM container first before attaching raw canvas injected by Cytoscape
      const initCy = setTimeout(() => {
        const container = document.getElementById('cy');
        if (container && !cyRef.current) {
          cyRef.current = cytoscape({
            container: container,
            style: [
              { selector: 'node', style: { 'background-color': '#2A2A2A', 'label': 'data(label)', 'color': '#E6E6E6', 'text-margin-y': -16, 'font-size': '11px', 'font-family': 'Rubik', 'font-weight': '600', 'text-outline-width': 0, 'text-background-color': '#1A1A1A', 'text-background-opacity': 0.9, 'text-background-padding': '4px', 'text-background-shape': 'roundrectangle', 'border-width': 1, 'border-color': '#4B5563', 'width': 22, 'height': 22 } },
              { selector: 'edge', style: { 'width': 1, 'line-color': '#2A2A2A', 'curve-style': 'bezier', 'label': 'data(weight)', 'text-background-color': '#0F0F0F', 'text-background-opacity': 1, 'text-background-padding': '3px', 'color': '#9CA3AF', 'font-size': '10px', 'font-family': 'Rubik', 'border-width': 1, 'text-border-color': '#2A2A2A', 'text-border-width': 1, 'edge-text-rotation': 'autorotate' } }
            ],
            layout: { name: 'preset' },
            userZoomingEnabled: true, userPanningEnabled: true,
            minZoom: 0.5, maxZoom: 3.0
          });
          fetch(`${SOCKET_URL}/network`).catch(() => { })
            .then(res => res ? res.json() : null)
            .then(data => { if (data && cyRef.current) { cyRef.current.json({ elements: data }); cyRef.current.fit(cyRef.current.elements(), 50); } });

          resizeObserver = new ResizeObserver(() => {
            if (cyRef.current) { cyRef.current.resize(); cyRef.current.fit(); }
          });
          resizeObserver.observe(container);
        }
      }, 50);
      return () => { clearTimeout(initCy); if (resizeObserver) resizeObserver.disconnect(); }
    } else {
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    }
  }, [activeTab]);

  const routeFrequencies = useMemo(() => {
    const counts = {};
    analyticsHistory.forEach(d => { counts[d.route_short] = (counts[d.route_short] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [analyticsHistory]);

  const Map3D = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    e.currentTarget.style.transform = `perspective(1000px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) scale3d(1.01, 1.01, 1.01)`;
  };
  const ResetMap = (e) => { e.currentTarget.style.transform = `perspective(1000px) rotateY(0deg) rotateX(0deg) scale3d(1, 1, 1)`; };

  const triggerSim = async (action) => {
    await fetch(`${SOCKET_URL}/${action}`, { method: 'POST' });
    setState(prev => ({ ...prev, simulation_running: action === 'start-simulation' }));
  };

  const ChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-4 shadow-md rounded-md text-[13px] font-sans">
          <p className="text-[#E6E6E6] mb-2 font-mono text-[12px] pb-2 border-b border-[#2A2A2A]">{`Time: ${label}`}</p>
          <div className="space-y-1.5">
            {payload.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3 justify-between">
                <span style={{ color: p.color }} className="font-medium">{p.name}:</span>
                <span className="text-[#E6E6E6] font-mono font-bold text-[14px]">
                  {p.name === "Total Cost" ? formatINR(p.value) : p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const GraphTooltipPanel = ({ title, text, visible, onClose }) => {
    if (!visible) return null;
    return (
      <div className="absolute top-12 right-6 z-50 bg-[#1A1A1A] border border-[#374151] shadow-2xl p-5 rounded-md w-72 animate-in fade-in duration-200 font-sans">
        <button onClick={onClose} className="absolute top-3 right-3 text-[#9CA3AF] hover:text-[#F97316] transition-colors">✕</button>
        <h3 className="text-[15px] font-serif font-bold text-[#F97316] mb-2">{title}</h3>
        <p className="text-[13px] text-[#E6E6E6] leading-relaxed">{text}</p>
      </div>
    );
  };

  return (
    <div className="bg-[#0F0F0F] text-[#E6E6E6] font-sans min-h-screen flex flex-col overflow-y-auto custom-scroll relative">

      {/* 1. FULL WIDTH HEADER TITLE (Perfectly Centered) */}
      <header className="bg-[#1A1A1A] border-b border-[#2A2A2A] px-8 py-5 flex items-center justify-between z-30 shrink-0 w-full relative">
        <div className="w-1/3"></div>

        {/* Absolute Center Title Wrapper */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 whitespace-nowrap">
          <Activity className="text-[#F97316] shrink-0" size={32} />
          <h1 className="text-[28px] font-serif font-bold tracking-tight text-[#E6E6E6]">Supply Chain Optimizer</h1>
        </div>

        <div className="flex items-center justify-end gap-5 w-1/3 min-w-[300px]">
          <div className="text-[15px] text-[#9CA3AF] font-mono shrink-0">{currentTime}</div>
          <div className="w-px h-6 bg-[#2A2A2A] shrink-0"></div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-bold tracking-wide border bg-[#1A1A1A] border-[#2A2A2A] text-[#9CA3AF] shrink-0">
            {state.hardware_connected ? <Cpu size={16} className="text-[#10B981]" /> : <Zap size={16} className="text-[#F97316]" />}
            {state.hardware_connected ? "HW Link Active" : "Sim Mode Active"}
          </div>
        </div>
      </header>

      {/* 2. DEDICATED NAVIGATION BAR (Tabs Center, Sim Controls Right) */}
      <nav className="bg-[#0F0F0F] border-b border-[#2A2A2A] px-8 py-4 flex items-center justify-between z-20 sticky top-0 shadow-sm shrink-0 w-full backdrop-blur-md bg-[#0F0F0F]/95">

        {/* Left Formatting Spacer */}
        <div className="w-1/3"></div>

        {/* Center: Tabs */}
        <div className="flex items-center justify-center gap-2 w-1/3">
          <button onClick={() => setActiveTab('dashboard')} className={`px-6 py-2.5 text-[15px] font-bold rounded-md transition-all whitespace-nowrap ${activeTab === 'dashboard' ? 'bg-[#2A2A2A] text-[#E6E6E6] shadow-sm' : 'text-[#9CA3AF] hover:text-[#E6E6E6] hover:bg-[#1A1A1A]'}`}>Live Dashboard</button>
          <button onClick={() => setActiveTab('analytics')} className={`px-6 py-2.5 text-[15px] font-bold rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'analytics' ? 'bg-[#2A2A2A] text-[#E6E6E6] shadow-sm' : 'text-[#9CA3AF] hover:text-[#E6E6E6] hover:bg-[#1A1A1A]'}`}><BarChart2 size={18} /> System Analytics</button>
          <button onClick={() => setActiveTab('about')} className={`px-6 py-2.5 text-[15px] font-bold rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'about' ? 'bg-[#2A2A2A] text-[#E6E6E6] shadow-sm' : 'text-[#9CA3AF] hover:text-[#E6E6E6] hover:bg-[#1A1A1A]'}`}><BookOpen size={18} /> About / Info</button>
        </div>

        {/* Right: Sim Controls */}
        <div className="flex items-center justify-end gap-4 w-1/3 min-w-[380px]">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-bold tracking-wide border whitespace-nowrap ${state.simulation_running ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]' : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#9CA3AF]'}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${state.simulation_running ? 'bg-[#10B981] animate-pulse' : 'bg-[#9CA3AF]'}`}></span>
            {state.simulation_running ? "SIMULATION RUNNING" : "SIMULATION STOPPED"}
          </div>
          <div className="flex gap-2 shrink-0">
            <button disabled={state.simulation_running} title="Start Simulation" onClick={() => triggerSim('start-simulation')} className={`flex items-center gap-2 px-5 py-2 rounded-md font-bold text-[14px] transition-colors border whitespace-nowrap ${state.simulation_running ? 'bg-[#2A2A2A] border-[#374151] text-[#6B7280] cursor-not-allowed' : 'bg-[#F97316] hover:bg-[#EA580C] border-[#F97316] text-[#0F0F0F]'}`}><Play size={16} fill="currentColor" /> Start</button>
            <button disabled={!state.simulation_running} title="Stop Simulation" onClick={() => triggerSim('stop-simulation')} className={`flex items-center gap-2 px-5 py-2 rounded-md font-bold text-[14px] transition-colors border whitespace-nowrap ${!state.simulation_running ? 'bg-[#2A2A2A] border-[#374151] text-[#6B7280] cursor-not-allowed' : 'bg-[#1A1A1A] border-[#2A2A2A] hover:border-[#DC2626] text-[#E6E6E6] hover:text-[#DC2626]'}`}><Square size={16} fill="currentColor" /> Stop</button>
          </div>
        </div>
      </nav>

      <div className="flex flex-col flex-1 w-full max-w-screen-2xl mx-auto p-8 gap-8 animate-in fade-in duration-300">

        {/* DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <>
            <div className="flex gap-8 items-start w-full">
              {/* Left Column */}
              <div className="w-1/3 flex flex-col gap-6 shrink-0">

                {/* Repurposed Live Insights Block for Dashboard Top-Left */}
                <div className="bg-[#1A1A1A] p-6 rounded-lg border border-[#2A2A2A] shadow-sm">
                  <h2 className="text-[20px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A] flex items-center gap-2"><Zap size={22} className="text-[#F97316]" /> Algorithm Live Insights</h2>
                  <div className="text-[15px] text-[#9CA3AF] leading-relaxed">
                    {liveInsights.length > 0 ? (
                      <div className="space-y-4">
                        <div><span className="text-[#9CA3AF] uppercase text-[12px] tracking-widest font-bold block mb-1">Current Route:</span> <span className="text-[#E6E6E6] font-mono font-bold text-[14px] text-[#F97316]">{routeEval.selected}</span></div>
                        <div><span className="text-[#9CA3AF] uppercase text-[12px] tracking-widest font-bold block mb-1">Primary Trigger:</span> <span className="text-[#E6E6E6] font-medium">{liveInsights[0].reason}</span></div>
                        <div><span className="text-[#9CA3AF] uppercase text-[12px] tracking-widest font-bold block mb-1">Optimization Strategy:</span> <span className="text-[#E6E6E6] font-medium">{liveInsights[0].trend}</span></div>
                        <div><span className="text-[#9CA3AF] uppercase text-[12px] tracking-widest font-bold block mb-1">Recent Improvement:</span> <span className="text-[#10B981] font-bold">{liveInsights[0].impact}</span></div>
                      </div>
                    ) : (
                      <div className="italic p-4 bg-[#0F0F0F] rounded-md border border-[#2A2A2A] text-[13px]">Awaiting initial intelligence formulation (30s tick window)...</div>
                    )}
                    <div className="text-[#4B5563] text-[11px] mt-6 font-mono uppercase tracking-widest border-t border-[#2A2A2A] pt-4">Update frequency: Every 30 seconds.</div>
                  </div>
                </div>

                <div className="bg-[#1A1A1A] p-6 rounded-lg border border-[#2A2A2A] shadow-sm">
                  <h2 className="text-[20px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A] flex items-center gap-2"><IndianRupee size={22} className="text-[#F97316]" /> Active Route Cost Breakdown</h2>
                  <div className="flex flex-col gap-3 text-[15px] font-sans">
                    <div className="flex justify-between items-center text-[#9CA3AF]"><span className="font-medium">Distance Base Cost</span> <span className="text-[#E6E6E6] font-mono font-bold">{formatINR(costBreakdown.distance)}</span></div>
                    <div className="flex justify-between items-center text-[#9CA3AF]"><span className="font-medium">Congestion Penalty</span> <span className="text-[#E6E6E6] font-mono font-bold">{formatINR(costBreakdown.congestion)}</span></div>
                    <div className="flex justify-between items-center text-[#9CA3AF]"><span className="font-medium">Carbon Penalty</span> <span className="text-[#E6E6E6] font-mono font-bold">{formatINR(costBreakdown.carbon)}</span></div>
                    <div className="border-t border-[#2A2A2A] my-2"></div>
                    <div className="flex justify-between items-center text-[#E6E6E6] font-bold text-[18px]"><span>Total Cost</span> <span className="text-[#F97316] font-mono text-[20px] tracking-tight">{formatINR(costBreakdown.total)}</span></div>
                  </div>

                  <details className="mt-6 border-t border-[#2A2A2A] pt-4 text-[14px] text-[#9CA3AF] group cursor-pointer outline-none">
                    <summary className="text-[#E6E6E6] font-bold hover:text-[#F97316] transition-colors outline-none select-none flex items-center gap-2">Cost Calculation Details</summary>
                    <div className="space-y-4 pt-3 mt-3 bg-[#0F0F0F] p-5 rounded-md border border-[#2A2A2A] cursor-text">
                      <div>
                        <strong className="text-[#E6E6E6] block mb-1">1. Base Distance Cost</strong>
                        <p className="leading-relaxed">Computed via strict geodesic edge length.</p>
                        <p className="font-mono text-[12px] text-[#F97316] mt-2 bg-[#1A1A1A] p-2.5 rounded border border-[#2A2A2A] font-bold">Rate: ₹10.00 per km</p>
                      </div>
                      <div>
                        <strong className="text-[#E6E6E6] block mb-1">2. Congestion Penalty</strong>
                        <p className="leading-relaxed">Multiplier applied dynamically to base route mapping.</p>
                        <p className="font-mono text-[12px] text-[#F97316] mt-2 bg-[#1A1A1A] p-2.5 rounded border border-[#2A2A2A] font-bold">Penalty = Base Cost × (Congestion % / 100)</p>
                      </div>
                      <div>
                        <strong className="text-[#E6E6E6] block mb-1">3. Carbon Penalty</strong>
                        <p className="leading-relaxed">Sustainability taxation avoiding high-carbon paths.</p>
                        <p className="font-mono text-[12px] text-[#F97316] mt-2 bg-[#1A1A1A] p-2.5 rounded border border-[#2A2A2A] font-bold">Penalty = Base Cost × (Carbon Factor - 1.0)</p>
                      </div>
                      <div className="pt-4 border-t border-[#374151]">
                        <p className="font-mono text-[#E6E6E6] font-bold text-[13px] uppercase tracking-wide">Total Cost = Distance + Congestion + Carbon</p>
                      </div>
                    </div>
                  </details>
                </div>

                <div className="bg-[#1A1A1A] p-6 rounded-lg border border-[#2A2A2A] shadow-sm">
                  <h2 className="text-[20px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A] flex items-center gap-2"><Server size={22} className="text-[#9CA3AF]" /> Live Data Stream</h2>
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-[13px] text-[#9CA3AF] uppercase font-bold tracking-wide">Data Source Context</span>
                    <span className="text-[13px] font-bold bg-[#2A2A2A] text-[#E6E6E6] px-3 py-1.5 rounded border border-[#374151]">{sensorData.node}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div><div className="text-[13px] font-bold text-[#9CA3AF] uppercase mb-1 tracking-wide">Temperature</div><div className="text-[18px] font-bold text-[#E6E6E6] font-mono">{sensorData.temp} °C</div></div>
                    <div><div className="text-[13px] font-bold text-[#9CA3AF] uppercase mb-1 tracking-wide">Congestion</div><div className="text-[18px] font-bold text-[#DC2626] font-mono">{sensorData.congestion} %</div></div>
                    <div><div className="text-[13px] font-bold text-[#9CA3AF] uppercase mb-1 tracking-wide">Carbon Factor</div><div className="text-[18px] font-bold text-[#10B981] font-mono">x {sensorData.carbon_factor}</div></div>
                    <div><div className="text-[13px] font-bold text-[#9CA3AF] uppercase mb-1 tracking-wide">Last Updated</div><div className="text-[18px] font-bold text-[#E6E6E6] font-mono">{sensorData.timestamp}</div></div>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="w-2/3 flex flex-col gap-6 shrink-0 h-full">

                {/* 3D Map Component (Visibility Fixed to 100% bounds structure) */}
                <div
                  onMouseMove={Map3D} onMouseLeave={ResetMap}
                  className="bg-[#1A1A1A] min-h-[480px] h-[480px] flex flex-col relative overflow-hidden rounded-lg border border-[#2A2A2A] shadow-sm transition-transform duration-200 ease-out z-20 group shrink-0"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div className="absolute top-6 left-6 z-20 bg-[#0F0F0F]/90 backdrop-blur px-5 py-2.5 rounded-md border border-[#2A2A2A] shadow-sm pointer-events-none" style={{ transform: "translateZ(30px)" }}>
                    <h2 className="text-[16px] font-serif font-bold text-[#E6E6E6] flex items-center gap-2"><ShieldAlert size={18} className="text-[#9CA3AF]" /> Network Topology</h2>
                  </div>

                  {/* Zoom Controls Overlay */}
                  <div className="absolute top-6 right-6 z-30 flex gap-2 bg-[#0F0F0F]/90 backdrop-blur p-2 rounded-md border border-[#2A2A2A] shadow-md opacity-0 group-hover:opacity-100 transition-opacity" style={{ transform: "translateZ(30px)" }}>
                    <button onClick={() => cyRef.current && cyRef.current.zoom(cyRef.current.zoom() * 1.3)} className="p-1.5 hover:bg-[#2A2A2A] rounded text-[#E6E6E6] hover:text-[#F97316] transition-colors"><ZoomIn size={18} /></button>
                    <button onClick={() => cyRef.current && cyRef.current.zoom(cyRef.current.zoom() * 0.7)} className="p-1.5 hover:bg-[#2A2A2A] rounded text-[#E6E6E6] hover:text-[#F97316] transition-colors"><ZoomOut size={18} /></button>
                    <button onClick={() => cyRef.current && cyRef.current.fit(cyRef.current.elements(), 50)} className="p-1.5 hover:bg-[#2A2A2A] rounded text-[#E6E6E6] hover:text-[#F97316] transition-colors"><RefreshCw size={18} /></button>
                  </div>

                  <div className="network-grid absolute inset-0 z-0"></div>
                  <div id="cy" className="absolute inset-0 z-10 w-full h-full cursor-grab active:cursor-grabbing"></div>
                </div>

                {/* Sub-panels natively structured */}
                <div className="flex gap-6 w-full shrink-0">
                  {/* Route Evaluation */}
                  <div className="bg-[#1A1A1A] p-6 rounded-lg border border-[#2A2A2A] shadow-sm w-1/2">
                    <h2 className="text-[20px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A] flex items-center gap-2"><FileText size={22} className="text-[#9CA3AF]" /> Route Evaluation</h2>
                    <div className="space-y-4">
                      {routeEval.candidates.slice(0, 3).map((cand, idx) => (
                        <div key={idx} className={`p-4 rounded border transition-colors ${cand.path === routeEval.selected ? 'border-[#F97316] bg-[#F97316]/5' : 'border-[#2A2A2A] bg-[#0F0F0F]'}`}>
                          <div className="flex justify-between items-center mb-2"><span className={`text-[12px] font-bold uppercase tracking-wider ${cand.path === routeEval.selected ? 'text-[#F97316]' : 'text-[#9CA3AF]'}`}>Candidate {idx + 1}</span><span className={`${cand.path === routeEval.selected ? 'text-[#E6E6E6]' : 'text-[#9CA3AF]'} font-mono text-[14px] font-bold`}>{formatINR(cand.cost)}</span></div>
                          <div className={`text-[16px] font-bold tracking-wide ${cand.path === routeEval.selected ? 'text-[#F97316]' : 'text-[#9CA3AF]'}`}>{cand.path}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Fixed Event Decision Trigger Format */}
                  <div className="bg-[#1A1A1A] p-6 rounded-lg border border-[#2A2A2A] shadow-sm w-1/2">
                    <h2 className="text-[20px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A] flex items-center gap-2"><Settings size={22} className="text-[#9CA3AF]" /> Event Decision Trigger</h2>
                    <div className="text-[15px] text-[#E6E6E6] flex flex-col gap-5">

                      <div className="bg-[#0F0F0F] border border-[#2A2A2A] p-5 rounded-md shadow-inner">
                        <span className="text-[#9CA3AF] block text-[12px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-[#374151] pb-2"><Info size={14} className="text-[#F97316]" /> Congestion Shift</span>
                        <span className="text-[#E6E6E6] font-mono text-[16px] block font-bold">{decision.event.replace('Delta Detected:', '').trim() || 'Awaiting metrics...'}</span>
                      </div>

                      <div className="bg-[#0F0F0F] border border-[#2A2A2A] p-5 rounded-md shadow-inner">
                        <span className="text-[#9CA3AF] block text-[12px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-[#374151] pb-2"><Zap size={14} className="text-[#10B981]" /> Corrective Action</span>
                        <span className="text-[#10B981] font-mono text-[16px] block font-bold tracking-tight">{decision.action.replace('Repathing:', '').trim() || 'Awaiting action...'}</span>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* System Audit Logs */}
            <div className="w-full bg-[#1A1A1A] rounded-lg shadow-sm flex flex-col border border-[#2A2A2A] h-[350px] shrink-0 mt-2">
              <div className="px-8 py-5 border-b border-[#2A2A2A] bg-[#0F0F0F] rounded-t-lg"><span className="text-[20px] font-serif font-bold text-[#E6E6E6] flex items-center gap-2"><Clock size={22} className="text-[#9CA3AF]" /> System Audit Logs</span></div>
              <div className="p-6 flex-1 overflow-y-auto space-y-3 font-mono text-[14px] custom-scroll">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-4"><span className="text-[#9CA3AF] shrink-0 font-medium whitespace-nowrap">[{log.timestamp.split(' ')[1]}]</span><span className={log.message.includes("Event:") || log.message.includes("Spike") ? "text-[#F97316] font-bold block" : "text-[#E6E6E6] block"}>{log.message}</span></div>
                ))}
                {logs.length === 0 && <div className="text-[#9CA3AF]">Awaiting architecture boot routine...</div>}
              </div>
            </div>
          </>
        )}

        {/* ANALYTICS VIEW (Only Charts remaining) */}
        {activeTab === 'analytics' && (
          <div className="w-full flex-col flex gap-8">
            <div className="grid grid-cols-2 grid-rows-2 gap-8 h-[800px] shrink-0">
              <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm flex flex-col relative w-full h-full">
                <button onClick={() => setShowTooltip({ ...showTooltip, cost: !showTooltip.cost })} className="absolute top-8 right-8 text-[#9CA3AF] hover:text-[#E6E6E6] z-10 hover:bg-[#2A2A2A] rounded-full p-2 border border-transparent hover:border-[#374151] transition-colors"><Info size={20} /></button>
                <GraphTooltipPanel visible={showTooltip.cost} onClose={() => setShowTooltip({ ...showTooltip, cost: false })} title="Total Route Cost" text="Plots the final calculated weight function derived from Dijkstra's pathfinding algorithm across every simulation cycle. Measured in active INR quantitative penalty." />

                <h2 className="text-[20px] font-serif font-bold mb-6 pb-3 border-b border-[#2A2A2A] text-[#E6E6E6]">Total Route Cost Over Time</h2>
                <div className="flex-1 min-h-[250px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsHistory} margin={{ top: 10, right: 30, left: 56, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                      <XAxis dataKey="time" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} domain={['dataMin - 50', 'dataMax + 50']} tickFormatter={(val) => `₹${val}`} />
                      <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: '#2A2A2A', strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="cost" name="Total Cost" stroke="#F97316" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#F97316', stroke: '#0F0F0F', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm flex flex-col relative w-full h-full">
                <button onClick={() => setShowTooltip({ ...showTooltip, cong: !showTooltip.cong })} className="absolute top-8 right-8 text-[#9CA3AF] hover:text-[#E6E6E6] z-10 hover:bg-[#2A2A2A] rounded-full p-2 border border-transparent hover:border-[#374151] transition-colors"><Info size={20} /></button>
                <GraphTooltipPanel visible={showTooltip.cong} onClose={() => setShowTooltip({ ...showTooltip, cong: false })} title="Relative Node Congestion" text="Multi-node percentage breakdown of localized congestion constraints spanning Warehouses and Depots. Updates asynchronously reflecting immediate sensor feeds." />

                <h2 className="text-[20px] font-serif font-bold mb-6 pb-3 border-b border-[#2A2A2A] text-[#E6E6E6]">Congestion Level Trend</h2>
                <div className="flex-1 min-h-[250px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsHistory} margin={{ top: 10, right: 30, left: 56, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                      <XAxis dataKey="time" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                      <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: '#2A2A2A', strokeWidth: 1 }} />
                      <Legend wrapperStyle={{ fontSize: '13px', fontFamily: 'Rubik', color: '#E6E6E6', bottom: 5 }} iconType="circle" iconSize={10} />
                      <Line type="monotone" dataKey="cong_B" name="Warehouse B" stroke="#3B82F6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3B82F6', stroke: '#0F0F0F' }} />
                      <Line type="monotone" dataKey="cong_C" name="Warehouse C" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#10B981', stroke: '#0F0F0F' }} />
                      <Line type="monotone" dataKey="cong_D" name="Depot D" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#F59E0B', stroke: '#0F0F0F' }} />
                      <Line type="monotone" dataKey="cong_E" name="Depot E" stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#8B5CF6', stroke: '#0F0F0F' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm flex flex-col relative w-full h-full">
                <button onClick={() => setShowTooltip({ ...showTooltip, freq: !showTooltip.freq })} className="absolute top-8 right-8 text-[#9CA3AF] hover:text-[#E6E6E6] z-10 hover:bg-[#2A2A2A] rounded-full p-2 border border-transparent hover:border-[#374151] transition-colors"><Info size={20} /></button>
                <GraphTooltipPanel visible={showTooltip.freq} onClose={() => setShowTooltip({ ...showTooltip, freq: false })} title="Frequency Analysis" text="A histogram displaying the empirical dominance of structural paths generated over the entire visual timeframe evaluating the topological search space." />

                <h2 className="text-[20px] font-serif font-bold mb-6 pb-3 border-b border-[#2A2A2A] text-[#E6E6E6]">Route Selection Frequency</h2>
                <div className="flex-1 min-h-[250px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={routeFrequencies} margin={{ top: 10, right: 30, left: 56, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                      <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => val.slice(0, 12)} />
                      <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <RechartsTooltip cursor={{ fill: '#2A2A2A' }} contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A', color: '#E6E6E6', borderRadius: '6px', fontSize: '13px', fontFamily: 'Rubik', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="count" name="Cycles Selected" fill="#E6E6E6" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm flex flex-col relative w-full h-full">
                <button onClick={() => setShowTooltip({ ...showTooltip, carb: !showTooltip.carb })} className="absolute top-8 right-8 text-[#9CA3AF] hover:text-[#E6E6E6] z-10 hover:bg-[#2A2A2A] rounded-full p-2 border border-transparent hover:border-[#374151] transition-colors"><Info size={20} /></button>
                <GraphTooltipPanel visible={showTooltip.carb} onClose={() => setShowTooltip({ ...showTooltip, carb: false })} title="Carbon Payload Target" text="Calculated live thermodynamic footprint derived natively from base carbon weight mapping combined intricately with dynamic temperature modifiers." />

                <h2 className="text-[20px] font-serif font-bold mb-6 pb-3 border-b border-[#2A2A2A] text-[#E6E6E6]">Carbon Emissions Trend</h2>
                <div className="flex-1 min-h-[250px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsHistory} margin={{ top: 10, right: 30, left: 56, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                      <XAxis dataKey="time" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                      <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: '#2A2A2A', strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="carbon" name="Carbon Output" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#10B981', stroke: '#0F0F0F', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABOUT / INFO VIEW */}
        {activeTab === 'about' && (
          <div className="w-full h-full relative p-12">
            <div className="network-grid absolute inset-0 z-0 pointer-events-none opacity-20 bg-fixed"></div>

            <div className="relative z-10 max-w-4xl mx-auto space-y-8 text-[15px] text-[#9CA3AF] leading-relaxed font-sans bg-[#0F0F0F]/80 backdrop-blur-md p-10 rounded-xl border border-[#2A2A2A] shadow-2xl">
              <h2 className="text-[32px] font-serif font-bold text-[#E6E6E6] mb-8 border-b border-[#2A2A2A] pb-4">System Architecture & Intelligence Core</h2>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A]">A. System Overview</h3>
                <p>The Supply Chain Optimizer is an advanced dynamic logistics kernel architected to rapidly compute shortest paths. The central optimization goal is calculating the mathematically perfect equilibrium minimizing delivery cost, total operational time, and ambient carbon emissions. Through Carbon-aware logistics and Dynamic Routing, it averts gridlock natively in real-time.</p>
              </section>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A]">B. Data Input Sources</h3>
                <p>Data aggregates continuously (or simulates accurately) replacing physical Arduino/NodeMCU IoT modules. Sensor pipelines ingest live values dictating immediate structural behavior:</p>
                <ul className="list-disc ml-6 mt-4 space-y-3 font-medium">
                  <li><strong className="text-[#E6E6E6] uppercase text-[13px] tracking-wide inline-block w-48">Congestion Metrics:</strong> Representing physical traffic blocks en route.</li>
                  <li><strong className="text-[#E6E6E6] uppercase text-[13px] tracking-wide inline-block w-48">Environmental Factors:</strong> Temperature fluctuations dictating cooling payloads.</li>
                  <li><strong className="text-[#E6E6E6] uppercase text-[13px] tracking-wide inline-block w-48">Carbon Factors:</strong> Road condition severity markers increasing drag efficiency.</li>
                </ul>
              </section>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A]">C. Route Decision Process</h3>
                <ol className="list-decimal ml-6 space-y-3 font-medium">
                  <li>Sensory Telemetry is parsed via asynchronous Websocket streams.</li>
                  <li>Active Edge Weights are recalculated natively against the underlying topology grid.</li>
                  <li>Graph vertices iterate through a prioritized Depth First Search (DFS) / Dijkstra payload execution.</li>
                  <li>The Optimal Vector is selected and locked as the active Edge Route.</li>
                  <li>Economic and Operational Metrics are updated globally on the dashboard render state.</li>
                </ol>
              </section>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A]">D. Calculation Logic Architecture</h3>
                <div className="bg-[#0F0F0F] border border-[#374151] p-6 rounded font-mono text-[14px] my-5 shadow-inner">
                  <p className="text-[#F97316] mb-2 font-bold">// Total Edge Weight Penalty</p>
                  <p className="text-[#E6E6E6]">Weight = Base Distance × Carbon Factor × (1 + (Congestion Level / 100))</p>
                </div>
                <p>The routing engine explicitly translates these penalties directly into financial Total Cost derivations, integrating delay adjustments for delivery time models sequentially.</p>
              </section>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-4 pb-3 border-b border-[#2A2A2A]">E. Criteria Justification</h3>
                <p>Linear static routing fundamentally fails under supply chain duress. Congestion aggressively shifts transportation costs via idling, directly impacting margin. Synchronously, excessive Carbon Emissions generated via bottlenecked freight directly harm sustainability KPIs. Immediate dynamic detours preserve overall ecosystem integrity rather than blindly following "the shortest distance".</p>
              </section>

              <section className="bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-lg shadow-sm hover:border-[#374151] transition-colors text-center">
                <h3 className="text-[22px] font-serif font-bold text-[#E6E6E6] mb-6 pb-3 border-b border-[#2A2A2A]">F. System Flow Diagram</h3>
                <div className="flex justify-center items-center gap-5 text-[#E6E6E6] font-mono text-[14px] mt-6 flex-wrap">
                  <span className="bg-[#2A2A2A] px-5 py-2.5 rounded font-bold shadow-md">Data Source Target</span>
                  <span className="text-[#F97316] font-bold text-[20px]">→</span>
                  <span className="bg-[#2A2A2A] px-5 py-2.5 rounded font-bold shadow-md">Python Processing Engine</span>
                  <span className="text-[#F97316] font-bold text-[20px]">→</span>
                  <span className="bg-[#2A2A2A] px-5 py-2.5 rounded font-bold border border-[#F97316] shadow-xl shadow-[#F97316]/20">Dijkstra Vector Search</span>
                  <span className="text-[#F97316] font-bold text-[20px]">→</span>
                  <span className="bg-[#2A2A2A] px-5 py-2.5 rounded font-bold border border-[#10B981] shadow-xl shadow-[#10B981]/20">React Data State</span>
                </div>
              </section>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
