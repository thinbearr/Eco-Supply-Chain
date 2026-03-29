import time
import random
import threading
import heapq
from datetime import datetime
from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from flask_cors import CORS

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
    "status": "Initializing"
}

logs = []
analytics_history = []
insight_counter = 0

def add_log(message):
    entry = {"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "message": message}
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
        "congestion_level": random.uniform(5, 20),
        "temperature": 25,
        "traffic_intensity": 20,
        "carbon_factor": 1.0
    } for node in network_data["nodes"] if node["data"]["id"] in ["B", "C", "D", "E"]
}

def calculate_weights():
    for e in network_data["edges"]:
        target_node = e["data"]["target"]
        if target_node in node_sensors:
            sensor = node_sensors[target_node]
            w = e["data"]["base_distance"] * sensor["carbon_factor"] * (1 + sensor["congestion_level"] / 100.0)
            e["data"]["weight"] = round(w, 2)

def find_all_paths(graph, start, end, path=[]):
    path = path + [start]
    if start == end: return [path]
    paths = []
    for node, _, _ in graph[start]:
        if node not in path:
            paths.extend(find_all_paths(graph, node, end, path))
    return paths

def recalculate_route(event_reason="System Initialization"):
    calculate_weights()
    nodes = [n["data"]["id"] for n in network_data["nodes"]]
    graph = {n: [] for n in nodes}
    for e in network_data["edges"]:
        graph[e["data"]["source"]].append((e["data"]["target"], e["data"]["weight"], e))
        
    pq = [(0, "A", [])]
    visited = set()
    best_path_edges = []
    
    while pq:
        curr_weight, curr_node, path = heapq.heappop(pq)
        if curr_node == "F":
            best_path_edges = path; break
        if curr_node in visited: continue
        visited.add(curr_node)
        for neighbor, weight, edge_obj in graph[curr_node]:
            if neighbor not in visited:
                heapq.heappush(pq, (curr_weight + weight, neighbor, path + [edge_obj]))
                
    best_edge_ids = [e["data"]["id"] for e in best_path_edges]
    for e in network_data["edges"]:
        e["data"]["is_active"] = (e["data"]["id"] in best_edge_ids)
        
    total_cost = 0; total_time = 0; total_carbon = 0
    base_dist_sum = 0; cong_pen_sum = 0; carb_pen_sum = 0
    
    for e in best_path_edges:
        target_node = e["data"]["target"]
        if target_node in node_sensors:
            sensor = node_sensors[target_node]
            base_c = e["data"]["base_distance"] * 10
            cong_p = base_c * (sensor["congestion_level"]/100.0)
            carb_p = base_c * (max(0, sensor["carbon_factor"] - 1.0))
            c = base_c + cong_p + carb_p
            t = e["data"]["base_time"] * (1 + sensor["traffic_intensity"]/100.0)
            cb = e["data"]["base_carbon"] * sensor["carbon_factor"] * (1 + max(0, sensor["temperature"]-20)/100.0)
            total_cost += c; total_time += t; total_carbon += cb
            base_dist_sum += base_c; cong_pen_sum += cong_p; carb_pen_sum += carb_p
        else:
            total_cost += e["data"]["base_distance"] * 10
            base_dist_sum += e["data"]["base_distance"] * 10
            total_time += e["data"]["base_time"]
            total_carbon += e["data"]["base_carbon"]
            
    metrics["cost"] = round(total_cost, 2); metrics["delivery_time"] = round(total_time, 2); metrics["carbon"] = round(total_carbon, 2)
    
    for n in network_data["nodes"]:
        if n["data"]["id"] in ["A", "F"]: continue
        if node_sensors[n["data"]["id"]]["congestion_level"] > 60: n["data"]["status"] = "congested"
        else: n["data"]["status"] = "normal"
            
    metrics["status"] = "Dynamic Routing Active"
    path_str = "A -> " + " -> ".join([e["data"]["target"] for e in best_path_edges])

    socketio.emit('update_network', network_data)
    socketio.emit('update_metrics', metrics)
    
    all_paths = find_all_paths(graph, "A", "F")
    candidates = []
    for p in all_paths:
        cost = 0
        for i in range(len(p)-1):
            edge = next(e for e in network_data["edges"] if e["data"]["source"] == p[i] and e["data"]["target"] == p[i+1])
            cost += edge["data"]["weight"] * 10 if edge["data"]["weight"] else edge["data"]["base_distance"] * 10
        candidates.append({"path": " -> ".join(p), "cost": round(cost, 2)})
        
    socketio.emit('route_evaluation', {
        "candidates": candidates, "selected": path_str, "reason": "Lowest operational cost evaluated across all vertices."
    })
    
    socketio.emit('cost_breakdown', {
        "distance": round(base_dist_sum, 2), "congestion": round(cong_pen_sum, 2),
        "carbon": round(carb_pen_sum, 2), "total": round(total_cost, 2)
    })
    
    socketio.emit('decision_summary', {
        "event": event_reason, "action": f"Algorithm locked shortest path to {path_str}."
    })
    
    record = {
        "time": datetime.now().strftime("%H:%M:%S"),
        "route_short": "".join([char for char in path_str if char.isalpha()]),
        "cost": metrics["cost"],
        "carbon": metrics["carbon"],
        "cong_B": round(node_sensors["B"]["congestion_level"], 1),
        "cong_C": round(node_sensors["C"]["congestion_level"], 1),
        "cong_D": round(node_sensors["D"]["congestion_level"], 1),
        "cong_E": round(node_sensors["E"]["congestion_level"], 1),
    }
    analytics_history.append(record)
    if len(analytics_history) > 60:
        analytics_history.pop(0)
    socketio.emit('analytics_update', analytics_history)
    
    return path_str

