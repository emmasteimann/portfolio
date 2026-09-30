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
uniform sampler2D uPlate;   // the ghost's region of the painting with the painted ghost removed
uniform vec2 uPointer;      // smoothed pointer in screen uv (0..1, y up), for the ghost's gaze
uniform float uTime;
uniform vec4 uCrt;          // x0, y0, x1, y1 in image pixels
uniform int uView;          // CRT debug view: 0 beauty, 1 normals, 2 thickness, 3 march steps

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

// Compact turbo-style heat map for the debug views.
vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  return clamp(vec3(
    0.14 + x * (4.6 - x * 3.9),
    0.09 + x * (3.4 - x * 3.1) + x * x * 0.4,
    0.5 + x * (2.2 - x * 4.1) + x * x * 1.6), 0.0, 1.0);
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
  float steps = 0.0;
  for (int i = 0; i < 48; i++) {
    steps += 1.0;
    float d = slimeSdf(ro + rd * t, height, squash);
    if (d < 0.002) { hit = true; break; }
    t += d;
    if (t > 8.0) break;
  }
  vec3 debugNormal = vec3(0.0);
  float debugThick = 0.0;

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
    debugNormal = n;
    debugThick = thick;
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

  // Debug views: what a rendering engineer looks at in RenderDoc, on the desk.
  if (uView == 1) col = hit ? debugNormal * 0.5 + 0.5 : vec3(0.04, 0.03, 0.07);
  if (uView == 2) col = hit ? heat(debugThick / 1.3) : vec3(0.04, 0.03, 0.07);
  if (uView == 3) col = heat(steps / 48.0);

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
// The ghost at the desk: a little 3D character built from signed distance functions, ray-marched
// orthographically into the painting and toon-shaded to match it (flat light/shadow bands lit by
// the desk lamp, a teal rim from the CRT, ink lines on silhouettes and where parts meet). The
// painted ghost is removed from behind it with an inpainted patch (uPlate).
// Units: 1 = 100 painting pixels. The origin is where the ghost sits on the desk.

const vec2 GHOST_ORIGIN = vec2(624.0, 858.0);   // painting px
const vec4 PLATE_RECT = vec4(504.0, 644.0, 720.0, 872.0);
const float CAM_TILT = 0.12;                     // the painting looks slightly down at the desk

vec3 imageAt(vec2 px) { return texture2D(uImage, vec2(px.x, uImageSize.y - px.y) / uImageSize).rgb; }

// The painting with the painted ghost removed.
// rgb: the painting with the painted ghost removed. a: things in front of the ghost (the cup).
vec4 plateAt(vec2 px) {
  if (px.x < PLATE_RECT.x || px.x >= PLATE_RECT.z || px.y < PLATE_RECT.y || px.y >= PLATE_RECT.w) return vec4(imageAt(px), 0.0);
  vec2 q = (px - PLATE_RECT.xy) / (PLATE_RECT.zw - PLATE_RECT.xy);
  return texture2D(uPlate, vec2(q.x, 1.0 - q.y));
}

