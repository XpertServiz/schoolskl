'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Night sky behind the landing hero (after the owner's "Constellation" design): a deep sky dome, a Milky Way band with dust lanes,
 * two layers of twinkling stars, a cratered moon with a halo, three mountain ridges on the horizon, and an occasional shooting star.
 * Everything is procedural (no images, no network). It drifts slowly and leans toward the pointer; it never captures drags, so the page
 * scrolls normally. Pauses when off-screen or in a hidden tab; prefers-reduced-motion gets one still frame. If WebGL is unavailable,
 * the CSS sky behind it (landing.css .sky-fallback) stays.
 */

// ---- small seeded value noise + fbm (2D/3D)
function makeNoise(seed = 1337) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = P[i]!; P[i] = P[j]!; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i]!;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const n2 = (x: number, y: number) => {
    let X = Math.floor(x), Y = Math.floor(y); const xf = x - X, yf = y - Y; X &= 255; Y &= 255; const u = fade(xf), v = fade(yf);
    return lerp(lerp(V[P[P[X]! + Y]!]!, V[P[P[X + 1]! + Y]!]!, u), lerp(V[P[P[X]! + Y + 1]!]!, V[P[P[X + 1]! + Y + 1]!]!, u), v);
  };
  const n3 = (x: number, y: number, z: number) => {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); const xf = x - X, yf = y - Y, zf = z - Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const h = (a: number, b: number, c: number) => V[P[P[P[X + a]! + Y + b]! + Z + c]!]!;
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v), lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
  };
  const fbm2 = (x: number, y: number, o = 5) => { let a = 0.5, t = 0, n = 0; for (let i = 0; i < o; i++) { t += a * n2(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; } return t / n; };
  const fbm3 = (x: number, y: number, z: number, o = 5) => { let a = 0.5, t = 0, n = 0; for (let i = 0; i < o; i++) { t += a * n3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return t / n; };
  return { rnd, fbm2, fbm3 };
}

const D2R = Math.PI / 180;
const dir = (az: number, el: number) => new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R));
const glowTex = (stops: [number, string][], size = 128) => {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, size, size); return new THREE.CanvasTexture(c);
};

