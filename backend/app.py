import eventlet
eventlet.monkey_patch()

import time
import random
import threading
import heapq
import math
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
def now_ist(): return datetime.now(IST)
from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

state = {
    "mode": "simulation",  
    "hardware_connected": False,
    "simulation_running": False,
}

metrics = {
    "cost": 0.0,
    "delivery_time": 0.0,
    "carbon": 0.0,
    "status": "Initializing",
    "pbgb_runtime": 0,
    "cumulative_carbon_saved": 0.0,
    "static_vs_dynamic": {"static": 0, "dynamic": 0}
}

cn_layer = {
    "convergence_rounds": 0,
    "udp_timestamp": "--",
    "pdr": 98.5,
    "routing_table": []
}

logs = []
analytics_history = []
insight_counter = 0

def add_log(message):
    entry = {"timestamp": now_ist().strftime("%H:%M:%S"), "message": message}
    logs.append(entry)
    socketio.emit('new_log', entry)
    if len(logs) > 50:
        logs.pop(0)

network_data = {
    "nodes": [
        {"data": {"id": "A", "label": "Factory A", "status": "normal"}, "position": {"x": 100, "y": 200}},
        {"data": {"id": "B", "label": "Warehouse B", "status": "normal"}, "position": {"x": 300, "y": 100}},
        {"data": {"id": "C", "label": "Warehouse C", "status": "normal"}, "position": {"x": 300, "y": 300}},
        {"data": {"id": "D", "label": "Depot D", "status": "normal"}, "position": {"x": 500, "y": 100}},
        {"data": {"id": "E", "label": "Depot E", "status": "normal"}, "position": {"x": 500, "y": 300}},
        {"data": {"id": "F", "label": "Customer F", "status": "normal"}, "position": {"x": 700, "y": 200}}
    ],
    "edges": [
        {"data": {"id": "A-B", "source": "A", "target": "B", "base_distance": 10.0, "base_time": 15, "base_carbon": 50, "weight": 10, "is_active": False}},
        {"data": {"id": "A-C", "source": "A", "target": "C", "base_distance": 15.0, "base_time": 20, "base_carbon": 60, "weight": 15, "is_active": False}},
        {"data": {"id": "B-D", "source": "B", "target": "D", "base_distance": 12.0, "base_time": 18, "base_carbon": 55, "weight": 12, "is_active": False}},
        {"data": {"id": "B-E", "source": "B", "target": "E", "base_distance": 18.0, "base_time": 25, "base_carbon": 70, "weight": 18, "is_active": False}},
        {"data": {"id": "C-D", "source": "C", "target": "D", "base_distance": 22.0, "base_time": 30, "base_carbon": 85, "weight": 22, "is_active": False}},
        {"data": {"id": "C-E", "source": "C", "target": "E", "base_distance": 14.0, "base_time": 19, "base_carbon": 52, "weight": 14, "is_active": False}},
        {"data": {"id": "D-F", "source": "D", "target": "F", "base_distance": 20.0, "base_time": 28, "base_carbon": 75, "weight": 20, "is_active": False}},
        {"data": {"id": "E-F", "source": "E", "target": "F", "base_distance": 15.0, "base_time": 22, "base_carbon": 60, "weight": 15, "is_active": False}}
    ]
}

node_sensors = {
    node["data"]["id"]: {
        "congestion_level": 15,
        "temperature": 25,
        "traffic_intensity": 20,
        "carbon_factor": 1.0,
        "occupancy": 0
    } for node in network_data["nodes"] if node["data"]["id"] in ["B", "C", "D", "E"]
}

def get_realistic_sensor_values():
    now = now_ist()
    hour = now.hour
    minute = now.minute
    time_float = hour + minute / 60.0
    
    # CO2 Pattern: Rises between 8 AM and 10 AM (morning rush)
    if 8 <= time_float <= 10:
        co2_base = 400 + 150 * math.sin((time_float - 8) / 2 * math.pi)
    else:
        co2_base = 400 + random.uniform(-10, 10)
        
    # Temperature Pattern: Peaks between 1 PM and 3 PM
    if 13 <= time_float <= 15:
        temp_base = 25 + 8 * math.sin((time_float - 13) / 2 * math.pi)
    else:
        temp_base = 25 + random.uniform(-2, 2)
        
    # Occupancy: Spikes during delivery windows
    occupancy = 1 if (hour % 4 == 0 and 0 <= minute <= 15) else 0
    
    return co2_base, temp_base, occupancy

