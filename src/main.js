// Entry point: boots WebGPU, then runs the endless camera flight.
import { initGPU } from './core/gpu.js';
import { Director } from './world/director.js';
import { Environment } from './world/environment.js';
import { Renderer } from './render/renderer.js';
import { Ambience } from './audio/ambience.js';
import { attachControls } from './controls.js';
import { offscreenContext, captureToCanvas } from './debug/capture.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);

function detectQuality() {
  const mobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const q = params.get('q') || (mobile ? 'medium' : 'high');
  const presets = {
    // px: rendered pixels per CSS pixel [floor, start, ceiling], never above the screen's own density
    low: { level: 0, cloudDiv: 4, density: 0.5, distance: 0.6, shadowSize: 1024, px: [0.7, 1.0, 1.2], dprCap: 1.5 },
    medium: {
      level: 0.5,
      cloudDiv: 3,
      density: 0.75,
      distance: 0.8,
      shadowSize: 1536,
      px: [0.85, 1.3, 1.6],
      dprCap: 2,
    },
    high: { level: 1, cloudDiv: 2, density: 1, distance: 1, shadowSize: 2048, px: [1.0, 1.5, 2.0], dprCap: 2 },
  };
  const skip = (params.get('skip') || '').split(',').filter(Boolean);
  return { name: q, mobile, skip, ...(presets[q] || presets.high) };
}

async function main() {
  const canvas = document.getElementById('scene');
  const capture = num('capture', 0);
  const gpu = await initGPU(capture ? null : canvas).catch((e) => {
    console.warn(e);
    return null;
  });
  if (!gpu) {
    document.body.classList.add('no-webgpu');
    return;
  }
  gpu.device.lost.then((info) => {
    console.warn('WebGPU device lost', info.reason, info.message, window.__scene?.renderer.frame);
    document.body.classList.add('no-webgpu');
  });
  gpu.device.addEventListener?.('uncapturederror', (e) => console.error(e.error.message));

  if (capture) {
    gpu.context = offscreenContext(gpu.device, canvas);
    gpu.format = gpu.context.format;
  }
  const quality = detectQuality();
  const renderer = await new Renderer(gpu, quality).init();
  const startU = num('u', 0.02);
  const director = new Director(startU, num('cycle', Math.floor(Math.random() * 8)));
  // debugging aid: look=yawDeg,pitchDeg offsets the camera (decays like a drag)
  const look = (params.get('look') || '').split(',').map(Number);
  if (look.length === 2) [director.lookYaw, director.lookPitch] = look.map((d) => (d * Math.PI) / 180);
  const env = new Environment({ tod: num('tod', 0.69), seed: num('seed', Math.random()) });
  const audio = new Ambience();
  attachControls(canvas, director, audio);

  const freeze = params.has('freeze');
  const sync = params.has('sync') || capture > 0;
  // Render resolution is set in pixels per CSS pixel, not as a fraction of the
  // screen's pixels, so a 1x and a 2x screen get the same sharpness, and the
  // frame-rate adaptation below never goes under the preset's floor.
  const dprNow = () => Math.min(window.devicePixelRatio || 1, quality.dprCap);
  const fixedPx = params.has('px') ? num('px', 1) : params.has('scale') ? num('scale', 1) * dprNow() : 0;
  let px = fixedPx || Math.min(quality.px[1], dprNow());
  let time = num('t', 0);
  let last = performance.now();
  let frameTimes = [];
  // set when the first frame is done: the scene fades in after the loader (captures skip the fade)
  let started = capture ? 0 : Infinity;

  function resize() {
    const dpr = dprNow();
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const k = Math.min(px, dpr) / dpr;
    renderer.resize(Math.max(64, Math.round(cw * k)), Math.max(64, Math.round(ch * k)));
  }

  // adapt render resolution to keep the frame rate smooth (not while warming
  // up: the first frames after the loader are slow for reasons resolution won't fix)
  function adapt(dt, now) {
    if (fixedPx || now - started < 3000) {
      frameTimes = [];
      return;
    }
    frameTimes.push(dt);
    if (frameTimes.length < 90) return;
    frameTimes.sort((a, b) => a - b);
    const median = frameTimes[frameTimes.length >> 1];
    frameTimes = [];
    const [lo, , hi] = quality.px.map((v) => Math.min(v, dprNow()));
    if (median > 1 / 45) px = Math.max(lo, px - 0.12);
    else if (median < 1 / 58) px = Math.min(hi, px + 0.06);
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!freeze) time += dt;
    adapt(dt, now);
    resize();
    const shot = director.update(freeze ? 0 : dt, time);
    shot.underwater = shot.pos[1] < shot.water;
    const e = env.update(freeze ? 0 : dt, time, shot);
    audio.update(dt, shot, e);
    const fade = Math.min(1, Math.max(0, now - started) / 2500);
    renderer.render(shot, e, time, fade * fade * (3 - 2 * fade));
    if (renderer.frame === 1) {
      // the first frame carries the start-up bakes: hide the loader once it is done
      gpu.device.queue.onSubmittedWorkDone().then(() => {
        document.body.classList.add('ready');
        if (!capture) started = performance.now();
      });
    }
    // ?sync waits for the GPU each frame (useful for software renderers)
    if (capture && renderer.frame >= capture) {
      captureToCanvas(gpu.device, gpu.context, canvas);
      return;
    }
    if (sync) gpu.device.queue.onSubmittedWorkDone().then(() => requestAnimationFrame(frame));
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__scene = { renderer, director, env };
}

main();
