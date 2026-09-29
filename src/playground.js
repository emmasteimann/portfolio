// Poke-able slime: a small shape-matching soft body (Müller et al. 2005) simulated on the CPU,
// rendered as ray-marched metaballs with SlimeLab's look: refraction through the body,
// thickness-based absorption, Fresnel reflections, glow eyes and a contact shadow.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Rest shape: rings of particles stacked into a dome.

const RINGS = [
  { y: 0.2, radius: 0.45, count: 8 },
  { y: 0.46, radius: 0.34, count: 7 },
  { y: 0.72, radius: 0.18, count: 5 },
];
const REST = [];
for (const ring of RINGS) {
  REST.push(new THREE.Vector3(0, ring.y, 0));
  for (let i = 0; i < ring.count; i++) {
    const a = (i / ring.count) * Math.PI * 2 + ring.y * 3;
    REST.push(new THREE.Vector3(Math.cos(a) * ring.radius, ring.y, Math.sin(a) * ring.radius));
  }
}
const N = REST.length;                 // 23
const BALL_RADIUS = 0.27;              // rendered radius of each metaball
const BLEND = 0.2;                     // smooth-min blend distance
const CORE = 0.1;                      // collision radius of a particle
const FLOOR = 0.07;
const FINGER_RADIUS = 0.2;
const EYE_SOCKETS = [new THREE.Vector3(-0.17, 0.5, -0.56), new THREE.Vector3(0.17, 0.5, -0.56)];

const restCenter = REST.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(N);
// The bottom ring carries the body's weight when it rests on the floor.
const IS_BOTTOM = REST.map((p) => p.y < 0.3);
const N_BOTTOM = IS_BOTTOM.filter(Boolean).length;
const restOffsets = REST.map((p) => p.clone().sub(restCenter));

