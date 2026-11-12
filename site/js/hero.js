// The live hero mark: about 220 instanced tiles that read as a video and reflow into a recipe.
// three.js is the site's only third-party request. It is fetched from THREE_URL only when this module is
// asked to mount (js/hero-boot.js decides: never under reduced motion, never without WebGL 2, and not before
// the hero is on screen), so the page works without it: the inline SVG poster stays in place.
//
// Rails: one canvas, device pixel ratio capped (1.5 on touch and narrow screens, 1.75 elsewhere), one
// InstancedMesh, rendering paused while the canvas is off-screen or the tab is hidden.
// The rest pose faces the viewer. Pointer tilt, idle sway and the scroll turn all return to it, and the
// scroll turn is zero at progress 0 and 1.

import { buildTiles, GRID, MAX_DELAY } from './hero-shapes.js';
import { clamp01, easeInOut, lerp, smoothstep } from './stage-math.js';

/** The CDN build of three.js r170 (jsDelivr). Must equal three_url in site/brand.json. */
export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

/**
 * Tile colours per page theme: the --ink and --accent tokens of css/site.css (a test compares them), so the
 * live mark and the SVG poster are the same colours. Light pages get dark tiles so the mark reads on paper.
 */
export const PALETTES = {
  dark: { tile: '#f4eee7', accent: '#f08a4b', rim: '#f08a4b' },
  light: { tile: '#1f1a16', accent: '#c2410c', rim: '#f5a06a' },
};

// Lights. three.js r155+ uses physical light units, so these are higher than the pre-r155 defaults.
const LIGHTS = { sky: 1.7, key: 2.6, rim: 1.1 };
const SPRING_K = 120;
const SPRING_C = 14;
const PUSH = 2.4; // how far a tile under the pointer lifts, in tile units
const RADIUS = 4.2; // pointer reach, in tile units
const REST_TILT = -0.08;

/** three.js r163+ needs WebGL 2. Probe it on a throwaway canvas before constructing a renderer. */
export function webgl2Available() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mounts the mark into `container` (the module owns the canvas and sizes it with a ResizeObserver).
 * Options: theme ('light' | 'dark'), fit (share of the canvas the mark may fill), onState(isRecipe) and
 * onLost() callbacks. Rejects when three.js cannot be loaded or the renderer cannot start.
 * Returns { ready, setProgress(0..1), setTheme(name), toggle(), dispose() }.
 */
