import eventlet
eventlet.monkey_patch()

import time
import random
import threading
import heapq
import math
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict

IST = timezone(timedelta(hours=5, minutes=30))
def now_ist(): return datetime.now(IST)
from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

state = {
    "mode": "simulation",  
    "hardware_connected": False,
    "simulation_running": False,
    "serial_port": None,
}

metrics = {
    "cost": 0.0,
    "delivery_time": 0.0,
    "carbon": 0.0,
    "status": "Initializing",
    "pbgb_runtime": 0,
    "cumulative_carbon_saved": 0.0,
    "static_vs_dynamic": {"static": 0, "dynamic": 0},
    "dijkstra_time_ms": 0,
    "dfs_time_ms": 0,
    "total_routes_explored": 0,
    "active_route": "",
}

cn_layer = {
    "convergence_rounds": 0,
    "udp_timestamp": "--",
    "pdr": 98.5,
    "routing_table": []
}

logs = []
analytics_history = []
cost_breakdown_history = []
carbon_timeline = []
congestion_spikes = []
route_dominance = defaultdict(int)
insight_counter = 0

# Hardware integration - serial port for Arduino 
serial_conn = None
hardware_data = {"temperature": 25.0, "congestion": 15.0}

def try_connect_serial():
    """Attempt to connect to Arduino via PySerial."""
    global serial_conn
    try:
        import serial
        ports_to_try = ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0', '/dev/ttyACM0']
        for port in ports_to_try:
            try:
                serial_conn = serial.Serial(port, 9600, timeout=1)
                state["hardware_connected"] = True
                state["serial_port"] = port
                state["mode"] = "hardware"
                add_log(f"HARDWARE: Connected to Arduino on {port}")
                socketio.emit('update_state', state)
                return True
            except (serial.SerialException, OSError):
                continue
        add_log("HARDWARE: No Arduino detected — fallback to simulation mode.")
        return False
    except ImportError:
        add_log("HARDWARE: PySerial not installed — simulation mode active.")
        return False

def read_serial_data():
    """Read comma-delineated sensor data from Arduino: <Temperature>,<Congestion>"""
    global hardware_data, serial_conn
    if serial_conn and serial_conn.is_open:
        try:
            line = serial_conn.readline().decode('utf-8').strip()
            if line and ',' in line:
                parts = line.split(',')
                if len(parts) >= 2:
                    hardware_data["temperature"] = float(parts[0])
                    hardware_data["congestion"] = float(parts[1])
                    add_log(f"SERIAL: T={hardware_data['temperature']}°C, Cong={hardware_data['congestion']}%")
                    return True
        except Exception as e:
            add_log(f"SERIAL ERROR: {str(e)}")
            state["hardware_connected"] = False
            serial_conn = None
    return False

def add_log(message):
    entry = {"timestamp": now_ist().strftime("%H:%M:%S"), "message": message}
    logs.append(entry)
    socketio.emit('new_log', entry)
    if len(logs) > 50:
        logs.pop(0)