def process_incoming_data(target_id, new_data):
    old_data = node_sensors[target_id]
    diff_cong = abs(old_data["congestion_level"] - new_data["congestion_level"])
    node_sensors[target_id] = new_data
    
    if diff_cong > 15.0:
        reason = f"Major congestion shift ({diff_cong:.1f}%) at {target_id}."
        path_str = recalculate_route(reason)
        add_log(f"Event Triggered: {reason} Repathing to {path_str}.")
        
    socketio.emit('sensor_data', {
        "node": f"Node {target_id}",
        "temp": new_data["temperature"],
        "congestion": new_data["congestion_level"],
        "carbon_factor": new_data["carbon_factor"],
        "timestamp": datetime.now().strftime("%H:%M:%S")
    })

def generate_insights():
    if len(analytics_history) < 2: return
    recent = analytics_history[-1]
    old = analytics_history[-max(2, min(5, len(analytics_history)))]
    
    cost_diff = recent["cost"] - old["cost"]
    
    insights = []
    reason = "Network conditions remained within expected tolerances."
    
    highest_delta_node = None
    max_delta = 0
    for node in ["B", "C", "D", "E"]:
        d = recent[f"cong_{node}"] - old[f"cong_{node}"]
        if abs(d) > abs(max_delta):
            max_delta = d
            highest_delta_node = node
            
    if max_delta > 10:
        reason = f"Congestion surged sharply at Node {highest_delta_node} requiring dynamic rerouting."
    elif max_delta < -10:
        reason = f"Traffic bottleneck cleared at Node {highest_delta_node}, reducing path resistance."
    
    if cost_diff < -5:
        insights.append({
            "trend": f"Total route cost reduced by ₹{abs(round(cost_diff, 2))}.",
            "reason": reason if max_delta < -10 else "Algorithm actively identified a mathematically cheaper path variant.",
            "impact": "Operational efficiency improved and transit time minimized."
        })
    elif cost_diff > 5:
        insights.append({
            "trend": f"System cost temporarily elevated by ₹{abs(round(cost_diff, 2))}.",
            "reason": reason if max_delta > 10 else "System-wide congestion pushed algorithm to select safest available detour.",
            "impact": "Route resilience maintained but delivery schedule extended."
        })
    else:
        insights.append({
            "trend": "Network costs and selection paths have stabilized strongly.",
            "reason": "Variable data inputs dropped below structural volatility thresholds.",
            "impact": "Forecasts locked. Delivery timings executing as planned."
        })
        
    socketio.emit('live_insights', insights)

def simulation_loop():
    add_log("Starting Multi-Factor Randomized Simulation Engine.")
    recalculate_route()
    
    global insight_counter
    while state["simulation_running"]:
        time.sleep(5)
        if not state["simulation_running"]: break
            
        nodes_to_update = random.sample(["B", "C", "D", "E"], k=random.randint(1, 4))
        
        for tgt in nodes_to_update:
            process_incoming_data(tgt, {
                "congestion_level": round(random.uniform(0, 100), 2),
                "temperature": round(random.uniform(20, 40), 2),
                "traffic_intensity": round(random.uniform(0, 100), 2),
                "carbon_factor": round(random.uniform(0.8, 1.5), 2)
            })
            
        insight_counter += 5
        if insight_counter >= 30:
            generate_insights()
            insight_counter = 0

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
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
