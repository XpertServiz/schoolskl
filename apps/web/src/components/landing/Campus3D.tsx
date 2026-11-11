'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * "Pop-Up Campus": a small low-poly school that rises out of the ground, with a bus driving the loop around it.
 * Everything is procedural (no model files, no textures, no network): ~40 meshes, one shadow-casting light.
 *  - drag / swipe to rotate, otherwise it turns slowly; pauses when scrolled out of view or the tab is hidden;
 *  - prefers-reduced-motion: no pop-up, no spin, no bus — a single still frame;
 *  - if WebGL is unavailable the parent shows a static illustration instead (onFail).
 */
const C = { slate: 0x23303a, slate2: 0x2d3d49, paper: 0xece5d3, wall: 0xf1ead8, roof: 0xd9831f, saffron: 0xf5a524, glass: 0x7fb4d6, grass: 0x4f8f6b, grass2: 0x3d7357, trunk: 0x6b4f3a, road: 0x1d2830, white: 0xffffff };

const ease = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }; // easeOutBack: overshoots, then settles
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

export default function Campus3D({ label, onFail, onReady, name }: { label: string; onFail?: () => void; onReady?: () => void; name?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(10.5, 8.5, 12.5);
    camera.lookAt(0, 1.4, 0);

    // light: warm key from the upper left + cool sky fill
    scene.add(new THREE.HemisphereLight(0xcfe3f2, 0x2d3d49, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.1);
    sun.position.set(-7, 11, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const campus = new THREE.Group();
    scene.add(campus);
    const pops: { obj: THREE.Object3D; delay: number }[] = []; // things that grow up out of the ground, in order

    /** box standing on the ground at (x,z): grows upward from its base when it pops */
    const stand = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, pop = true) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true;
      campus.add(o); if (pop) pops.push({ obj: o, delay: pops.length * 70 }); return o;
    };

    // ground disc with a saffron rim and a road ring for the bus
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.7, 0.5, 64), mat(C.grass)); ground.position.y = -0.25; ground.receiveShadow = true; campus.add(ground);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(7.55, 0.09, 8, 96), mat(C.saffron)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0; campus.add(rim);
    const road = new THREE.Mesh(new THREE.RingGeometry(5.3, 6.3, 80), mat(C.road)); road.rotation.x = -Math.PI / 2; road.position.y = 0.012; road.receiveShadow = true; campus.add(road);
    const dash = new THREE.Mesh(new THREE.RingGeometry(5.78, 5.82, 80), mat(C.paper)); dash.rotation.x = -Math.PI / 2; dash.position.y = 0.02; campus.add(dash);

    // main hall + wings
    const wallM = mat(C.wall), roofM = mat(C.roof), glassM = mat(C.glass, { roughness: 0.3, emissive: 0x2a4a63, emissiveIntensity: 0.35 });
    stand(5, 2.1, 2.4, 0, 0, 0, wallM);
    stand(2.4, 1.7, 2, -3.7, 0, 0.5, wallM);
    stand(2.4, 1.7, 2, 3.7, 0, 0.5, wallM);
    // roofs (triangular prisms along x)
    const prism = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const s = new THREE.Shape(); s.moveTo(-d / 2 - 0.15, 0); s.lineTo(0, h); s.lineTo(d / 2 + 0.15, 0); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: w + 0.3, bevelEnabled: false }); g.translate(0, 0, -(w + 0.3) / 2); g.rotateY(Math.PI / 2);
      const o = new THREE.Mesh(g, roofM); o.position.set(x, y, z); o.castShadow = true; campus.add(o); pops.push({ obj: o, delay: pops.length * 70 }); return o;
    };
    prism(5, 1.0, 2.4, 0, 2.1, 0);
    prism(2.4, 0.8, 2, -3.7, 1.7, 0.5);
    prism(2.4, 0.8, 2, 3.7, 1.7, 0.5);
    // clock tower
    stand(1, 3.6, 1, 0, 2.1, -0.2, wallM);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.2, 4), roofM); spire.geometry.translate(0, 0.6, 0); spire.rotation.y = Math.PI / 4; spire.position.set(0, 5.7, -0.2); spire.castShadow = true; campus.add(spire); pops.push({ obj: spire, delay: pops.length * 70 });
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 24), mat(C.white)); clock.rotation.x = Math.PI / 2; clock.position.set(0, 4.7, 0.34); campus.add(clock);
    // flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), mat(0xcccccc)); pole.geometry.translate(0, 0.6, 0); pole.position.set(0, 6.8, -0.2); campus.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36, 6, 1), new THREE.MeshStandardMaterial({ color: C.saffron, side: THREE.DoubleSide, roughness: 0.9 })); flag.position.set(0.3, 7.7, -0.2); campus.add(flag);
    // door + windows on the front (+z) faces
    const doorM = mat(0x5a3d2b);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.08), doorM); door.position.set(0, 0.6, 1.22); campus.add(door);
    const win = (x: number, y: number, z: number) => { const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.06), glassM); w.position.set(x, y, z); campus.add(w); };
    if (name) {
      // the school's own name as a banner on the front wall, above the door (a canvas texture: text is drawn, never injected as HTML)
      const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 200;
      const g2 = bc.getContext('2d')!;
      const gr = g2.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, '#ffc560'); gr.addColorStop(1, '#e8891a');
      g2.fillStyle = gr; g2.fillRect(0, 0, 1024, 200); g2.strokeStyle = '#7a4a0c'; g2.lineWidth = 10; g2.strokeRect(8, 8, 1008, 184);
      g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = '#1a1405';
      let fs = 110; do { g2.font = `800 ${fs}px sans-serif`; fs -= 4; } while (g2.measureText(name).width > 940 && fs > 28);
      g2.fillText(name, 512, 104);
      const tex = new THREE.CanvasTexture(bc); tex.colorSpace = THREE.SRGBColorSpace;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.82), new THREE.MeshBasicMaterial({ map: tex })); banner.position.set(0, 1.62, 1.215); campus.add(banner);
    } else for (const x of [-1.8, -1.1, 1.1, 1.8]) win(x, 1.25, 1.22);
    for (const x of [-4.3, -3.1, 3.1, 4.3]) win(x, 1.0, 1.52);
    // steps + path to the road
    stand(1.4, 0.15, 0.6, 0, 0, 1.55, mat(0xb9b2a0), false);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.2), mat(0xcfc7b3)); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.015, 3.3); path.receiveShadow = true; campus.add(path);

    // trees
    const tree = (x: number, z: number, s: number) => {
      const t = new THREE.Group(); t.position.set(x, 0, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.12 * s, 0.7 * s, 6), mat(C.trunk)); trunk.geometry.translate(0, 0.35 * s, 0); trunk.castShadow = true; t.add(trunk);
      const l1 = new THREE.Mesh(new THREE.ConeGeometry(0.6 * s, 1.1 * s, 7), mat(C.grass2)); l1.geometry.translate(0, 1.2 * s, 0); l1.castShadow = true; t.add(l1);
      const l2 = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, 0.9 * s, 7), mat(0x468a63)); l2.geometry.translate(0, 1.85 * s, 0); l2.castShadow = true; t.add(l2);
      campus.add(t); pops.push({ obj: t, delay: pops.length * 70 });
    };
    ([[-2.6, 3.2, 1], [2.6, 3.3, 1.1], [-4.8, -2.4, 1.2], [4.9, -2.2, 1], [-1.4, -3.2, 0.9], [1.9, -3.4, 1.1], [-5.6, 1.4, 0.9], [5.6, 1.6, 1]] as const).forEach(([x, z, s]) => tree(x, z, s));

    // the bus (SafeRoute hint): drives the ring road
    const bus = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 0.62), mat(C.saffron)); body.position.y = 0.55; body.castShadow = true; bus.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 0.58), mat(0xd9831f)); top.position.y = 0.9; bus.add(top);
    for (const x of [-0.45, 0, 0.45]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.64), glassM); w.position.set(x, 0.66, 0); bus.add(w); }
    for (const [x, z] of [[-0.5, 0.31], [0.5, 0.31], [-0.5, -0.31], [0.5, -0.31]] as const) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 12), mat(0x14191e)); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.17, z); bus.add(wh); }
    bus.visible = !reduced; campus.add(bus);

    // ---- sizing
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const k = Math.max(1, 1.18 / camera.aspect); // narrow containers: pull the camera back so the whole campus fits
      camera.position.set(10.5 * k, 8.5 * k, 12.5 * k); camera.lookAt(0, 1.6, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // ---- interaction: drag to rotate
    let dragging = false, lastX = 0, vel = 0, yaw = -0.5;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; vel = 0; renderer.domElement.setPointerCapture(e.pointerId); renderer.domElement.style.cursor = 'grabbing'; };
    const move = (e: PointerEvent) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; yaw += dx * 0.008; vel = dx * 0.008; if (reduced) draw(performance.now()); };
    const up = (e: PointerEvent) => { dragging = false; renderer.domElement.style.cursor = 'grab'; if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId); };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);

    // ---- loop
    let raf = 0, visible = true, running = false;
    const t0 = performance.now() + 250; // a beat after mount, so the page settles before the campus rises
    const draw = (now: number) => {
      const t = now - t0;
      for (const p of pops) {
        const k = reduced ? 1 : Math.min(1, Math.max(0, (t - p.delay) / 900));
        p.obj.scale.y = Math.max(0.001, ease(k)); p.obj.visible = k > 0 || reduced;
      }
      if (!reduced) {
        if (!dragging) { yaw += 0.0022 + vel; vel *= 0.94; }
        const a = now * 0.00045; // bus angle
        bus.position.set(Math.cos(a) * 5.8, 0, Math.sin(a) * 5.8); bus.rotation.y = -a - Math.PI / 2;
        const pos = flag.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(now * 0.006 + x * 6) * 0.05 * (x + 0.3)); }
        pos.needsUpdate = true;
      }
      campus.rotation.y = yaw;
      renderer.render(scene, camera);
      if (!announced) { announced = true; onReady?.(); }
    };
    let announced = false;
    const loop = (now: number) => { if (!running) return; draw(now); raf = requestAnimationFrame(loop); };
    const start = () => { if (reduced || running || !visible || document.hidden) return; running = true; raf = requestAnimationFrame(loop); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; visible ? start() : stop(); }, { threshold: 0.05 });
    io.observe(el);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    if (reduced) draw(performance.now() + 5000); else start();

    return () => {
      stop(); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up);
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mm = m.material; if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((x) => x.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [onFail, onReady, name]);

  return <div ref={host} role="img" aria-label={label} style={{ width: '100%', height: '100%' }} />;
}