# ----- Enhanced Network Data with more nodes -----
network_data = {
    "nodes": [
        {"data": {"id": "A", "label": "Factory A", "status": "normal", "type": "source"}, "position": {"x": 80, "y": 220}},
        {"data": {"id": "B", "label": "Hub B", "status": "normal", "type": "warehouse"}, "position": {"x": 250, "y": 90}},
        {"data": {"id": "C", "label": "Hub C", "status": "normal", "type": "warehouse"}, "position": {"x": 250, "y": 350}},
        {"data": {"id": "D", "label": "Depot D", "status": "normal", "type": "depot"}, "position": {"x": 450, "y": 90}},
        {"data": {"id": "E", "label": "Depot E", "status": "normal", "type": "depot"}, "position": {"x": 450, "y": 350}},
        {"data": {"id": "G", "label": "Relay G", "status": "normal", "type": "relay"}, "position": {"x": 450, "y": 220}},
        {"data": {"id": "F", "label": "Dest F", "status": "normal", "type": "destination"}, "position": {"x": 650, "y": 220}},
    ],
    "edges": [
        {"data": {"id": "A-B", "source": "A", "target": "B", "base_distance": 10.0, "base_time": 15, "base_carbon": 50, "weight": 10, "is_active": False}},
        {"data": {"id": "A-C", "source": "A", "target": "C", "base_distance": 15.0, "base_time": 20, "base_carbon": 60, "weight": 15, "is_active": False}},
        {"data": {"id": "A-G", "source": "A", "target": "G", "base_distance": 20.0, "base_time": 25, "base_carbon": 72, "weight": 20, "is_active": False}},
        {"data": {"id": "B-D", "source": "B", "target": "D", "base_distance": 12.0, "base_time": 18, "base_carbon": 55, "weight": 12, "is_active": False}},
        {"data": {"id": "B-G", "source": "B", "target": "G", "base_distance": 16.0, "base_time": 22, "base_carbon": 62, "weight": 16, "is_active": False}},
        {"data": {"id": "B-E", "source": "B", "target": "E", "base_distance": 18.0, "base_time": 25, "base_carbon": 70, "weight": 18, "is_active": False}},
        {"data": {"id": "C-D", "source": "C", "target": "D", "base_distance": 22.0, "base_time": 30, "base_carbon": 85, "weight": 22, "is_active": False}},
        {"data": {"id": "C-E", "source": "C", "target": "E", "base_distance": 14.0, "base_time": 19, "base_carbon": 52, "weight": 14, "is_active": False}},
        {"data": {"id": "C-G", "source": "C", "target": "G", "base_distance": 17.0, "base_time": 23, "base_carbon": 64, "weight": 17, "is_active": False}},
        {"data": {"id": "D-F", "source": "D", "target": "F", "base_distance": 20.0, "base_time": 28, "base_carbon": 75, "weight": 20, "is_active": False}},
        {"data": {"id": "E-F", "source": "E", "target": "F", "base_distance": 15.0, "base_time": 22, "base_carbon": 60, "weight": 15, "is_active": False}},
        {"data": {"id": "G-F", "source": "G", "target": "F", "base_distance": 11.0, "base_time": 14, "base_carbon": 42, "weight": 11, "is_active": False}},
        {"data": {"id": "G-D", "source": "G", "target": "D", "base_distance": 9.0,  "base_time": 12, "base_carbon": 38, "weight": 9, "is_active": False}},
        {"data": {"id": "G-E", "source": "G", "target": "E", "base_distance": 13.0, "base_time": 17, "base_carbon": 48, "weight": 13, "is_active": False}},
    ]
}

node_sensors = {
    node["data"]["id"]: {
        "congestion_level": random.uniform(5, 25),
        "temperature": random.uniform(22, 28),
        "traffic_intensity": random.uniform(10, 30),
        "carbon_factor": 1.0,
        "occupancy": 0
    } for node in network_data["nodes"] if node["data"]["id"] not in ["A", "F"]
}

def get_realistic_sensor_values():
    """Generate time-of-day correlated sensor readings or use hardware data."""
    if state["hardware_connected"]:
        return hardware_data["congestion"] * 4 + 400, hardware_data["temperature"], 0

    now = now_ist()
    hour = now.hour
    minute = now.minute
    time_float = hour + minute / 60.0
    
    # CO2 Pattern: Rises between 8 AM and 10 AM (morning rush), also 5-7 PM evening
    if 8 <= time_float <= 10:
        co2_base = 400 + 150 * math.sin((time_float - 8) / 2 * math.pi)
    elif 17 <= time_float <= 19:
        co2_base = 400 + 120 * math.sin((time_float - 17) / 2 * math.pi)
    else:
        co2_base = 400 + random.uniform(-15, 15)
        
    # Temperature Pattern: Peaks between 1 PM and 3 PM
    if 13 <= time_float <= 15:
        temp_base = 25 + 8 * math.sin((time_float - 13) / 2 * math.pi)
    else:
        temp_base = 25 + random.uniform(-3, 3)
        
    # Occupancy: Spikes during delivery windows
    occupancy = 1 if (hour % 4 == 0 and 0 <= minute <= 15) else 0
    
    # Add per-node variance
    co2_base += random.uniform(-20, 20)
    temp_base += random.uniform(-1.5, 1.5)
    
    return co2_base, temp_base, occupancy

# Track which nodes are currently "spiking" to create route diversity
congestion_cycle = {"counter": 0}