export default function NightSky({ onReady }: { onReady?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const host = cv?.parentElement;
    if (!cv || !host) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rd: THREE.WebGLRenderer;
    try { rd = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'low-power' }); } catch { return; }
    rd.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    rd.outputColorSpace = THREE.SRGBColorSpace;
    rd.toneMapping = THREE.ACESFilmicToneMapping;

    const N = makeNoise();
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(64, 1, 0.1, 4000);
    cam.rotation.order = 'YXZ';
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

    // ---- sky dome: zenith navy → horizon blue-slate, warm saffron glow low in the south
    const glowDir = dir(170, 0);
    const dome = new THREE.Mesh(keep(new THREE.SphereGeometry(1800, 48, 24)), keep(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { gd: { value: glowDir } },
      vertexShader: 'varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 vD;uniform vec3 gd;void main(){float h=clamp(vD.y,-.2,1.);vec3 zen=vec3(.008,.012,.035);vec3 hor=vec3(.035,.06,.12);vec3 c=mix(hor,zen,pow(max(h,0.),.55));float g=pow(max(dot(normalize(vec3(vD.x,0.,vD.z)),gd),0.),6.)*exp(-max(h,0.)*7.);c+=vec3(.35,.18,.05)*g*.35;c+=vec3(.03,.05,.1)*exp(-abs(h)*14.);gl_FragColor=vec4(c,1.);}',
    })));
    scene.add(dome);

    // ---- Milky Way band (canvas texture on an inner sphere)
    {
      const w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!, im = x.createImageData(w, h), d = im.data;
      const n = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.15);
      const v = new THREE.Vector3();
      for (let yy = 0; yy < h; yy++) {
        const lat = (0.5 - yy / h) * Math.PI;
        for (let xx = 0; xx < w; xx++) {
          const lon = (xx / w) * Math.PI * 2 - Math.PI / 2;
          v.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), -Math.cos(lat) * Math.cos(lon));
          const dd = v.dot(n), band = Math.exp((-dd * dd) / 0.018), core = Math.exp((-dd * dd) / 0.004);
          if (band < 0.01) continue;
          const f = N.fbm3(v.x * 3 + 2, v.y * 3, v.z * 3, 4), dust = N.fbm3(v.x * 7, v.y * 7 + 4, v.z * 7, 3);
          const a = band * (0.25 + f * 0.9) * (1 - 0.75 * Math.max(0, dust - 0.5) * 2 * core);
          const i = (yy * w + xx) * 4;
          d[i] = 170 + 60 * core; d[i + 1] = 180 + 45 * core; d[i + 2] = 230; d[i + 3] = Math.min(255, a * 150);
        }
      }
      x.putImageData(im, 0, 0);
      const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace;
      scene.add(new THREE.Mesh(keep(new THREE.SphereGeometry(1700, 48, 24)), keep(new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }))));
    }

    // ---- twinkling stars (point sprites with a shader)
    const starMats: THREE.ShaderMaterial[] = [];
    const stars = (count: number, R: number, opt: { band?: number; tilt?: number; pow?: number; min?: number; max?: number; opacity?: number; tint?: string; minY?: number }) => {
      const p = new Float32Array(count * 3), c = new Float32Array(count * 3), s = new Float32Array(count), ph = new Float32Array(count), col = new THREE.Color();
      const axis = new THREE.Vector3(1, 0, 0.3).normalize(), tint = opt.tint ? new THREE.Color(opt.tint) : null;
      for (let i = 0; i < count; i++) {
        let v: THREE.Vector3;
        if (opt.band) {
          const bt = Math.random() * Math.PI * 2, off = (Math.random() + Math.random() + Math.random() - 1.5) * opt.band;
          v = new THREE.Vector3(Math.cos(bt), off, Math.sin(bt)).normalize().applyAxisAngle(axis, opt.tilt ?? 1.05);
        } else { const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); v = new THREE.Vector3(r * Math.cos(t), u, r * Math.sin(t)); }
        if (opt.minY != null && v.y < opt.minY) { i--; continue; }
        p[i * 3] = v.x * R; p[i * 3 + 1] = v.y * R; p[i * 3 + 2] = v.z * R;
        const k = Math.random(); col.setHSL(k < 0.15 ? 0.08 : k < 0.3 ? 0.6 : 0.62, k < 0.3 ? 0.6 : 0.15, 0.82 + Math.random() * 0.18); if (tint) col.lerp(tint, 0.35);
        c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
        s[i] = (opt.min ?? 0.7) + Math.pow(Math.random(), opt.pow ?? 7) * (opt.max ?? 5); ph[i] = Math.random() * 6.283;
      }
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('size', new THREE.BufferAttribute(s, 1)); g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
      const m = keep(new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 }, px: { value: rd.getPixelRatio() }, op: { value: opt.opacity ?? 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'attribute float size;attribute float phase;attribute vec3 color;uniform float t;uniform float px;varying vec3 vC;varying float vA;void main(){vC=color;float tw=.72+.28*sin(t*(1.2+phase*.4)+phase*7.);vA=tw;gl_PointSize=size*px*(.85+.3*tw);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'varying vec3 vC;varying float vA;uniform float op;void main(){vec2 d=gl_PointCoord-.5;float r=length(d);float a=smoothstep(.5,0.,r);a=a*a;gl_FragColor=vec4(vC*(1.+.6*smoothstep(.18,0.,r)),a*vA*op);}',
      }));
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); starMats.push(m);
    };
    stars(5200, 1500, { pow: 8, max: 5, minY: -0.08 });
    stars(7000, 1490, { band: 0.1, tilt: 1.15, max: 1.5, min: 0.45, opacity: 0.6, tint: '#c6d2ff', pow: 3, minY: -0.08 });

    // ---- moon: cratered canvas texture, lit from the side, with a soft halo
    const MOON = dir(-30, 22);
    {
      const w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!, im = x.createImageData(w, h), d = im.data;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const f = N.fbm2(xx / 60, yy / 60, 5), mare = N.fbm2(xx / 140 + 9, yy / 140 + 3, 4);
        const v = 170 + f * 70 - Math.max(0, mare - 0.52) * 260; const i = (yy * w + xx) * 4;
        d[i] = v; d[i + 1] = v * 0.99; d[i + 2] = v * 0.95; d[i + 3] = 255;
      }
      x.putImageData(im, 0, 0);
      for (let k = 0; k < 220; k++) {
        const cx = N.rnd() * w, cy = h * 0.1 + N.rnd() * h * 0.8, r = 1 + Math.pow(N.rnd(), 3) * 18;
        const g = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
        g.addColorStop(0, 'rgba(60,58,55,.38)'); g.addColorStop(0.75, 'rgba(90,88,84,.2)'); g.addColorStop(0.9, 'rgba(255,255,250,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2); x.fill();
      }
      const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace;
      const mp = MOON.clone().multiplyScalar(320);
      const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(17, 64, 48)), keep(new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.06, roughness: 1, metalness: 0 })));
      moon.position.copy(mp); moon.lookAt(0, 0, 0); moon.rotateY(Math.PI * 0.5); scene.add(moon);
      const L = new THREE.DirectionalLight(0xfff6ea, 4.4);
      L.position.copy(mp.clone().add(MOON.clone().negate().multiplyScalar(70)).add(dir(-30 + 90, 10).multiplyScalar(62))); L.target = moon; scene.add(L, L.target);
      scene.add(new THREE.AmbientLight(0x223355, 0.15));
      const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(glowTex([[0, 'rgba(230,236,255,.5)'], [0.25, 'rgba(200,215,255,.16)'], [0.6, 'rgba(170,190,255,.04)'], [1, 'rgba(160,180,255,0)']], 256)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
      halo.position.copy(MOON.clone().multiplyScalar(330)); halo.scale.setScalar(190); scene.add(halo);
    }

    // ---- mountain ridges (three layers, farthest lightest)
    const ridge = (R: number, hmax: number, base: number, col: number, seed: number, freq: number) => {
      const seg = 480, pos: number[] = [], idx: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, x = Math.sin(a) * R, z = -Math.cos(a) * R;
        const hh = base + hmax * Math.pow(N.fbm2(Math.cos(a) * freq + seed, Math.sin(a) * freq + seed, 5), 1.6);
        pos.push(x, -R * 0.6, z, x, hh, z);
        if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      scene.add(new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }))));
    };
    ridge(900, 110, -14, 0x0a1224, 3, 2.2); ridge(600, 58, -16, 0x060a17, 11, 3.1); ridge(320, 22, -12, 0x02040a, 27, 4.4);

    // ---- shooting stars
    const shots: { line: THREE.Line; mat: THREE.LineBasicMaterial; p0: THREE.Vector3; d: THREE.Vector3; t: number; life: number }[] = [];
    const shoot = () => {
      const p0 = dir(-60 + N.rnd() * 120, 25 + N.rnd() * 40).multiplyScalar(1200);
      const d = new THREE.Vector3(N.rnd() - 0.5, -0.35 - N.rnd() * 0.3, N.rnd() - 0.5).normalize();
      const g = new THREE.BufferGeometry().setFromPoints([p0.clone(), p0.clone()]);
      g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.3, 0.4, 0.8], 3));
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(g, mat); scene.add(line); shots.push({ line, mat, p0, d, t: 0, life: 0.9 + N.rnd() * 0.5 });
    };

    // ---- camera: slow drift + lean toward the pointer (no drag: the page must scroll)
    const baseYaw = -6 * D2R, basePitch = 16 * D2R;
    let tx = 0, ty = 0, cx = 0, cy = 0, drift = 0;
    const onMove = (e: PointerEvent) => { const r = host.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5; };
    window.addEventListener('pointermove', onMove, { passive: true });

    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      rd.setSize(w, h, false); cam.aspect = w / h;
      cam.fov = w < 700 ? 78 : 64; // phones: a little wider so the moon and ridges stay in frame
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();

    let raf = 0, running = false, visible = true, last = performance.now(), nextShot = 3, announced = false;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = now / 1000;
      starMats.forEach((m) => { m.uniforms.t!.value = t; });
      drift += dt * 0.006;
      cx += (tx - cx) * Math.min(1, dt * 2); cy += (ty - cy) * Math.min(1, dt * 2);
      cam.rotation.y = baseYaw + drift - cx * 0.12;
      cam.rotation.x = basePitch - cy * 0.06;
      nextShot -= dt;
      if (nextShot <= 0 && !reduced) { shoot(); nextShot = 4 + N.rnd() * 7; }
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]!; s.t += dt; const k = s.t / s.life;
        const head = s.p0.clone().add(s.d.clone().multiplyScalar(420 * k)), tail = s.p0.clone().add(s.d.clone().multiplyScalar(Math.max(0, 420 * k - 140)));
        const pa = s.line.geometry.getAttribute('position') as THREE.BufferAttribute; pa.setXYZ(0, head.x, head.y, head.z); pa.setXYZ(1, tail.x, tail.y, tail.z); pa.needsUpdate = true;
        s.mat.opacity = Math.sin(Math.min(1, k) * Math.PI);
        if (k >= 1) { scene.remove(s.line); s.line.geometry.dispose(); s.mat.dispose(); shots.splice(i, 1); }
      }
      rd.render(scene, cam);
      if (!announced) { announced = true; onReady?.(); }
      if (running) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || reduced || !visible || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    if (reduced) frame(performance.now()); else start();

    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; if (visible) start(); else stop(); }, { threshold: 0.01 });
    io.observe(host);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stop(); io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      shots.forEach((s) => { s.line.geometry.dispose(); s.mat.dispose(); });
      disposables.forEach((x) => x.dispose());
      rd.dispose();
    };
  }, [onReady]);

  return <canvas ref={ref} className="sky-canvas" aria-hidden="true" />;
}
