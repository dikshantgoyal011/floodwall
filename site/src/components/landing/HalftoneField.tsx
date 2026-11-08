import { useEffect, useRef } from "react";

// Field geometry, in CSS pixels and seconds.
const CELL = 10;
const LENS_RADIUS = 130;
const RIPPLE_SPEED = 520;
const RIPPLE_LIFE = 1.4;
const RIPPLE_WIDTH = 16;
const MAX_RIPPLES = 8;
// Moving this far from the last ripple sends another, so a sweep leaves a wake.
const RIPPLE_STEP = 160;
// How far the field runs past the hero's foot, beneath the next sheet.
const BLEED_BELOW = 200;

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0., 1.); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr, uTime, uEnergy;
uniform vec2 uPtr;
uniform vec4 uClear;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform vec3 uDot, uHot;
out vec4 o;

vec2 hash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1. + 2. * fract(sin(p) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(mix(dot(hash(i), f), dot(hash(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
// A slow, domain-warped field in 0..1.
float field(vec2 p, float t) {
  float f = .0032;
  vec2 w = vec2(noise(p * f * .6 + vec2(t * .03, 0.)), noise(p * f * .6 + vec2(-5.2, t * .03))) * 2.;
  float n = noise(p * f + w + vec2(t * .06, 0.)) * .75 + noise(p * f * 2.3 - vec2(t * .04, 0.)) * .25;
  return clamp(.5 + n * 1.3, 0., 1.);
}
// Clear behind the copy (uClear: the hero's centre and radii), full strength toward the edges.
float edge(vec2 p) {
  return smoothstep(.6, 1.3, length((p - uClear.xy) / uClear.zw));
}
float lens(vec2 p) { vec2 d = p - uPtr; return exp(-dot(d, d) / ${2 * LENS_RADIUS * LENS_RADIUS}.) * uEnergy; }
float rings(vec2 p) {
  float g = 0.;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    if (r.z < 0.) continue;
    float d = length(p - r.xy) - r.z * ${RIPPLE_SPEED}.;
    float fall = 1. - r.z / ${RIPPLE_LIFE};
    g += exp(-d * d / ${2 * RIPPLE_WIDTH * RIPPLE_WIDTH}.) * fall * fall * r.w;
  }
  return g;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 c = (floor(p / ${CELL}.) + .5) * ${CELL}.;
  // The cursor still reaches the clear zone behind the copy, at a third of its strength.
  float e = edge(c), quiet = mix(.35, 1., e);
  float l = lens(c) * quiet, g = rings(c) * quiet;
  float v = field(c, uTime) * e;
  v = v * v * 1.25 + l * .6 + g * .6;
  // Dots lean away from the cursor, never past their own cell.
  vec2 off = normalize(c - uPtr + 1e-4) * l * ${CELL * 0.28};
  float r = clamp(v, 0., 1.) * ${CELL * 0.46};
  float a = clamp((r - length(p - c - off)) * uDpr + .5, 0., 1.);
  vec3 col = mix(uDot, uHot, smoothstep(.25, .85, l + g * .7));
  o = vec4(col * a, a);
}`;

const UNIFORMS = ["uRes", "uDpr", "uTime", "uEnergy", "uPtr", "uClear", "uRip", "uDot", "uHot"] as const;
type Ripple = { x: number; y: number; t: number; strength: number };

function link(gl: WebGL2RenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.bindAttribLocation(program, 0, "p");
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("Halftone field shader failed:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/**
 * The hero's halftone field: a WebGL2 dot screen that drifts slowly, swells and takes the footer
 * bridge's vermilion under the cursor, and ripples where the reader clicks. Purely decorative;
 * without WebGL2 it draws nothing. It spans the viewport from its parent's top and runs on beneath
 * the next sheet; it listens on the window, so the copy above it stays usable.
 */
export function HalftoneField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const gl = canvas?.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
    const program = gl && link(gl);
    if (!canvas || !host || !gl || !program) return;

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniform = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, inside: false, energy: 0, rippleX: 0, rippleY: 0 };
    const ripples: Ripple[] = [];
    const rippleData = new Float32Array(MAX_RIPPLES * 4);
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    let dot = [0, 0, 0];
    let hot = [0, 0, 0];
    let visible = false;
    let frame = 0;
    let width = 1;
    let clear = [0, 0, 1, 1];
    const clock = () => performance.now() / 1000;

    // Token colours resolved to sRGB channels through a 2D context, whatever syntax the token uses.
    const rgb = (token: string) => {
      probe.fillStyle = getComputedStyle(host).getPropertyValue(token).trim() || "#000";
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      return [r / 255, g / 255, b / 255];
    };
    const readColors = () => {
      dot = rgb("--drawing-mid");
      hot = rgb("--bridge");
      request();
    };

    // Span the viewport (less any classic scrollbar) from the parent's padding edge, plus the bleed.
    const resize = () => {
      const left = host.getBoundingClientRect().left + host.clientLeft;
      width = document.documentElement.clientWidth;
      const height = host.clientHeight + BLEED_BELOW;
      Object.assign(canvas.style, { left: `${-left}px`, width: `${width}px`, height: `${height}px` });
      clear = [left + host.clientWidth / 2, host.clientHeight / 2, host.clientWidth * .38, host.clientHeight * .4];
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      request();
    };

    const draw = () => {
      frame = 0;
      const now = clock();
      const still = reducedMotion.matches;
      const ease = still ? 1 : .14;
      pointer.smoothX += (pointer.x - pointer.smoothX) * ease;
      pointer.smoothY += (pointer.y - pointer.smoothY) * ease;
      pointer.energy += (Number(pointer.inside) - pointer.energy) * (still ? 1 : .06);
      while (ripples.length && now - ripples[0].t > RIPPLE_LIFE) ripples.shift();
      rippleData.fill(-1);
      ripples.forEach(({ x, y, t, strength }, index) => rippleData.set([x, y, now - t, strength], index * 4));

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniform.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniform.uDpr, canvas.width / width);
      gl.uniform1f(uniform.uTime, still ? 0 : now);
      gl.uniform1f(uniform.uEnergy, pointer.energy);
      gl.uniform2f(uniform.uPtr, pointer.smoothX, pointer.smoothY);
      gl.uniform4fv(uniform.uClear, clear);
      gl.uniform4fv(uniform.uRip, rippleData);
      gl.uniform3fv(uniform.uDot, dot);
      gl.uniform3fv(uniform.uHot, hot);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Reduced motion freezes the drift, so frames are drawn only while the pointer settles.
      const settling = Math.abs(pointer.x - pointer.smoothX) + Math.abs(pointer.y - pointer.smoothY) > .5
        || Math.abs(Number(pointer.inside) - pointer.energy) > .005 || ripples.length > 0;
      if (!still || settling) request();
    };
    function request() {
      if (visible && !frame) frame = requestAnimationFrame(draw);
    }

    // The pointer in field coordinates, or null when it is off the field or over another sheet.
    const local = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left, y = event.clientY - box.top;
      const target = event.target instanceof Element ? event.target : null;
      const onSheet = !!target?.closest("main > section") && !host.contains(target);
      return x < 0 || y < 0 || x > box.width || y > box.height || onSheet ? null : [x, y] as const;
    };
    const ripple = (x: number, y: number, strength: number) => {
      if (reducedMotion.matches) return;
      ripples.push({ x, y, t: clock(), strength });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };
    const onMove = (event: PointerEvent) => {
      const point = local(event);
      if (!point) return onLeave();
      const [x, y] = point;
      if (!pointer.inside) {
        pointer.smoothX = pointer.rippleX = x;
        pointer.smoothY = pointer.rippleY = y;
      }
      Object.assign(pointer, { x, y, inside: true });
      if (Math.hypot(x - pointer.rippleX, y - pointer.rippleY) > RIPPLE_STEP) {
        ripple(x, y, .5);
        pointer.rippleX = x;
        pointer.rippleY = y;
      }
      request();
    };
    function onLeave() {
      if (!pointer.inside) return;
      pointer.inside = false;
      request();
    }
    const onDown = (event: PointerEvent) => {
      const point = local(event);
      if (!point) return;
      ripple(...point, 1);
      request();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    reducedMotion.addEventListener("change", request);
    window.addEventListener("floodwall:theme-change", readColors);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) request();
      else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    });
    visibility.observe(canvas);
    readColors();
    resize();

    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("floodwall:theme-change", readColors);
      reducedMotion.removeEventListener("change", request);
      window.removeEventListener("resize", resize);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="halftone-field" aria-hidden="true" />;
}