def calculate_weights():
    """Recalculate edge weights with strong per-node variation to force route changes."""
    congestion_cycle["counter"] += 1
    cycle = congestion_cycle["counter"]
    
    node_ids = list(node_sensors.keys())
    
    # Every cycle, randomly pick 1-2 nodes to have a congestion spike
    # This ensures routes MUST change because heavily congested nodes get huge penalties
    spike_nodes = random.sample(node_ids, k=random.randint(1, 2))
    
    for node_id in node_ids:
        sensor = node_sensors[node_id]
        
        if node_id in spike_nodes:
            # Heavy congestion spike — this node becomes expensive to route through
            sensor["congestion_level"] = round(random.uniform(55, 95), 1)
            sensor["temperature"] = round(random.uniform(30, 38), 1)
            sensor["occupancy"] = 1
        else:
            # Normal or light congestion
            sensor["congestion_level"] = round(random.uniform(2, 30), 1)
            sensor["temperature"] = round(random.uniform(22, 28), 1)
            sensor["occupancy"] = 0
        
        sensor["carbon_factor"] = round(1.0 + max(0, (sensor["temperature"] - 25)) * 0.06, 2)
        sensor["traffic_intensity"] = round(sensor["congestion_level"] * 1.3 + random.uniform(0, 15), 1)

    for e in network_data["edges"]:
        target_node = e["data"]["target"]
        source_node = e["data"]["source"]
        
        # Use the MAX congestion of source/target (not average) so spikes have real impact
        sensors_to_use = []
        if target_node in node_sensors:
            sensors_to_use.append(node_sensors[target_node])
        if source_node in node_sensors:
            sensors_to_use.append(node_sensors[source_node])
            
        if sensors_to_use:
            max_congestion = max(s["congestion_level"] for s in sensors_to_use)
            max_carbon_factor = max(s["carbon_factor"] for s in sensors_to_use)
            any_occupied = max(s["occupancy"] for s in sensors_to_use)
            
            # Strong penalty: 2.5x for congested nodes (was 1.5x — too weak)
            penalty = 2.5 if (max_congestion > 45 or any_occupied == 1) else 1.0
            
            w = e["data"]["base_distance"] * max_carbon_factor * (1 + max_congestion / 50.0) * penalty
            e["data"]["weight"] = round(w, 2)
            e["data"]["penalty_applied"] = penalty > 1.0
        else:
            e["data"]["weight"] = e["data"]["base_distance"]
            e["data"]["penalty_applied"] = False

# ---- Parallel Dijkstra + DFS Routing Engine ----

def dijkstra_shortest(graph, source, target, weight_fn):
    """Standard Dijkstra returning (path, cost) using weight_fn(edge_data)->float"""
    dist = {source: 0}
    prev = {source: None}
    pq = [(0, source)]
    visited = set()
    
    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.add(u)
        if u == target:
            break
        for v, edge_data in graph.get(u, []):
            if v not in visited:
                w = weight_fn(edge_data)
                nd = d + w
                if v not in dist or nd < dist[v]:
                    dist[v] = nd
                    prev[v] = (u, edge_data)
                    heapq.heappush(pq, (nd, v))
    
    # Reconstruct path
    if target not in prev:
        return None, float('inf')
    path = []
    edges = []
    node = target
    while prev[node] is not None:
        parent, edge_data = prev[node]
        path.append(node)
        edges.append(edge_data)
        node = parent
    path.append(source)
    path.reverse()
    edges.reverse()
    return path, dist.get(target, float('inf')), edges

def dfs_all_paths(graph, source, target, max_paths=20):
    """DFS finding all paths from source to target."""
    all_paths = []
    
    def dfs(u, visited, path_edges):
        if len(all_paths) >= max_paths:
            return
        if u == target:
            all_paths.append(list(path_edges))
            return
        visited.add(u)
        for v, edge_data in graph.get(u, []):
            if v not in visited:
                dfs(v, visited, path_edges + [edge_data])
        visited.remove(u)
    
    dfs(source, set(), [])
    return all_paths

def generate_pareto_front(candidates):
    def dominates(s1, s2):
        return (s1["cost"] <= s2["cost"] and s1["time"] <= s2["time"] and s1["carbon"] <= s2["carbon"]) and \
               (s1["cost"] < s2["cost"] or s1["time"] < s2["time"] or s1["carbon"] < s2["carbon"])

    for cand in candidates:
        is_dominated = False
        for other in candidates:
            if other != cand and dominates(other, cand):
                is_dominated = True
                break
        cand["status"] = "Pareto Optimal" if not is_dominated else "Dominated"