float sminG(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
// Cylinder of radius ra and half-height h around y, edges rounded by rb.
float sdRoundCyl(vec3 p, float ra, float h, float rb) {
  vec2 d = vec2(length(p.xz) - ra + rb, abs(p.y) - h + rb);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb;
}
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

// Per-frame pose, shared by every pixel.
float gStretch;       // squash and stretch (1 = rest)
mat3 gToLocal;        // world -> ghost frame (yaw toward the pointer, a little pitch and sway)
float gWave;          // left arm wave angle
vec2 gLook;           // eye offset on the face, toward the pointer

// Parts: x body, y limbs (arms and feet), z hat brim, w hat crown. Local space: y up, face at -z.
vec4 ghostParts(vec3 pw) {
  vec3 p = gToLocal * pw;
  float s = gStretch;
  vec3 q = vec3(p.x * sqrt(s), p.y / s, p.z * sqrt(s));      // volume-preserving stretch from the base

  // A squat pear that spreads onto the desk.
  float body = sdEllipsoid(q - vec3(0.0, 0.8, 0.0), vec3(0.63, 0.78, 0.5));
  body = sminG(body, sdEllipsoid(q - vec3(0.0, 0.3, 0.02), vec3(0.9, 0.38, 0.64)), 0.4);
  body = max(body, -p.y);

  // Nubby flipper arms: the left reaches out onto the desk (and waves now and then), the right
  // rests on the cup's rim. Round feet peek out in front.
  vec3 shoulderL = vec3(-0.66, 0.74, -0.08);
  vec3 tipL = shoulderL + rotZ(-gWave) * vec3(-0.2, -0.3, -0.06);
  float arms = sdCapsule(q, shoulderL, tipL, 0.13);
  arms = min(arms, sdCapsule(q, vec3(0.58, 0.66, -0.2), vec3(0.78, 0.76, -0.3), 0.11));
  // The arms melt into the body at the shoulder (no seam, so no ink line there); the feet stay
  // separate pieces with their own outlines.
  body = max(sminG(body, arms, 0.12), -p.y);
  float limbs = length(q - vec3(-0.34, 0.07, -0.5)) - 0.14;
  limbs = min(limbs, length(q - vec3(0.36, 0.07, -0.5)) - 0.14);
  limbs = max(limbs, -p.y);

  // A soft bucket hat, pulled down low and tipped to one side, with a drooping brim.
  vec3 hp = rotX(-0.12) * rotZ(-0.16) * (p - vec3(0.0, 1.42 * s, 0.02));
  float r = length(hp.xz * vec2(1.0, 1.12));
  vec3 bp = hp; bp.y += 0.14 * (r / 0.9) * (r / 0.9);          // brim droops toward its edge
  float brim = sdRoundCyl(bp * vec3(1.0, 1.0, 1.12), 0.84, 0.028, 0.025);
  vec3 cp = hp - vec3(0.0, 0.02, 0.0);
  float crown = sdEllipsoid(cp, vec3(0.49, 0.43, 0.44));
  crown = max(crown, -cp.y + 0.01);
  crown = max(crown, -sdEllipsoid(cp - vec3(0.0, 0.47, 0.0), vec3(0.22, 0.06, 0.14)));  // dented top
  return vec4(body, limbs, brim, crown);
}
float ghostSdf(vec3 p) { vec4 d = ghostParts(p); return min(min(d.x, d.y), min(d.z, d.w)); }

vec3 ghostNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.002;
  return normalize(k.xyy * ghostSdf(p + k.xyy * h) + k.yyx * ghostSdf(p + k.yyx * h) +
                   k.yxy * ghostSdf(p + k.yxy * h) + k.xxx * ghostSdf(p + k.xxx * h));
}

// Blink schedule: a quick blink every few seconds, sometimes a double.
float ghostBlink() {
  float t = uTime / 3.3;
  float ph = fract(t) * 3.3;
  float twice = step(0.6, hash12(vec2(floor(t), 4.0)));
  float b = 1.0 - smoothstep(0.0, 0.07, abs(ph - 0.08));
  b = max(b, twice * (1.0 - smoothstep(0.0, 0.07, abs(ph - 0.32))));
  return b;
}

const vec3 INK = vec3(0.26, 0.13, 0.16);

// The face, drawn on the body in cylindrical coordinates around its vertical axis
// (u: arc length across the front, v: height at rest).
vec3 ghostFace(vec3 col, vec3 lp) {
  if (lp.z > 0.1) return col;
  float u = atan(lp.x, -lp.z) * 0.6;
  float v = lp.y / gStretch;
  vec2 look = gLook;

  // Blush.
  for (int k = 0; k < 2; k++) {
    vec2 c = vec2(k == 0 ? -0.4 : 0.4, 1.06);
    vec2 d = (vec2(u, v) - c - look * 0.4) / vec2(0.11, 0.06);
    col = mix(col, vec3(1.0, 0.6, 0.62), 0.55 * (1.0 - smoothstep(0.4, 1.0, length(d))));
  }
  // Eyes: glossy dark ovals with a highlight; blinking squashes them into a happy arc.
  float blink = ghostBlink();
  float open = max(1.0 - blink, 0.001);
  for (int k = 0; k < 2; k++) {
    vec2 c = vec2(k == 0 ? -0.27 : 0.27, 1.19) + look;
    vec2 d = vec2(u, v) - c;
    float eye = 1.0 - smoothstep(0.85, 1.05, length(d / vec2(0.066, 0.086 * open)));
    col = mix(col, vec3(0.17, 0.08, 0.08), eye);
    float shine = 1.0 - smoothstep(0.6, 1.0, length((d - vec2(0.02, 0.03 * open)) / vec2(0.022, 0.025 * open)));
    col = mix(col, vec3(1.0), shine * eye);
    float x = d.x / 0.066;
    float arc = abs(d.y + (0.016 - 0.045 * (1.0 - x * x)));
    col = mix(col, INK, (1.0 - smoothstep(0.004, 0.009, arc)) * step(abs(x), 1.0) * smoothstep(0.75, 0.95, blink));
  }
  // A little cat mouth ("w") with a pink tongue.
  vec2 m = (vec2(u, v) - vec2(0.0, 1.08) - look * 0.5) / 1.4;
  if (abs(m.x) < 0.075 && abs(m.y) < 0.05) {
    float tongue = (1.0 - smoothstep(0.016, 0.022, length(m - vec2(0.0, -0.022)))) * step(m.y, -0.012);
    col = mix(col, vec3(0.93, 0.5, 0.55), tongue);
    float w = -0.022 * abs(sin(3.14159 * m.x / 0.06));
    float line = (1.0 - smoothstep(0.004, 0.008, abs(m.y - w))) * step(abs(m.x), 0.06);
    col = mix(col, INK, line);
  }
  return col;
}

