// Hero: the studio illustration drawn through one fragment shader that brings it to life —
// flickering lamps, a pulsing ON AIR sign, twinkling stars, drifting dust, mouse parallax, and a
// CRT on the desk that ray-marches a little slime in real time.
import * as THREE from 'three';

// Regions of the source illustration, in its pixel space (1536 x 1024, y down).
const IMAGE_SIZE = [1536, 1024];
const CRT_RECT = [818, 691, 994, 815];      // x0, y0, x1, y1 of the desk CRT's glass
const FOCUS = [0.42, 0.55];                 // point kept in frame when the viewport crops the image

const fragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uFocus;
uniform float uZoom;       // 1 = cover fit; smaller zooms in (debug)
uniform vec2 uMouse;        // smoothed, -1..1
uniform float uTime;
uniform vec4 uCrt;          // x0, y0, x1, y1 in image pixels

varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise1(float t) {
  float i = floor(t), f = fract(t);
  float a = hash12(vec2(i, 1.7)), b = hash12(vec2(i + 1.0, 1.7));
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}

// Lamp flicker: slow breathing plus the occasional quick dip.
float flicker(float seed) {
  float slow = 0.85 + 0.15 * noise1(uTime * 1.3 + seed);
  float fast = noise1(uTime * 11.0 + seed * 7.0);
  return slow * (fast < 0.08 ? 0.75 : 1.0);
}

// ---------------------------------------------------------------------------------------------
// The CRT: a ray-marched slime that bounces, squashes on landing and blinks.

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// Hop cycle: airborne arc, then a squash on landing that settles back.
void slimeState(float t, out float height, out float squash) {
  float period = 2.2;
  float ph = fract(t / period) * period;
  float air = 0.9;
  if (ph < air) {
    float u = ph / air;
    height = 4.0 * u * (1.0 - u) * 0.32;
    squash = -0.12 * sin(3.14159 * u);                 // stretch in flight
  } else {
    float u = (ph - air) / (period - air);
    height = 0.0;
    squash = 0.32 * exp(-5.0 * u) * cos(12.0 * u);     // land, wobble, settle
  }
}

// A dome: an ellipsoid sunk into the floor and cut flat, like a slime sitting on the ground.
float slimeSdf(vec3 p, float height, float squash) {
  float s = 1.0 + squash;
  vec3 r = vec3(0.72 * sqrt(s), 0.58 / s, 0.64 * sqrt(s));
  vec3 q = p - vec3(0.0, height + r.y * 0.62, 0.0);
  float d = sdEllipsoid(q, r);
  return max(d, height - p.y);
}

// Everything behind the slime: dusk sky, horizon glow and a neon grid floor with a contact shadow.
vec3 background(vec3 ro, vec3 rd, float height, float squash) {
  vec3 col = mix(vec3(0.22, 0.10, 0.34), vec3(0.05, 0.03, 0.12), clamp(rd.y * 3.0 + 0.3, 0.0, 1.0));
  col += vec3(0.75, 0.3, 0.55) * exp(-abs(rd.y) * 14.0) * 0.45;
  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    vec3 fp = ro + rd * t;
    vec2 g = abs(fract(fp.xz * 2.0) - 0.5);
    float line = smoothstep(0.44, 0.49, max(g.x, g.y));
    vec3 fcol = vec3(0.08, 0.05, 0.13) + line * vec3(0.45, 0.2, 0.7) * exp(-t * 0.22);
    float footprint = 0.72 * sqrt(1.0 + squash);
    float shadow = smoothstep(footprint * 0.55, footprint * 1.35 + height * 0.8, length(fp.xz));
    fcol *= mix(0.25 + 0.5 * min(height, 1.0), 1.0, shadow);
    col = mix(col, fcol, smoothstep(0.0, 0.015, -rd.y));
  }
  return col;
}

vec3 slimeNormal(vec3 p, float height, float squash) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    slimeSdf(p + e.xyy, height, squash) - slimeSdf(p - e.xyy, height, squash),
    slimeSdf(p + e.yxy, height, squash) - slimeSdf(p - e.yxy, height, squash),
    slimeSdf(p + e.yyx, height, squash) - slimeSdf(p - e.yyx, height, squash)));
}