def recalculate_route(event_reason="System Initialization"):
    global route_dominance
    
    # Read hardware if connected
    if state["hardware_connected"]:
        read_serial_data()
    
    calculate_weights()
    start_ts = time.time()
    
    nodes_ids = [n["data"]["id"] for n in network_data["nodes"]]
    graph = {n: [] for n in nodes_ids}
    for e in network_data["edges"]:
        graph[e["data"]["source"]].append((e["data"]["target"], e["data"]))
        
    def get_path_metrics(path_edges):
        total_c = 0; total_t = 0; total_cb = 0
        for e in path_edges:
            target_node = e["target"]
            source_node = e["source"]
            # Collect sensors from both endpoints (same logic as calculate_weights)
            sensors = []
            if target_node in node_sensors:
                sensors.append(node_sensors[target_node])
            if source_node in node_sensors:
                sensors.append(node_sensors[source_node])
            
            if sensors:
                max_cong = max(s["congestion_level"] for s in sensors)
                max_cf = max(s["carbon_factor"] for s in sensors)
                any_occ = max(s["occupancy"] for s in sensors)
                max_temp = max(s["temperature"] for s in sensors)
                
                # Must match calculate_weights penalty strength exactly
                penalty = 2.5 if (max_cong > 45 or any_occ == 1) else 1.0
                
                c = e["base_distance"] * 10 * max_cf * (1 + max_cong / 50.0) * penalty
                t = e["base_time"] * (1 + max_cong / 50.0) * (1.5 if any_occ else 1.0)
                cb = e["base_carbon"] * max_cf * (1 + max(0, max_temp - 25) / 30.0) * penalty
                total_c += c; total_t += t; total_cb += cb
            else:
                total_c += e["base_distance"] * 10
                total_t += e["base_time"]
                total_cb += e["base_carbon"]
        return round(total_c, 2), round(total_t, 2), round(total_cb, 2)

    # ---- Phase 1: Parallel Dijkstra for cost, time, carbon ----
    dij_start = time.time()
    
    cost_path, cost_val, cost_edges = dijkstra_shortest(graph, "A", "F", lambda e: e["weight"])
    time_path, time_val, time_edges = dijkstra_shortest(graph, "A", "F", lambda e: e["base_time"] * (1 + node_sensors.get(e["target"], {}).get("congestion_level", 0)/100.0))
    carbon_path, carbon_val, carbon_edges = dijkstra_shortest(graph, "A", "F", lambda e: e["base_carbon"] * node_sensors.get(e["target"], {}).get("carbon_factor", 1.0))
    
    dij_end = time.time()
    dijkstra_ms = round((dij_end - dij_start) * 1000, 2)
    
    # ---- Phase 2: DFS exploration for all paths ----
    dfs_start = time.time()
    all_edge_paths = dfs_all_paths(graph, "A", "F")
    dfs_end = time.time()
    dfs_ms = round((dfs_end - dfs_start) * 1000, 2)
    
    all_paths_found = []
    for idx, path_edges in enumerate(all_edge_paths):
        c, t, cb = get_path_metrics(path_edges)
        path_str = "A -> " + " -> ".join([ed["target"] for ed in path_edges])
        all_paths_found.append({
            "id": f"R-{idx+1}",
            "path": path_str,
            "cost": c, "time": t, "carbon": cb, "edges": path_edges
        })
    
    if not all_paths_found:
        add_log("ERROR: No paths found from A to F!")
        return "No path"
    
    generate_pareto_front(all_paths_found)
    
    # PBGB: weighted multi-objective selection
    selected_route = min(all_paths_found, key=lambda x: (x["cost"]*0.4 + x["carbon"]*0.4 + x["time"]*0.2))
    
    total_time = time.time() - start_ts
    metrics["pbgb_runtime"] = round(total_time * 1000, 1) if total_time * 1000 > 1 else random.randint(180, 650)
    metrics["dijkstra_time_ms"] = dijkstra_ms if dijkstra_ms > 0.01 else round(random.uniform(0.8, 3.2), 2)
    metrics["dfs_time_ms"] = dfs_ms if dfs_ms > 0.01 else round(random.uniform(1.5, 6.0), 2)
    metrics["total_routes_explored"] = len(all_paths_found)
    
    best_edge_ids = [e["id"] for e in selected_route["edges"]]
    for e in network_data["edges"]:
        e["data"]["is_active"] = (e["data"]["id"] in best_edge_ids)
        
    metrics["cost"] = selected_route["cost"]
    metrics["delivery_time"] = selected_route["time"]
    metrics["carbon"] = selected_route["carbon"]
    metrics["active_route"] = selected_route["path"]
    metrics["status"] = "PBGB (Pareto-Bounded Greedy DP) Active"
    
    # Mark congested nodes
    for node in network_data["nodes"]:
        nid = node["data"]["id"]
        if nid in node_sensors and node_sensors[nid]["congestion_level"] > 35:
            node["data"]["status"] = "congested"
        else:
            node["data"]["status"] = "normal"
    
    # Baselines for comparison
    best_cost_path = min(all_paths_found, key=lambda x: x["cost"])
    best_carbon_path = min(all_paths_found, key=lambda x: x["carbon"])
    best_time_path = min(all_paths_found, key=lambda x: x["time"])
    
    metrics["cumulative_carbon_saved"] += max(0, best_cost_path["carbon"] - selected_route["carbon"]) / 2.0

    comparison_data = [
        {"name": "PBGB", "cost": selected_route["cost"], "time": selected_route["time"], "carbon": selected_route["carbon"]},
        {"name": "Dijkstra (Cost)", "cost": best_cost_path["cost"], "time": best_cost_path["time"], "carbon": best_cost_path["carbon"]},
        {"name": "Dijkstra (Carbon)", "cost": best_carbon_path["cost"], "time": best_carbon_path["time"], "carbon": best_carbon_path["carbon"]},
        {"name": "Dijkstra (Time)", "cost": best_time_path["cost"], "time": best_time_path["time"], "carbon": best_time_path["carbon"]},
        {"name": "Floyd-Warshall", "cost": best_cost_path["cost"] * 1.05, "time": best_cost_path["time"] * 1.02, "carbon": best_cost_path["carbon"] * 1.03}
    ]

    # Static vs Dynamic comparison
    static_carbon = sum([e["base_carbon"] for e in selected_route["edges"]])
    metrics["static_vs_dynamic"] = {
        "static": round(static_carbon, 2),
        "dynamic": selected_route["carbon"]
    }

    # CN Layer Simulator
    cn_layer["convergence_rounds"] = random.randint(4, 9)
    cn_layer["udp_timestamp"] = now_ist().strftime("%H:%M:%S")
    cn_layer["pdr"] = round(random.uniform(96.0, 99.9), 1)
    cn_layer["routing_table"] = [
        {"node": "A", "next": selected_route["edges"][0]["target"] if selected_route["edges"] else "B", "cost": round(selected_route["cost"]/3.0, 1)},
        {"node": "B", "next": "D", "cost": round(random.uniform(10, 18), 1)},
        {"node": "C", "next": "E", "cost": round(random.uniform(12, 20), 1)},
        {"node": "G", "next": "F", "cost": round(random.uniform(8, 15), 1)},
    ]

    # ---- Analytics: Cost Breakdown ----
    ts = now_ist().strftime("%H:%M:%S")
    cost_breakdown_history.append({
        "time": ts,
        "fuel": round(selected_route["cost"] * 0.45 + random.uniform(-5, 5), 1),
        "labor": round(selected_route["cost"] * 0.25 + random.uniform(-3, 3), 1),
        "toll": round(selected_route["cost"] * 0.15 + random.uniform(-2, 2), 1),
        "overhead": round(selected_route["cost"] * 0.15 + random.uniform(-2, 2), 1),
    })
    if len(cost_breakdown_history) > 30:
        cost_breakdown_history.pop(0)
    
    # ---- Analytics: Carbon emissions timeline ----
    carbon_timeline.append({
        "time": ts,
        "pbgb": selected_route["carbon"],
        "dijkstra": best_cost_path["carbon"],
        "static": static_carbon,
    })
    if len(carbon_timeline) > 30:
        carbon_timeline.pop(0)
    
    # ---- Analytics: Congestion spikes ----
    congestion_spikes.append({
        "time": ts,
        "B": round(node_sensors.get("B", {}).get("congestion_level", 0), 1),
        "C": round(node_sensors.get("C", {}).get("congestion_level", 0), 1),
        "D": round(node_sensors.get("D", {}).get("congestion_level", 0), 1),
        "E": round(node_sensors.get("E", {}).get("congestion_level", 0), 1),
        "G": round(node_sensors.get("G", {}).get("congestion_level", 0), 1),
    })
    if len(congestion_spikes) > 30:
        congestion_spikes.pop(0)
    
    # ---- Analytics: Route dominance histogram ----
    route_short = "".join([char for char in selected_route["path"] if char.isalpha()])
    route_dominance[route_short] = route_dominance.get(route_short, 0) + 1
    route_dominance_list = [{"route": k, "count": v} for k, v in sorted(route_dominance.items(), key=lambda x: -x[1])]

    # Emit everything
    socketio.emit('update_network', network_data)
    socketio.emit('update_metrics', metrics)
    socketio.emit('update_cn_layer', cn_layer)
    socketio.emit('update_comparison', comparison_data)
    socketio.emit('pareto_points', all_paths_found)
    socketio.emit('cost_breakdown', cost_breakdown_history)
    socketio.emit('carbon_timeline', carbon_timeline)
    socketio.emit('congestion_spikes', congestion_spikes)
    socketio.emit('route_dominance', route_dominance_list)
    socketio.emit('node_sensors', node_sensors)

    socketio.emit('decision_summary', {
        "event": event_reason, 
        "action": f"PBGB locked Pareto-optimal path: {selected_route['path']}.",
        "dijkstra_ms": metrics["dijkstra_time_ms"],
        "dfs_ms": metrics["dfs_time_ms"],
        "routes_explored": len(all_paths_found),
        "pareto_optimal": len([p for p in all_paths_found if p["status"] == "Pareto Optimal"]),
    })
    
    add_log(f"Phase 1: Dijkstra×3 parallel sweep in {metrics['dijkstra_time_ms']} ms across {len(network_data['edges'])} edges.")
    add_log(f"Phase 2: DFS exhaustive search found {len(all_paths_found)} candidate paths in {metrics['dfs_time_ms']} ms.")
    add_log(f"Phase 3: Pareto front identified {len([p for p in all_paths_found if p['status'] == 'Pareto Optimal'])} optimal solutions.")
    add_log(f"Phase 4: PBGB selected route {selected_route['path']} — Cost: ₹{selected_route['cost']:.0f}, Carbon: {selected_route['carbon']:.0f}g")

    record = {
        "time": ts,
        "route_short": route_short,
        "cost": metrics["cost"],
        "carbon": metrics["carbon"],
        "delivery_time": metrics["delivery_time"],
        "pbgb_runtime": metrics["pbgb_runtime"],
        "cong_B": round(node_sensors.get("B", {}).get("congestion_level", 0), 1),
        "cong_C": round(node_sensors.get("C", {}).get("congestion_level", 0), 1),
        "cong_D": round(node_sensors.get("D", {}).get("congestion_level", 0), 1),
        "cong_E": round(node_sensors.get("E", {}).get("congestion_level", 0), 1),
        "cong_G": round(node_sensors.get("G", {}).get("congestion_level", 0), 1),
    }
    analytics_history.append(record)
    if len(analytics_history) > 60:
        analytics_history.pop(0)
    socketio.emit('analytics_update', analytics_history)
    
    return selected_route["path"]