// Renders the ghost for one painting pixel over what's behind it. aa is one screen pixel in ghost units.
vec3 ghostComposite(vec2 px, vec3 behind, float aa) {
  vec2 xy = vec2(px.x - GHOST_ORIGIN.x, GHOST_ORIGIN.y - px.y) / 100.0;
  vec3 rd = vec3(0.0, -sin(CAM_TILT), cos(CAM_TILT));
  vec3 up = vec3(0.0, cos(CAM_TILT), sin(CAM_TILT));
  vec3 ro = vec3(xy.x, 0.0, 0.0) + up * xy.y - rd * 3.0;

  // March the union, remembering how close the ray came to each part: a near miss of a part
  // other than the one we hit is an ink line (a silhouette drawn over whatever is behind it).
  vec4 nearest = vec4(1e5);
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 72; i++) {
    vec4 d = ghostParts(ro + rd * t);
    float dm = min(min(d.x, d.y), min(d.z, d.w));
    if (dm < 0.0015) { hit = true; break; }
    nearest = min(nearest, d);
    t += dm * 0.9;
    if (t > 6.0) break;
  }
  float inkW = max(0.011, aa * 1.0);

  // Contact shadow on the desk.
  vec3 col = behind * (1.0 - 0.35 * exp(-dot(xy / vec2(0.85, 0.07), xy / vec2(0.85, 0.07))) * step(xy.y, 0.12));

  if (!hit) {
    float m = min(min(nearest.x, nearest.y), min(nearest.z, nearest.w));
    return mix(col, INK, 1.0 - smoothstep(inkW - aa, inkW + aa, m));
  }

  vec3 p = ro + rd * t;
  vec4 d = ghostParts(p);
  vec3 n = ghostNormal(p);
  vec3 lp = gToLocal * p;
  int part = d.x <= min(d.y, min(d.z, d.w)) ? 0 : d.y <= min(d.z, d.w) ? 1 : d.z <= d.w ? 2 : 3;

  // Toon light: the desk lamp from the upper left, a teal rim from the CRT on the right.
  vec3 L = normalize(vec3(0.7, 0.5, -0.5));
  float ndl = dot(n, L);
  float lit = smoothstep(-0.02, 0.1, ndl);
  vec3 litC, shadeC;
  if (part <= 1) { litC = vec3(1.0, 0.87, 0.78); shadeC = vec3(0.72, 0.58, 0.8); }
  else { litC = vec3(0.4, 0.3, 0.74); shadeC = vec3(0.22, 0.15, 0.46); }
  if (part == 3) {
    vec3 hp = rotX(-0.12) * rotZ(-0.16) * (lp - vec3(0.0, 1.42 * gStretch, 0.02));
    if (hp.y > 0.03 && hp.y < 0.13) { litC = vec3(0.96, 0.52, 0.56); shadeC = vec3(0.62, 0.3, 0.45); }
  }
  if (part == 2 && n.y < -0.3) lit = 0.0;                       // the brim's underside
  if (part == 0 && lp.y / gStretch > 1.36) lit *= 0.0;          // shadow of the brim on the forehead
  vec3 c = mix(shadeC, litC, lit);
  if (part <= 1) c *= mix(0.78, 1.0, smoothstep(0.0, 0.45, lp.y));   // darker toward the desk
  if (part == 0) c = ghostFace(c, lp);
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5) * max(dot(n, normalize(vec3(-0.85, 0.1, -0.4))), 0.0);
  c += vec3(0.3, 0.45, 0.8) * rim * 0.6;
  c *= 0.97 + 0.06 * hash12(px * 1.7);                            // a little paper grain

  // Ink: the silhouette (grazing angles), near misses of other parts, and seams where parts meet.
  float ink = 1.0 - smoothstep(0.16, 0.26, dot(n, -rd));
  vec4 others = nearest;
  if (part == 0) others.x = 1e5; else if (part == 1) others.y = 1e5; else if (part == 2) others.z = 1e5; else others.w = 1e5;
  ink = max(ink, 1.0 - smoothstep(inkW - aa, inkW + aa, min(min(others.x, others.y), min(others.z, others.w))));
  vec4 dd = d;
  if (part == 0) dd.x = 1e5; else if (part == 1) dd.y = 1e5; else if (part == 2) dd.z = 1e5; else dd.w = 1e5;
  ink = max(ink, 1.0 - smoothstep(inkW * 0.6, inkW * 0.6 + aa, min(min(dd.x, dd.y), min(dd.z, dd.w))));
  return mix(c, INK, ink);
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

  vec2 px = vec2(uv.x, 1.0 - uv.y) * uImageSize;

  vec3 col = imageAt(px);

  // The ghost: pose for this frame (turned toward the pointer), then ray-march it over the plate.
  if (uView != 9 && px.x > PLATE_RECT.x && px.x < PLATE_RECT.z && px.y > 600.0 && px.y < PLATE_RECT.w) {
    vec2 faceScreen = (vec2(650.0, uImageSize.y - 735.0) / uImageSize - origin) / scale;
    vec2 toPointer = (uPointer - faceScreen) * vec2(viewAspect, 1.0);
    float yaw = 0.55 + clamp(toPointer.x * 1.1, -0.6, 0.28);
    float pitch = clamp(toPointer.y * 0.5, -0.12, 0.18);
    float sway = 0.035 * sin(uTime * 1.3);
    gStretch = 1.0 + 0.035 * sin(uTime * 2.1) + 0.01 * sin(uTime * 3.7 + 1.0);
    gToLocal = transpose(rotY(-yaw) * rotX(pitch) * rotZ(sway));
    float wavePhase = fract(uTime / 9.0) * 9.0;
    float waveEnv = smoothstep(0.0, 0.3, wavePhase) * (1.0 - smoothstep(1.3, 1.7, wavePhase));
    gWave = waveEnv * (0.9 + 0.35 * sin(uTime * 13.0));
    gLook = vec2(clamp(toPointer.x * 0.12, -0.03, 0.03), clamp(toPointer.y * 0.1, -0.02, 0.025));
    float aa = scale.x * uImageSize.x / uResolution.x / 100.0;
    vec4 plate = plateAt(px);
    col = mix(ghostComposite(px, plate.rgb, aa), plate.rgb, plate.a);   // the cup stays in front
  }

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