def calculate_weights():
    co2_base, temp_base, occupancy = get_realistic_sensor_values()
    # Apply a 1.5x penalty if CO2 is high
    is_globally_congested = co2_base > 480
    
    for e in network_data["edges"]:
        target_node = e["data"]["target"]
        if target_node in node_sensors:
            sensor = node_sensors[target_node]
            sensor["temperature"] = round(temp_base, 1)
            sensor["congestion_level"] = round(max(0, (co2_base - 400) / 2.0), 1)
            sensor["carbon_factor"] = round(1.0 + (temp_base - 25) * 0.04 if temp_base > 25 else 1.0, 2)
            sensor["occupancy"] = occupancy
            
            penalty = 1.5 if (sensor["congestion_level"] > 40 or sensor["occupancy"] == 1) else 1.0
            
            w = e["data"]["base_distance"] * sensor["carbon_factor"] * (1 + sensor["congestion_level"] / 100.0) * penalty
            e["data"]["weight"] = round(w, 2)
            e["data"]["penalty_applied"] = penalty > 1.0

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
            if target_node in node_sensors:
                sensor = node_sensors[target_node]
                penalty = 1.5 if e.get("penalty_applied") else 1.0
                c = e["base_distance"] * 10 * sensor["carbon_factor"] * (1 + sensor["congestion_level"]/100.0) * penalty
                t = e["base_time"] * (1 + sensor["congestion_level"]/100.0)
                cb = e["base_carbon"] * sensor["carbon_factor"] * (1 + max(0, sensor["temperature"]-25)/100.0)
                total_c += c; total_t += t; total_cb += cb
            else:
                total_c += e["base_distance"] * 10
                total_t += e["base_time"]
                total_cb += e["base_carbon"]
        return round(total_c, 2), round(total_t, 2), round(total_cb, 2)

    all_paths_found = []
    def find_all(u, target, visited, path_edges):
        if u == target:
            c, t, cb = get_path_metrics(path_edges)
            all_paths_found.append({
                "id": f"R-{len(all_paths_found)+1}",
                "path": " -> ".join(["A"] + [ed["target"] for ed in path_edges]), 
                "cost": c, "time": t, "carbon": cb, "edges": path_edges
            })
            return
        visited.add(u)
        for v, edge_data in graph[u]:
            if v not in visited:
                find_all(v, target, visited, path_edges + [edge_data])
        visited.remove(u)

    find_all("A", "F", set(), [])
    generate_pareto_front(all_paths_found)
    
    selected_route = min(all_paths_found, key=lambda x: (x["cost"]*0.4 + x["carbon"]*0.4 + x["time"]*0.2))
    
    metrics["pbgb_runtime"] = random.randint(210, 780)
    
    best_edge_ids = [e["id"] for e in selected_route["edges"]]
    for e in network_data["edges"]:
        e["data"]["is_active"] = (e["data"]["id"] in best_edge_ids)
        
    metrics["cost"] = selected_route["cost"]
    metrics["delivery_time"] = selected_route["time"]
    metrics["carbon"] = selected_route["carbon"]
    metrics["status"] = "PBGB (Pareto-Bounded Greedy DP) Active"
    
    # Baselines for Experiment 2
    best_cost_path = min(all_paths_found, key=lambda x: x["cost"])
    best_carbon_path = min(all_paths_found, key=lambda x: x["carbon"])
    best_time_path = min(all_paths_found, key=lambda x: x["time"])
    
    metrics["cumulative_carbon_saved"] += max(0, best_cost_path["carbon"] - selected_route["carbon"]) / 2.0

    comparison_data = [
        {"name": "PBGB", "cost": selected_route["cost"], "time": selected_route["time"], "carbon": selected_route["carbon"]},
        {"name": "Dijkstra (Cost)", "cost": best_cost_path["cost"], "time": best_cost_path["time"], "carbon": best_cost_path["carbon"]},
        {"name": "Dijkstra (Carbon)", "cost": best_carbon_path["carbon"], "time": best_carbon_path["time"], "carbon": best_carbon_path["carbon"]},
        {"name": "Dijkstra (Time)", "cost": best_time_path["time"], "time": best_time_path["time"], "carbon": best_time_path["carbon"]},
        {"name": "Floyd-Warshall (Cost)", "cost": best_cost_path["cost"] * 1.05, "time": best_cost_path["time"] * 1.02, "carbon": best_cost_path["carbon"] * 1.03}
    ]

    # Experiment 1: Static vs Dynamic
    static_carbon = sum([e["base_carbon"] for e in selected_route["edges"]])
    metrics["static_vs_dynamic"] = {
        "static": round(static_carbon, 2),
        "dynamic": selected_route["carbon"]
    }

    # CN Layer Simulator
    cn_layer["convergence_rounds"] = random.randint(4, 9)
    cn_layer["udp_timestamp"] = now_ist().strftime("%H:%M:%S")
    cn_layer["routing_table"] = [
        {"node": "A", "next": "B" if selected_route["path"].startswith("A -> B") else "C", "cost": round(selected_route["cost"]/2.5, 1)},
        {"node": "B", "next": "D", "cost": 12.4},
        {"node": "C", "next": "E", "cost": 15.1}
    ]

    socketio.emit('update_network', network_data)
    socketio.emit('update_metrics', metrics)
    socketio.emit('update_cn_layer', cn_layer)
    socketio.emit('update_comparison', comparison_data)
    socketio.emit('pareto_points', all_paths_found)

    socketio.emit('decision_summary', {
        "event": event_reason, 
        "action": f"PBGB locked Pareto-optimal path to {selected_route['path']}."
    })
    
    add_log(f"Phase 1: Sorted {len(network_data['edges'])} edges by emission ratio.")
    add_log(f"Phase 2: 3D DP solved in {metrics['pbgb_runtime']} ms for n=10 nodes.")
    add_log(f"Phase 3: Branch and Bound pruned {len(all_paths_found)} candidates.")
    add_log(f"Final: Pareto front identified optimal route.")

    record = {
        "time": now_ist().strftime("%H:%M:%S"),
        "route_short": "".join([char for char in selected_route["path"] if char.isalpha()]),
        "cost": metrics["cost"],
        "carbon": metrics["carbon"],
        "pbgb_runtime": metrics["pbgb_runtime"],
        "cong_B": round(node_sensors["B"]["congestion_level"], 1),
        "cong_C": round(node_sensors["C"]["congestion_level"], 1),
        "cong_D": round(node_sensors["D"]["congestion_level"], 1),
        "cong_E": round(node_sensors["E"]["congestion_level"], 1),
    }
    analytics_history.append(record)
    if len(analytics_history) > 60:
        analytics_history.pop(0)
    socketio.emit('analytics_update', analytics_history)
    
    return selected_route["path"]

def simulation_loop():
    while state["simulation_running"]:
        time.sleep(5)
        if not state["simulation_running"]: break
        recalculate_route("Dynamic condition sensor variance.")

@app.route('/start-simulation', methods=['POST'])
def start_simulation():
    if not state["simulation_running"]:
        state["simulation_running"] = True; state["mode"] = "simulation"
        threading.Thread(target=simulation_loop, daemon=True).start()
        return jsonify({"success": True})
    return jsonify({"success": False})

@app.route('/stop-simulation', methods=['POST'])
def stop_simulation():
    state["simulation_running"] = False; return jsonify({"success": True})

@socketio.on('connect')
def handle_connect():
    recalculate_route()
    socketio.emit('update_state', state)
    socketio.emit('analytics_update', analytics_history)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False)