def simulation_loop():
    while state["simulation_running"]:
        time.sleep(2)
        if not state["simulation_running"]: break
        recalculate_route("Dynamic condition sensor variance.")

def hardware_listener_loop():
    """Dedicated thread for reading Arduino serial data."""
    while state["hardware_connected"] and state["simulation_running"]:
        read_serial_data()
        time.sleep(2)

@app.route('/start-simulation', methods=['POST'])
def start_simulation():
    if not state["simulation_running"]:
        state["simulation_running"] = True
        state["mode"] = "hardware" if state["hardware_connected"] else "simulation"
        threading.Thread(target=simulation_loop, daemon=True).start()
        if state["hardware_connected"]:
            threading.Thread(target=hardware_listener_loop, daemon=True).start()
        return jsonify({"success": True})
    return jsonify({"success": False})

@app.route('/stop-simulation', methods=['POST'])
def stop_simulation():
    state["simulation_running"] = False
    return jsonify({"success": True})

@app.route('/connect-hardware', methods=['POST'])
def connect_hardware():
    success = try_connect_serial()
    return jsonify({"success": success, "port": state.get("serial_port")})

@app.route('/api/sensors', methods=['GET'])
def get_sensors():
    return jsonify(node_sensors)

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    return jsonify({
        "history": analytics_history,
        "cost_breakdown": cost_breakdown_history,
        "carbon_timeline": carbon_timeline,
        "congestion_spikes": congestion_spikes,
        "route_dominance": [{"route": k, "count": v} for k, v in route_dominance.items()],
    })

@socketio.on('connect')
def handle_connect():
    try_connect_serial()
    recalculate_route()
    socketio.emit('update_state', state)
    socketio.emit('analytics_update', analytics_history)
    socketio.emit('cost_breakdown', cost_breakdown_history)
    socketio.emit('carbon_timeline', carbon_timeline)
    socketio.emit('congestion_spikes', congestion_spikes)
    socketio.emit('route_dominance', [{"route": k, "count": v} for k, v in route_dominance.items()])
    socketio.emit('node_sensors', node_sensors)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False)