// Each eye rides the deformation of the three particles nearest its socket.
const eyeRig = EYE_SOCKETS.map((socket) => {
  const nearest = REST.map((p, i) => ({ i, d: p.distanceTo(socket) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const total = nearest.reduce((s, n) => s + 1 / n.d, 0);
  return { offset: socket.clone().sub(restCenter), weights: nearest.map((n) => ({ i: n.i, w: 1 / n.d / total })) };
});

// ---------------------------------------------------------------------------------------------

const fragmentShader = /* glsl */ `
precision highp float;

#define N ${N}
uniform vec4 uP[N];           // particle centers (xyz)
uniform vec3 uEyes[2];
uniform vec4 uBound;          // bounding sphere of the body
uniform vec2 uResolution;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uFocal;
uniform float uTime;
uniform float uBlink;
uniform int uView;            // 0 beauty, 1 normals, 2 thickness, 3 march steps, 4 particles

const float R = ${BALL_RADIUS.toFixed(3)};
const float K = ${BLEND.toFixed(3)};

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdBlobs(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < N; i++) {
    float s = length(p - uP[i].xyz) - R;
    d = uView == 4 ? min(d, s) : smin(d, s, K);
  }
  return d;
}

// The visible body is cut flat where it sits on the floor.
float sdBody(vec3 p) { return max(sdBlobs(p), -p.y); }

vec3 blobsNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.002;
  return normalize(k.xyy * sdBlobs(p + k.xyy * h) + k.yyx * sdBlobs(p + k.yyx * h) +
                   k.yxy * sdBlobs(p + k.yxy * h) + k.xxx * sdBlobs(p + k.xxx * h));
}

vec3 bodyNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.002;
  return normalize(k.xyy * sdBody(p + k.xyy * h) + k.yyx * sdBody(p + k.yyx * h) +
                   k.yxy * sdBody(p + k.yxy * h) + k.xxx * sdBody(p + k.xxx * h));
}

vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  return clamp(vec3(
    0.14 + x * (4.6 - x * 3.9),
    0.09 + x * (3.4 - x * 3.1) + x * x * 0.4,
    0.5 + x * (2.2 - x * 4.1) + x * x * 1.6), 0.0, 1.0);
}

// Soft occlusion of the floor by the particles (sphere AO), for the contact shadow.
float floorShadow(vec3 fp) {
  float occ = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 v = uP[i].xyz - fp;
    float d2 = dot(v, v);
    occ += (R * R / d2) * max(v.y, 0.0) * inversesqrt(d2);
  }
  return 1.0 - clamp(occ * 0.55, 0.0, 0.88);
}

// The world around the slime (matches the hero CRT): a dusk sky with a glowing horizon and a
// neon grid floor. It's what you see behind the slime, through it and reflected in it.
vec3 environment(vec3 ro, vec3 rd, bool withShadow) {
  vec3 col = mix(vec3(0.24, 0.11, 0.36), vec3(0.05, 0.03, 0.12), clamp(rd.y * 2.2 + 0.2, 0.0, 1.0));
  col += vec3(0.85, 0.32, 0.55) * exp(-abs(rd.y - 0.02) * 9.0) * 0.55;             // horizon glow
  col += vec3(1.0, 0.55, 0.35) * pow(max(dot(rd, normalize(vec3(-0.5, 0.35, 1.0))), 0.0), 60.0) * 1.2; // low sun
  col += vec3(0.5, 0.9, 1.0) * pow(max(dot(rd, normalize(vec3(0.3, 0.9, -0.2))), 0.0), 8.0) * 0.35;   // soft top light

  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    vec3 fp = ro + rd * t;
    vec2 g = abs(fract(fp.xz * 1.6) - 0.5);
    float line = smoothstep(0.43, 0.49, max(g.x, g.y));
    vec3 fcol = vec3(0.07, 0.04, 0.11) + line * vec3(0.55, 0.22, 0.85) * exp(-t * 0.18);
    if (withShadow) fcol *= floorShadow(fp);
    // Light transmitted through the goo tints the floor under and around it teal.
    vec2 fu = (fp.xz - uBound.xz) / max(uBound.w * 0.75, 0.3);
    fcol += vec3(0.1, 0.5, 0.42) * 0.35 * exp(-dot(fu, fu) * 1.6);
    col = mix(col, fcol, smoothstep(0.0, 0.02, -rd.y));
  }
  return col;
}

void main() {
  vec2 sp = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamFwd * uFocal + uCamRight * sp.x + uCamUp * sp.y);

  vec3 col = environment(ro, rd, true);

  // Only march where the ray meets the body's bounding sphere.
  vec3 oc = ro - uBound.xyz;
  float b = dot(oc, rd);
  float disc = b * b - dot(oc, oc) + uBound.w * uBound.w;
  float steps = 0.0;
  bool hit = false;
  float t = 0.0;
  if (disc > 0.0) {
    t = max(-b - sqrt(disc), 0.0);
    float tEnd = -b + sqrt(disc);
    for (int i = 0; i < 64; i++) {
      steps += 1.0;
      float d = sdBody(ro + rd * t);
      if (d < 0.0015) { hit = true; break; }
      t += d;
      if (t > tEnd) break;
    }
  }

  vec3 n = vec3(0.0);
  float thick = 0.0;
  if (hit) {
    vec3 p = ro + rd * t;
    n = bodyNormal(p);
    float cosV = max(dot(n, -rd), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);

    // Refract in, march to the far side, refract out.
    vec3 rIn = refract(rd, n, 1.0 / 1.33);
    thick = 0.02;
    // March the uncut blobs: exiting through their rounded underside instead of the flat floor
    // cut avoids a hard seam in what you see through the body.
    for (int i = 0; i < 20; i++) {
      float d = -sdBlobs(p + rIn * thick);
      if (d < 0.002) break;
      thick += max(d, 0.012);
    }
    vec3 exitP = p + rIn * thick;
    vec3 nOut = -blobsNormal(exitP);
    vec3 rOut = refract(rIn, nOut, 1.33);
    if (dot(rOut, rOut) < 0.01) rOut = reflect(rIn, nOut);
    vec3 behind = environment(exitP, rOut, false);

    vec3 absorb = exp(-thick * vec3(0.95, 0.16, 0.3));
    vec3 slime = behind * vec3(0.55, 1.05, 0.92) * absorb * 1.7 + vec3(0.12, 0.62, 0.5) * (1.0 - absorb.r) * 0.38;

    vec3 rr = reflect(rd, n);
    slime = mix(slime, environment(p, rr, false) * 1.3, fres);
    slime += pow(max(dot(rr, normalize(vec3(-0.8, 0.45, 0.4))), 0.0), 120.0) * vec3(1.0, 0.8, 0.6) * 2.5;
    slime += pow(1.0 - cosV, 3.0) * vec3(0.35, 0.9, 0.8) * 0.3;

    // Eyes: glowing ovals centered on points that ride the surface.
    for (int k = 0; k < 2; k++) {
      vec3 e = uEyes[k];
      float te = dot(e - ro, rd);
      vec3 o = ro + rd * te - e;
      vec2 q = vec2(dot(o, uCamRight) / 0.055, dot(o, uCamUp) / mix(0.01, 0.085, uBlink));
      float eye = (1.0 - smoothstep(0.75, 1.0, length(q))) * step(abs(te - t), 0.25);
      slime = mix(slime, vec3(0.85, 1.0, 0.95) * 1.8, eye);
    }
    col = slime;
  }

  if (uView == 1) col = hit ? n * 0.5 + 0.5 : vec3(0.05, 0.04, 0.08);
  if (uView == 2) col = hit ? heat(thick / 1.2) : vec3(0.05, 0.04, 0.08);
  if (uView == 3) col = heat(steps / 40.0);
  if (uView == 4 && hit) col = n * 0.35 + 0.35 + vec3(0.1, 0.25, 0.2);

  vec2 v = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - 0.3 * dot(v, v);
  gl_FragColor = vec4(col, 1.0);
}
`;

const vertexShader = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------------------------------------------------------------------------------------------

export function initPlayground(root, { onStats } = {}) {
  const container = root.querySelector('.playground-canvas');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('debug'), // screenshots while tuning
    });
  } catch {
    root.classList.add('no-webgl');
    return null;
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Camera.
  const camPos = new THREE.Vector3(0, 0.78, -2.45);
  const camTarget = new THREE.Vector3(0, 0.4, 0);
  const fwd = camTarget.clone().sub(camPos).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize().negate();
  const up = new THREE.Vector3().crossVectors(fwd, right).negate();
  const focal = 2.1;

  const uniforms = {
    uP: { value: Array.from({ length: N }, () => new THREE.Vector4()) },
    uEyes: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uBound: { value: new THREE.Vector4() },
    uResolution: { value: new THREE.Vector2() },
    uCamPos: { value: camPos },
    uCamRight: { value: right },
    uCamUp: { value: up },
    uCamFwd: { value: fwd },
    uFocal: { value: focal },
    uTime: { value: 0 },
    uBlink: { value: 1 },
    uView: { value: 0 },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms })));

  // --- Simulation state -------------------------------------------------------------------
  const x = REST.map((p) => p.clone());
  const v = REST.map(() => new THREE.Vector3());
  const xp = REST.map(() => new THREE.Vector3());
  const center = new THREE.Vector3();
  const finger = { active: false, pos: new THREE.Vector3(), radius: FINGER_RADIUS };
  const press = { t: -1 };        // "Squish" button animation
  let lastInteraction = performance.now();
  let idleOff = false;
  let lastHop = 0;

  const tmp = new THREE.Vector3();
  const goal = new THREE.Vector3();

  function grounded() {
    return x.some((p) => p.y < FLOOR + 0.02);
  }

  function jump() {
    if (!grounded()) return;
    const drift = center.clone().multiplyScalar(-0.8); // hop back toward the middle
    for (const vel of v) vel.add(new THREE.Vector3(drift.x, 3.1, drift.z));
  }

  // Jiggle (0..1) sets how the body springs back to its rest shape: wobbly and slow at 0,
  // firm at 1. Damping stays light so it overshoots and wobbles instead of just settling.
  let jiggle = 0.35;
  let support = 1;                 // 0 airborne .. 1 resting on the floor (smoothed)
  const comVel = new THREE.Vector3();

  function step(h) {
    const k = THREE.MathUtils.lerp(35, 260, jiggle);           // spring stiffness (1/s²)
    const zeta = THREE.MathUtils.lerp(0.06, 0.25, jiggle);     // damping ratio
    const c = 2 * zeta * Math.sqrt(k);

    // Shape matching as a force: a spring pulls each particle toward its slot in the rest shape
    // around the center of mass, damped only relative to the body's own motion (so falling and
    // hopping aren't damped, only the wobble).
    center.set(0, 0, 0);
    comVel.set(0, 0, 0);
    for (let i = 0; i < N; i++) { center.add(x[i]); comVel.add(v[i]); }
    center.divideScalar(N);
    comVel.divideScalar(N);
    // Gravity pre-compensation: resting on the floor, soft springs would sag under the body's
    // weight (the floor pushes only on the bottom ring). Offset each spring's target by the sag it
    // would have: upper particles up by g/k, the bottom ring down to match, summing to zero so
    // there's no net lift. It fades out in the air, so a hop still stretches and wobbles freely.
    const grounded = x.some((p) => p.y < FLOOR + 0.02) ? 1 : 0;
    support += (grounded - support) * Math.min(1, h * 12);
    const sag = support * 9.8 / k;
    for (let i = 0; i < N; i++) {
      const bias = IS_BOTTOM[i] ? -sag * (N / N_BOTTOM - 1) : sag;
      goal.copy(center).add(restOffsets[i]);
      goal.y += bias;
      goal.sub(x[i]).multiplyScalar(k);
      tmp.subVectors(v[i], comVel).multiplyScalar(c);
      v[i].addScaledVector(goal.sub(tmp), h);
      v[i].y -= 9.8 * h;
      xp[i].copy(x[i]).addScaledVector(v[i], h);
    }

    // Keep particles from collapsing into each other.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        tmp.subVectors(xp[j], xp[i]);
        const d = tmp.length();
        const min = CORE * 1.6;
        if (d < min && d > 1e-6) {
          tmp.multiplyScalar((min - d) / d * 0.5);
          xp[i].sub(tmp);
          xp[j].add(tmp);
        }
      }
    }

    // Colliders: the finger (pointer) and the squish press.
    const colliders = [];
    if (finger.active) colliders.push({ c: finger.pos, r: finger.radius, strength: 0.8 });
    if (press.t >= 0) {
      const u = press.t;                                   // 0..1.6 s
      const depth = u < 0.55 ? u / 0.55 : u < 1.0 ? 1 : Math.max(0, 1 - (u - 1.0) / 0.4);
      colliders.push({ c: new THREE.Vector3(center.x, 1.95 - depth * 0.64, center.z), r: 1.1, strength: 0.35 }); // bottoms out ~0.2 above the floor
    }
    for (const { c, r, strength } of colliders) {
      for (let i = 0; i < N; i++) {
        tmp.subVectors(xp[i], c);
        const d = tmp.length();
        const min = r + CORE;
        // Push out by a fraction per substep; the speed cap below keeps pokes from launching it.
        if (d < min) xp[i].addScaledVector(tmp, (min - d) / Math.max(d, 1e-4) * strength);
      }
    }

    for (let i = 0; i < N; i++) {
      const p = xp[i];
      // Floor with friction, and invisible walls to stay in frame.
      if (p.y < FLOOR) {
        p.y = FLOOR;
        p.x = x[i].x + (p.x - x[i].x) * 0.6;
        p.z = x[i].z + (p.z - x[i].z) * 0.6;
      }
      p.x = THREE.MathUtils.clamp(p.x, -1.9, 1.9);
      p.z = THREE.MathUtils.clamp(p.z, -0.9, 1.4);
      v[i].subVectors(p, x[i]).divideScalar(h).multiplyScalar(0.996);
      v[i].clampLength(0, 4.5);
      x[i].copy(p);
    }
  }

  function upload() {
    let radius = 0;
    center.set(0, 0, 0);
    for (const p of x) center.add(p);
    center.divideScalar(N);
    for (let i = 0; i < N; i++) {
      uniforms.uP.value[i].set(x[i].x, x[i].y, x[i].z, 0);
      radius = Math.max(radius, x[i].distanceTo(center));
    }
    uniforms.uBound.value.set(center.x, center.y, center.z, radius + BALL_RADIUS + BLEND);

    eyeRig.forEach((rig, k) => {
      const e = uniforms.uEyes.value[k].copy(center).add(rig.offset);
      for (const { i, w } of rig.weights) {
        e.addScaledVector(tmp.copy(x[i]).sub(center).sub(restOffsets[i]), w);
      }
    });
  }

  // --- Input ------------------------------------------------------------------------------
  const canvas = renderer.domElement;
  function pointerToWorld(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) * 2 - rect.width) / rect.height;
    const sy = -((e.clientY - rect.top) * 2 - rect.height) / rect.height;
    const rd = fwd.clone().multiplyScalar(focal).addScaledVector(right, sx).addScaledVector(up, sy).normalize();
    // Poke the front of the body: ray-cast against the particles' spheres and sink the finger a
    // little past the first hit, so it dents the goo. Off the body, it pushes at the body's depth.
    let tHit = Infinity;
    for (const p of x) {
      const oc = camPos.clone().sub(p);
      const b = oc.dot(rd);
      const disc = b * b - oc.lengthSq() + BALL_RADIUS * BALL_RADIUS;
      if (disc > 0) tHit = Math.min(tHit, -b - Math.sqrt(disc));
    }
    const t = Number.isFinite(tHit) ? tHit + FINGER_RADIUS * 0.6 : (center.z - camPos.z) / rd.z;
    return camPos.clone().addScaledVector(rd, t);
  }
  canvas.addEventListener('pointerdown', (e) => {
    finger.active = true;
    finger.pos.copy(pointerToWorld(e));
    canvas.setPointerCapture(e.pointerId);
    lastInteraction = performance.now();
    root.classList.add('is-touched');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!finger.active) return;
    finger.pos.copy(pointerToWorld(e));
    lastInteraction = performance.now();
  });
  const release = () => { finger.active = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // --- Loop -------------------------------------------------------------------------------
  let visible = false;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.05 }).observe(container);

  // Dynamic resolution: trade pixels for frame rate on slower GPUs.
  const dpr = Math.min(window.devicePixelRatio, 2);
  let scale = 0.75;
  const resize = () => {
    renderer.setPixelRatio(dpr * scale);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
  };
  new ResizeObserver(resize).observe(container);
  resize();

  let last = performance.now();
  let frameTimes = [];
  let simMs = 0;

  function tick(dt, now) {
    // Idle: hop now and then so it's alive before anyone touches it.
    if (!reducedMotion && !idleOff && now - lastInteraction > 5000 && now - lastHop > 3500) {
      lastHop = now;
      jump();
    }
    if (press.t >= 0) {
      press.t += dt;
      if (press.t > 1.6) press.t = -1;
    }

    const t0 = performance.now();
    const substeps = 4;
    for (let s = 0; s < substeps; s++) step(dt / substeps);
    upload();
    simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;

    uniforms.uTime.value = now / 1000;
    uniforms.uBlink.value = (now / 1000 * 0.23 + 0.1) % 1 < 0.05 ? 0 : 1;
    renderer.render(scene, camera);
  }

  const frame = (now) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    tick(dt, now);

    frameTimes.push(dt);
    if (frameTimes.length >= 30) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      frameTimes = [];
      const prev = scale;
      if (avg > 0.021 && scale > 0.35) scale *= 0.85;
      else if (avg < 0.0175 && scale < 1) scale = Math.min(1, scale * 1.08);
      if (scale !== prev) resize();
      const res = uniforms.uResolution.value;
      onStats?.({ particles: N, simMs, width: res.x, height: res.y, fps: Math.round(1 / avg) });
    }
  };
  requestAnimationFrame(frame);

  const api = {
    setView(view) { uniforms.uView.value = view; },
    setJiggle(value) { jiggle = THREE.MathUtils.clamp(value, 0, 1); },
    squish() { if (press.t < 0) { press.t = 0; lastInteraction = performance.now(); } },
    jump() { jump(); lastInteraction = performance.now(); },
  };

  if (new URLSearchParams(location.search).has('debug')) {
    // Tuning hook: step the sim by hand (works even when the tab can't animate) and grab frames.
    let simTime = 0;
    window.__pg = {
      api,
      finger,
      topY: () => Math.max(...x.map((p) => p.y)),
      idle(on) { idleOff = !on; },
      spread: () => Math.max(...x.map((p) => Math.hypot(p.x - center.x, p.z - center.z))),
      run(seconds, fps = 60) {
        for (let i = 0; i < seconds * fps; i++) { simTime += 1 / fps; tick(1 / fps, simTime * 1000); }
        return renderer.domElement.toDataURL();
      },
      pokeAt(clientX, clientY) { finger.active = true; finger.pos.copy(pointerToWorld({ clientX, clientY })); },
      release() { finger.active = false; },
    };
  }
  return api;
}