export function initHero(container, { onReady } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const debugCrt = ['crt', 'ghost'].some((k) => new URLSearchParams(location.search).has(k));

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
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    uPlate: { value: null },
    uTime: { value: 0 },
    uCrt: { value: new THREE.Vector4(...CRT_RECT) },
    uView: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // ?crt zooms into the desk CRT, for tuning its shader.
  if (new URLSearchParams(location.search).has('ghost')) {
    uniforms.uFocus.value.set(650 / IMAGE_SIZE[0], 1 - 760 / IMAGE_SIZE[1]);
    uniforms.uZoom.value = 0.3;
  } else if (debugCrt) {
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

  // Mouse parallax and the ghost's gaze, eased. With no pointer around (phones, or an idle
  // mouse), the ghost's eyes wander on their own.
  const target = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2(0.5, 0.5);
  let lastPointerMove = -1e9;
  window.addEventListener('pointermove', (e) => {
    target.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    const rect = container.getBoundingClientRect();
    pointerTarget.set((e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
    lastPointerMove = performance.now();
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
      if (performance.now() - lastPointerMove > 4000) {
        const t = uniforms.uTime.value;
        pointerTarget.set(0.5 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1), 0.45 + 0.2 * Math.sin(t * 0.29 + 2));
      }
      uniforms.uPointer.value.lerp(pointerTarget, 0.12);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  };

  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((resolve, reject) => loader.load(url, (texture) => {
    texture.colorSpace = THREE.NoColorSpace; // sample and output the painting's values untouched
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    resolve(texture);
  }, undefined, reject));

  Promise.all([load(container.dataset.image), load(container.dataset.plate)]).then(([image, plate]) => {
    uniforms.uImage.value = image;
    uniforms.uPlate.value = plate;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (reducedMotion) {
      uniforms.uTime.value = 1.2;
      renderer.render(scene, camera);
    } else {
      requestAnimationFrame(frame);
    }
    container.classList.add('is-live');
    onReady?.({
      setView(view) {
        uniforms.uView.value = view;
        if (reducedMotion) renderer.render(scene, camera);
      },
    });
  });
}