vec3 crtScene(vec2 q) {
  // q: 0..1 across the glass, y down. Barrel-distort like old glass.
  vec2 c = q * 2.0 - 1.0;
  c *= 1.0 + 0.06 * dot(c, c);
  float aspect = (uCrt.z - uCrt.x) / (uCrt.w - uCrt.y);
  vec2 sp = vec2(c.x * aspect, -c.y);

  float height, squash;
  slimeState(uTime, height, squash);

  // Camera, slightly above and looking down at the slime.
  vec3 ro = vec3(0.0, 1.0, -3.6);
  vec3 rd = normalize(vec3(sp * 0.5, 1.6));
  rd.yz = mat2(0.97, 0.24, -0.24, 0.97) * rd.yz;

  vec3 col = background(ro, rd, height, squash);

  // March the slime.
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 48; i++) {
    float d = slimeSdf(ro + rd * t, height, squash);
    if (d < 0.002) { hit = true; break; }
    t += d;
    if (t > 8.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = slimeNormal(p, height, squash);
    vec3 l = normalize(vec3(-0.5, 0.8, -0.6));
    float cosV = max(dot(n, -rd), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);

    // Refract in, march through the body to find the exit and the thickness, refract out.
    vec3 rIn = refract(rd, n, 1.0 / 1.33);
    float thick = 0.02;
    for (int i = 0; i < 24; i++) {
      float d = -slimeSdf(p + rIn * thick, height, squash);
      if (d < 0.002) break;
      thick += max(d, 0.01);
    }
    vec3 exitP = p + rIn * thick;
    vec3 nOut = -slimeNormal(exitP, height, squash);
    vec3 rOut = refract(rIn, nOut, 1.33);
    if (dot(rOut, rOut) < 0.01) rOut = reflect(rIn, nOut); // total internal reflection
    vec3 behind = background(exitP, rOut, height, squash);

    // Beer-Lambert: thin goo is nearly clear, thick goo turns deep teal.
    vec3 absorb = exp(-thick * vec3(1.9, 0.28, 0.55));
    vec3 slime = behind * absorb * 1.3 + vec3(0.12, 0.62, 0.5) * (1.0 - absorb.r) * 0.75;

    // Reflection of the sky, a sharp highlight and a soft rim.
    vec3 refl = background(p, reflect(rd, n), height, squash);
    slime = mix(slime, refl * 1.4, fres);
    slime += pow(max(dot(reflect(rd, n), l), 0.0), 90.0) * 2.2;
    slime += pow(1.0 - cosV, 3.0) * vec3(0.35, 0.9, 0.8) * 0.35;

    // A few bubbles drifting up inside.
    vec3 local = p - vec3(0.0, height, 0.0);
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      vec3 bc = vec3(sin(fk * 2.3) * 0.35, fract(uTime * 0.12 + fk * 0.27) * 0.55 + 0.05, -0.2);
      vec2 bd = local.xy - bc.xy;
      float br = 0.03 + 0.015 * fract(fk * 0.61);
      float ring = smoothstep(br, br * 0.7, length(bd)) - smoothstep(br * 0.7, br * 0.4, length(bd)) * 0.6;
      slime += ring * vec3(0.7, 1.0, 0.95) * 0.35 * step(local.z, 0.0);
    }

    // Eyes: glowing ovals on the front, blinking now and then.
    float blink = step(0.05, fract(uTime * 0.23 + 0.1));
    float eyeH = mix(0.012, 0.085, blink);
    for (int k = 0; k < 2; k++) {
      float sx = k == 0 ? -0.2 : 0.2;
      vec2 ed = (local.xy - vec2(sx, 0.42 - squash * 0.12)) / vec2(0.06, eyeH);
      float eye = 1.0 - smoothstep(0.75, 1.0, length(ed));
      eye *= step(local.z, 0.0);
      slime = mix(slime, vec3(0.85, 1.0, 0.95) * 1.7, eye);
    }
    col = slime;
  }

  // Scanlines, flicker and vignette.
  float lines = 0.82 + 0.18 * sin(q.y * (uCrt.w - uCrt.y) * 3.14159 * 1.0);
  col *= lines * (0.96 + 0.04 * sin(uTime * 60.0));
  col *= 1.0 - 0.55 * dot(c, c) * 0.5;
  return col;
}

// Rounded-rect mask for the CRT glass, in image pixels.
float crtMask(vec2 px) {
  vec2 center = (uCrt.xy + uCrt.zw) * 0.5;
  vec2 halfSize = (uCrt.zw - uCrt.xy) * 0.5;
  vec2 d = abs(px - center) - (halfSize - 7.0);
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 7.0;
  return 1.0 - smoothstep(-1.0, 1.0, dist);
}

// ---------------------------------------------------------------------------------------------

vec3 glow(vec2 px, vec2 center, float radius) {
  vec2 d = (px - center) / radius;
  return vec3(exp(-dot(d, d)));
}

