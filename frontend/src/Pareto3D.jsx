import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default function Pareto3D({ points }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const frameRef = useRef(null);
  const dataGroupRef = useRef(null);
  const initedRef = useRef(false);

  // Initialize scene ONCE
  useEffect(() => {
    if (!mountRef.current || initedRef.current) return;
    initedRef.current = true;

    const container = mountRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;
    const S = 7; // axis scale

    // ─── Scene ───
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08080e);
    scene.fog = new THREE.FogExp2(0x08080e, 0.018);
    sceneRef.current = scene;

    // ─── Camera ───
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 500);
    camera.position.set(16, 11, 16);
    camera.lookAt(S / 2, S / 2, S / 2);
    cameraRef.current = camera;

    // ─── Renderer ───
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Controls ───
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = false;
    controls.target.set(S / 2, S / 2, S / 2);
    controls.minDistance = 6;
    controls.maxDistance = 45;
    controls.update();
    controlsRef.current = controls;

    // ─── Floor Plane ───
    const floorGeo = new THREE.PlaneGeometry(S + 4, S + 4);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c0c14, transparent: true, opacity: 0.7,
      roughness: 0.95, metalness: 0
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(S / 2, -0.01, S / 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // ─── Grid on floor ───
    const gridHelper = new THREE.GridHelper(S, 7, 0x1a1a2e, 0x111118);
    gridHelper.position.set(S / 2, 0, S / 2);
    scene.add(gridHelper);

    // ─── Back walls (subtle reference planes) ───
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x0e0e18, transparent: true, opacity: 0.25, side: THREE.DoubleSide
    });
    // XY wall (at z=0)
    const wallXY = new THREE.Mesh(new THREE.PlaneGeometry(S, S), wallMat);
    wallXY.position.set(S / 2, S / 2, 0);
    scene.add(wallXY);
    // YZ wall (at x=0)
    const wallYZ = new THREE.Mesh(new THREE.PlaneGeometry(S, S), wallMat);
    wallYZ.rotation.y = Math.PI / 2;
    wallYZ.position.set(0, S / 2, S / 2);
    scene.add(wallYZ);

    // ─── Grid lines on walls ───
    const wallGridMat = new THREE.LineBasicMaterial({ color: 0x151520, transparent: true, opacity: 0.4 });
    const ticks = 7;
    for (let i = 0; i <= ticks; i++) {
      const t = (i / ticks) * S;
      // XY wall grid
      const hPts = [new THREE.Vector3(0, t, 0), new THREE.Vector3(S, t, 0)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), wallGridMat));
      const vPts = [new THREE.Vector3(t, 0, 0), new THREE.Vector3(t, S, 0)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), wallGridMat));
      // YZ wall grid
      const hPts2 = [new THREE.Vector3(0, t, 0), new THREE.Vector3(0, t, S)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts2), wallGridMat));
      const vPts2 = [new THREE.Vector3(0, 0, t), new THREE.Vector3(0, S, t)];
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts2), wallGridMat));
    }

    // ─── Axes (thick lines with arrowheads) ───
    const axLen = S + 1;
    const axisData = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xf97316, label: 'COST' },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x3b82f6, label: 'TIME' },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x10b981, label: 'CO₂' },
    ];
    axisData.forEach(({ dir, color, label }) => {
      // Axis line
      const pts = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(axLen)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      scene.add(new THREE.Line(geo, mat));

      // Arrowhead
      const coneGeo = new THREE.ConeGeometry(0.12, 0.4, 8);
      const coneMat = new THREE.MeshBasicMaterial({ color });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      const end = dir.clone().multiplyScalar(axLen);
      cone.position.copy(end);
      if (dir.x === 1) cone.rotation.z = -Math.PI / 2;
      else if (dir.z === 1) cone.rotation.x = Math.PI / 2;
      scene.add(cone);

      // Tick marks + values on axes
      for (let i = 1; i <= 7; i++) {
        const t = (i / 7) * S;
        const tickPos = dir.clone().multiplyScalar(t);

        // small tick line perpendicular to axis
        const tickLen = 0.15;
        let p1, p2;
        if (dir.x === 1) {
          p1 = new THREE.Vector3(t, -tickLen, 0);
          p2 = new THREE.Vector3(t, tickLen, 0);
        } else if (dir.y === 1) {
          p1 = new THREE.Vector3(-tickLen, t, 0);
          p2 = new THREE.Vector3(tickLen, t, 0);
        } else {
          p1 = new THREE.Vector3(0, -tickLen, t);
          p2 = new THREE.Vector3(0, tickLen, t);
        }
        const tGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        scene.add(new THREE.Line(tGeo, new THREE.LineBasicMaterial({ color: 0x333340 })));
      }

      // Axis label sprite
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label + ' →', 128, 42);
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      const sMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(sMat);
      const lPos = dir.clone().multiplyScalar(axLen + 1.5);
      sprite.position.copy(lPos);
      sprite.scale.set(3, 0.75, 1);
      scene.add(sprite);
    });

    // ─── Data group ───
    const dataGroup = new THREE.Group();
    scene.add(dataGroup);
    dataGroupRef.current = dataGroup;

    // ─── Lighting ───
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(12, 18, 12);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x3b82f6, 0.3);
    fillLight.position.set(-8, 6, -4);
    scene.add(fillLight);

    scene.add(new THREE.AmbientLight(0x303040, 0.6));

    const orangePt = new THREE.PointLight(0xf97316, 0.4, 25);
    orangePt.position.set(S, S, S);
    scene.add(orangePt);

    // ─── Render loop ───
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      initedRef.current = false;
    };
  }, []);

  // Update data points only
  useEffect(() => {
    const group = dataGroupRef.current;
    if (!group || !points || points.length === 0) return;

    // Clear old
    while (group.children.length) {
      const ch = group.children[0];
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) { if (ch.material.map) ch.material.map.dispose(); ch.material.dispose(); }
      group.remove(ch);
    }

    const S = 7;
    const maxC = Math.max(...points.map(p => p.cost), 1);
    const maxT = Math.max(...points.map(p => p.time), 1);
    const maxCb = Math.max(...points.map(p => p.carbon), 1);
    const n = (v, m) => (v / m) * S;

    const optPoints = [];
    const domPoints = [];

    points.forEach((p) => {
      const isOpt = p.status === 'Pareto Optimal';
      const px = n(p.cost, maxC);
      const py = n(p.time, maxT);
      const pz = n(p.carbon, maxCb);

      if (isOpt) optPoints.push({ px, py, pz, p });
      else domPoints.push({ px, py, pz, p });

      // ─── Sphere ───
      const r = isOpt ? 0.22 : 0.1;
      const geo = new THREE.SphereGeometry(r, isOpt ? 32 : 16, isOpt ? 32 : 16);
      const mat = new THREE.MeshPhysicalMaterial({
        color: isOpt ? 0xf97316 : 0x3a3a4a,
        emissive: isOpt ? 0xf97316 : 0x000000,
        emissiveIntensity: isOpt ? 0.5 : 0,
        metalness: isOpt ? 0.4 : 0.1,
        roughness: isOpt ? 0.2 : 0.7,
        clearcoat: isOpt ? 0.8 : 0,
        clearcoatRoughness: 0.2,
        transparent: !isOpt,
        opacity: isOpt ? 1.0 : 0.25,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(px, py, pz);
      group.add(sphere);

      // ─── Outer glow ring for pareto points ───
      if (isOpt) {
        const ringGeo = new THREE.RingGeometry(0.3, 0.42, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf97316, transparent: true, opacity: 0.12, side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(px, py, pz);
        ring.lookAt(cameraRef.current.position);
        group.add(ring);
      }

      // ─── Drop line to floor ───
      const dropPts = [new THREE.Vector3(px, py, pz), new THREE.Vector3(px, 0, pz)];
      const dropGeo = new THREE.BufferGeometry().setFromPoints(dropPts);
      const dropMat = new THREE.LineDashedMaterial({
        color: isOpt ? 0xf97316 : 0x222230,
        dashSize: 0.12, gapSize: 0.08,
        transparent: true, opacity: isOpt ? 0.2 : 0.1
      });
      const dropLine = new THREE.Line(dropGeo, dropMat);
      dropLine.computeLineDistances();
      group.add(dropLine);

      // ─── Shadow projection on floor ───
      if (isOpt) {
        const shadowGeo = new THREE.CircleGeometry(0.15, 16);
        const shadowMat = new THREE.MeshBasicMaterial({
          color: 0xf97316, transparent: true, opacity: 0.08
        });
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(px, 0.01, pz);
        group.add(shadow);
      }

      // ─── Drop lines to back walls for pareto points ───
      if (isOpt) {
        // to XY wall (z=0)
        const wPts1 = [new THREE.Vector3(px, py, pz), new THREE.Vector3(px, py, 0)];
        const wGeo1 = new THREE.BufferGeometry().setFromPoints(wPts1);
        group.add(new THREE.Line(wGeo1, new THREE.LineDashedMaterial({
          color: 0x10b981, dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0.08
        })).computeLineDistances() || group.children[group.children.length - 1]);

        // to YZ wall (x=0)
        const wPts2 = [new THREE.Vector3(px, py, pz), new THREE.Vector3(0, py, pz)];
        const wGeo2 = new THREE.BufferGeometry().setFromPoints(wPts2);
        const wLine2 = new THREE.Line(wGeo2, new THREE.LineDashedMaterial({
          color: 0xf97316, dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0.08
        }));
        wLine2.computeLineDistances();
        group.add(wLine2);
      }
    });

    // ─── Pareto frontier curve ───
    if (optPoints.length > 1) {
      // Sort by cost for a cleaner line
      optPoints.sort((a, b) => a.px - b.px);
      const linePts = optPoints.map(o => new THREE.Vector3(o.px, o.py, o.pz));
      const curve = new THREE.CatmullRomCurve3(linePts, false, 'catmullrom', 0.5);
      const curvePoints = curve.getPoints(50);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.35 });
      group.add(new THREE.Line(lineGeo, lineMat));

      // Tube version for thickness
      const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.03, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.2 });
      group.add(new THREE.Mesh(tubeGeo, tubeMat));
    }

    // ─── Route ID labels ───
    points.forEach((p, idx) => {
      const isOpt = p.status === 'Pareto Optimal';
      if (!isOpt && !p.id) return; // only label pareto or if id exists

      const px = n(p.cost, maxC);
      const py = n(p.time, maxT);
      const pz = n(p.carbon, maxCb);

      const lc = document.createElement('canvas');
      lc.width = 128; lc.height = 40;
      const ctx = lc.getContext('2d');
      ctx.fillStyle = isOpt ? '#f97316' : '#555';
      ctx.font = `bold ${isOpt ? 20 : 14}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(p.id || `R${idx + 1}`, 64, 28);
      const tex = new THREE.CanvasTexture(lc);
      tex.minFilter = THREE.LinearFilter;
      const sMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: isOpt ? 0.9 : 0.4 });
      const sprite = new THREE.Sprite(sMat);
      sprite.position.set(px, py + (isOpt ? 0.5 : 0.3), pz);
      sprite.scale.set(1.4, 0.45, 1);
      group.add(sprite);
    });
  }, [points]);

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden" style={{ background: '#08080e' }}>
      <div ref={mountRef} className="w-full h-full" />
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 bg-[#0c0c14]/90 backdrop-blur-sm p-3 rounded border border-[#1a1a28] text-[10px] pointer-events-none select-none">
        <h4 className="text-[#888] font-bold mb-2 uppercase tracking-widest text-[9px]">Pareto Frontier</h4>
        <div className="space-y-1">
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-[#F97316]"></div> <span className="text-[#aaa]">Pareto Optimal</span></div>
          <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[#3a3a4a]"></div> <span className="text-[#555]">Dominated</span></div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-[#1a1a28] text-[#555] font-mono text-[9px] space-y-0.5">
          <div><span className="text-[#f97316]">X</span> Cost (₹)</div>
          <div><span className="text-[#3b82f6]">Y</span> Time (min)</div>
          <div><span className="text-[#10b981]">Z</span> CO₂ (g)</div>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 z-10 text-[9px] text-[#333] font-mono pointer-events-none select-none">
        Drag to orbit · Scroll to zoom
      </div>
    </div>
  );
}