export async function mountHero(container, { theme = 'light', fit = 0.86, onState, onLost } = {}) {
  const THREE = await import(THREE_URL);
  const tiles = buildTiles();
  const count = tiles.length;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const touchy = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touchy ? 1.5 : 1.75));
  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 500);
  const group = new THREE.Group();
  group.rotation.x = REST_TILT;
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2f26, LIGHTS.sky));
  const keyLight = new THREE.DirectionalLight(0xffffff, LIGHTS.key);
  keyLight.position.set(-8, 12, 18);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, LIGHTS.rim);
  rimLight.position.set(10, -6, 8);
  scene.add(rimLight);

  const geometry = new THREE.BoxGeometry(0.84, 0.84, 0.62);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.08 });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  group.add(mesh);

  const tileColor = new THREE.Color();
  const accentColor = new THREE.Color();
  const scratch = new THREE.Color();
  function applyTheme(name) {
    const p = PALETTES[name] ?? PALETTES.light;
    tileColor.set(p.tile);
    accentColor.set(p.accent);
    rimLight.color.set(p.rim);
  }
  applyTheme(theme);

  // ---- state ----
  const lift = new Float32Array(count); // spring offset along z per tile
  const speed = new Float32Array(count);
  const dummy = new THREE.Object3D();
  const pointer = { active: false, x: 0, y: 0, nx: 0, ny: 0 };
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  let progress = 0; // scroll progress from the page, 0..1
  let base = 0; // 0 = video, 1 = recipe: the shape when the page is not scrolled
  let morph = 0; // the smoothed shape actually drawn
  let userSet = false;
  let autoClock = 0;
  let autoStage = 0; // 0 waiting, 1 showing the recipe, 2 finished (the demo runs once, then stops)
  let time = 0;
  let running = false;
  let visible = true;
  let disposed = false;
  let rafId = 0;
  let last = 0;

  function setBase(value) {
    base = value;
    onState?.(base === 1);
  }

  function step(dt) {
    time += dt;

    // One unprompted demonstration: video, then recipe, then back. It stops for good on any interaction.
    if (!userSet && autoStage < 2 && progress < 0.05) {
      autoClock += dt;
      if (autoStage === 0 && autoClock > 2.4) { autoStage = 1; autoClock = 0; setBase(1); }
      else if (autoStage === 1 && autoClock > 4.2) { autoStage = 2; setBase(0); }
    }

    const target = Math.max(base, smoothstep(progress));
    morph += (target - morph) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(target - morph) < 0.0005) morph = target;

    const yaw = pointer.nx * 0.16 + Math.sin(time * 0.5) * 0.03 + Math.sin(Math.PI * progress) * 0.5;
    const tilt = REST_TILT - pointer.ny * 0.1 + Math.sin(time * 0.37) * 0.018;
    const settle = 1 - Math.exp(-dt * 5);
    group.rotation.y += (yaw - group.rotation.y) * settle;
    group.rotation.x += (tilt - group.rotation.x) * settle;

    const span = 1 - MAX_DELAY;
    const head = 20 - ((time % 7) / 7) * 56; // a soft light band that runs down the mark
    for (let i = 0; i < count; i++) {
      const t = tiles[i];
      const k = easeInOut(clamp01((morph - t.delay) / span));
      const arc = Math.sin(Math.PI * k);
      const x = lerp(t.ax, t.bx, k);
      const y = lerp(t.ay, t.by, k);
      const s = lerp(t.as, t.bs, k);

      let push = 0;
      if (pointer.active) {
        const d = Math.hypot(x - pointer.x, y - pointer.y);
        if (d < RADIUS) { const f = 1 - d / RADIUS; push = f * f * PUSH; }
      }
      speed[i] += (SPRING_K * (push - lift[i]) - SPRING_C * speed[i]) * dt;
      lift[i] += speed[i] * dt;

      dummy.position.set(x, y, t.z0 + lift[i] + arc * t.lift);
      dummy.rotation.set(0, 0, arc * t.spin);
      dummy.scale.setScalar(Math.max(0.0001, s));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const from = t.aAccent ? accentColor : tileColor;
      const to = t.bAccent ? accentColor : tileColor;
      const band = Math.exp(-((y - head) * (y - head)) / 8) * 0.22;
      const glow = 1 + clamp01(lift[i] / PUSH) * 0.35 + band;
      scratch.setRGB(lerp(from.r, to.r, k) * glow, lerp(from.g, to.g, k) * glow, lerp(from.b, to.b, k) * glow);
      mesh.setColorAt(i, scratch);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const forHeight = (GRID.rows + 1) / fit / (2 * tan);
    const forWidth = (GRID.cols + 1) / fit / (2 * tan * camera.aspect);
    camera.position.set(0, 0, Math.max(forHeight, forWidth));
    camera.updateProjectionMatrix();
    if (!running && !disposed) renderer.render(scene, camera);
  }

  function loop(now) {
    rafId = 0;
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    step(dt);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  function sync() {
    const should = visible && !document.hidden && !disposed;
    if (should && !running) {
      running = true;
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ---- input ----
  // Hover is read from the window, not from the canvas: as a fixed layer behind the page content the canvas
  // takes no pointer events (css/site.css), so it can never swallow a click meant for the page.
  function onPointerMove(e) {
    if (!running) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      if (pointer.active || pointer.nx || pointer.ny) onPointerOut();
      return;
    }
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    pointer.nx = ndc.x;
    pointer.ny = ndc.y;
    raycaster.setFromCamera(ndc, camera);
    group.updateMatrixWorld();
    if (raycaster.ray.intersectPlane(plane, hit)) {
      group.worldToLocal(hit);
      pointer.x = hit.x;
      pointer.y = hit.y;
      pointer.active = true;
    }
  }
  function onPointerOut() {
    pointer.active = false;
    pointer.nx = 0;
    pointer.ny = 0;
  }
  function toggle() {
    userSet = true;
    setBase(base === 1 ? 0 : 1);
    return base === 1;
  }
  function onContextLost(e) {
    e.preventDefault();
    onLost?.();
  }
  const onPointerEnd = (e) => { if (e.pointerType !== 'mouse') onPointerOut(); };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerEnd, { passive: true });
  window.addEventListener('pointercancel', onPointerOut, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerOut);
  // Only reachable while the canvas sits in the hero slot; as a fixed layer it gets no clicks.
  canvas.addEventListener('click', toggle);
  canvas.addEventListener('webglcontextlost', onContextLost);

  const sizeWatch = new ResizeObserver(resize);
  sizeWatch.observe(container);
  const viewWatch = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    sync();
  });
  viewWatch.observe(container);
  document.addEventListener('visibilitychange', sync);

  // First frame now, so `ready` does not depend on the canvas being on screen.
  resize();
  step(0.016);
  renderer.render(scene, camera);
  sync();

  return {
    ready: Promise.resolve(true),
    setProgress(p) { progress = clamp01(Number(p) || 0); },
    setTheme(name) { applyTheme(name); },
    toggle,
    dispose() {
      if (disposed) return;
      disposed = true;
      sync();
      sizeWatch.disconnect();
      viewWatch.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerOut);
      document.documentElement.removeEventListener('pointerleave', onPointerOut);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