void main() {
  // Cover-fit the illustration, keeping the focus point in view, with a little overscan for parallax.
  vec2 screen = vUv;
  float viewAspect = uResolution.x / uResolution.y;
  float imageAspect = uImageSize.x / uImageSize.y;
  vec2 scale = viewAspect > imageAspect ? vec2(1.0, imageAspect / viewAspect)
                                        : vec2(viewAspect / imageAspect, 1.0);
  scale /= 1.05;
  scale *= uZoom;
  vec2 origin = clamp(uFocus - 0.5 * scale, vec2(0.0), vec2(1.0) - scale);
  vec2 uv = origin + screen * scale;
  uv += uMouse * vec2(0.012, 0.008);
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  vec3 col = texture2D(uImage, uv).rgb;
  vec2 px = vec2(uv.x, 1.0 - uv.y) * uImageSize;

  // Lamps.
  float lampL = flicker(1.0), lampR = flicker(9.0);
  col *= 1.0 + glow(px, vec2(165.0, 460.0), 150.0) * 0.35 * (lampL - 0.85) * 4.0;
  col += glow(px, vec2(165.0, 455.0), 55.0) * vec3(1.0, 0.62, 0.28) * 0.35 * lampL;
  col += glow(px, vec2(1162.0, 588.0), 45.0) * vec3(1.0, 0.55, 0.25) * 0.35 * lampR;

  // ON AIR: steady pulse with the odd stutter.
  float onAir = 0.75 + 0.25 * sin(uTime * 2.0);
  onAir *= noise1(uTime * 6.0) < 0.05 ? 0.4 : 1.0;
  col += glow(px, vec2(1258.0, 215.0), 95.0) * vec3(1.0, 0.3, 0.18) * 0.28 * onAir;

  // Stars in the window twinkle.
  if (px.x > 580.0 && px.x < 1070.0 && px.y < 300.0) {
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    float star = smoothstep(0.55, 0.9, lum);
    float tw = sin(uTime * (2.0 + 3.0 * hash12(floor(px / 3.0))) + hash12(floor(px / 3.0) + 7.0) * 6.28);
    col += star * col * 0.45 * tw;
  }

  // The CRT.
  float mask = crtMask(px);
  vec3 crtCol = vec3(0.0);
  if (mask > 0.0) {
    vec2 q = (px - uCrt.xy) / (uCrt.zw - uCrt.xy);
    crtCol = crtScene(q);
    col = mix(col, crtCol, mask * 0.95);
  }
  // Screen light spilling onto the desk and ghost.
  vec2 crtCenter = (uCrt.xy + uCrt.zw) * 0.5;
  col += glow(px, crtCenter + vec2(0.0, 30.0), 170.0) * vec3(0.25, 0.7, 0.65) * 0.06 * (1.0 - mask);

  // Dust drifting through the lamp light.
  for (int layer = 0; layer < 2; layer++) {
    float cell = layer == 0 ? 38.0 : 61.0;
    vec2 drift = vec2(uTime * 4.0, -uTime * (6.0 + float(layer) * 3.0));
    vec2 g = (px + drift) / cell;
    vec2 id = floor(g);
    vec2 pos = vec2(hash12(id), hash12(id + 3.1)) ;
    pos += 0.15 * vec2(sin(uTime * 0.7 + id.y), cos(uTime * 0.5 + id.x));
    float d = length(fract(g) - pos) * cell;
    float mote = smoothstep(1.6, 0.0, d) * step(0.6, hash12(id + 11.0));
    float light = glow(px, vec2(165.0, 520.0), 260.0).x + glow(px, vec2(1162.0, 640.0), 200.0).x;
    col += mote * light * vec3(1.0, 0.8, 0.55) * 0.5;
  }

  // Grade: vignette and fine grain.
  vec2 v = screen - 0.5;
  col *= 1.0 - 0.35 * dot(v, v) * 1.6;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.025;

  gl_FragColor = vec4(col, 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function initHero(container) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const debugCrt = new URLSearchParams(location.search).has('crt');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: debugCrt, // lets screenshots capture the canvas while tuning
    });
  } catch {
    return; // No WebGL: the static <img> fallback stays.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.domElement.className = 'hero-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uImage: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uImageSize: { value: new THREE.Vector2(...IMAGE_SIZE) },
    uFocus: { value: new THREE.Vector2(...FOCUS) },
    uZoom: { value: 1 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uCrt: { value: new THREE.Vector4(...CRT_RECT) },
  };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // ?crt zooms into the desk CRT, for tuning its shader.
  if (debugCrt) {
    uniforms.uFocus.value.set((CRT_RECT[0] + CRT_RECT[2]) / 2 / IMAGE_SIZE[0], 1 - (CRT_RECT[1] + CRT_RECT[3]) / 2 / IMAGE_SIZE[1]);
    uniforms.uZoom.value = 0.16;
  }

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
  };
  new ResizeObserver(resize).observe(container);
  resize();

  // Mouse parallax, eased.
  const target = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    target.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  }, { passive: true });

  // Only animate while the hero is on screen and the tab is visible.
  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(container);

  if (debugCrt) {
    // Tuning hook: __hero.frame(t) renders one frame at time t and returns it as a data URL.
    window.__hero = {
      uniforms,
      frame(t) {
        visible = false;
        uniforms.uTime.value = t;
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL();
      },
    };
  }

  const clock = new THREE.Clock();
  const frame = () => {
    if (visible && !document.hidden) {
      uniforms.uTime.value = clock.getElapsedTime();
      uniforms.uMouse.value.lerp(target, 0.04);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  };

  new THREE.TextureLoader().load(container.dataset.image, (texture) => {
    texture.colorSpace = THREE.NoColorSpace; // sample and output the painting's values untouched
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    uniforms.uImage.value = texture;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (reducedMotion) {
      uniforms.uTime.value = 1.2;
      renderer.render(scene, camera);
    } else {
      requestAnimationFrame(frame);
    }
    container.classList.add('is-live');
  });
}
