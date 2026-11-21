// Entry point: boots WebGPU, then runs the endless camera flight.
import { CYCLE, W } from './world/noise.js';
import { captureToCanvas, offscreenContext } from './debug/capture.js';
import { Ambience } from './audio/ambience.js';
import { Director } from './world/director.js';
import { Environment } from './world/environment.js';
import { Renderer } from './render/renderer.js';
import { attachControls } from './controls.js';
import { initGPU } from './core/gpu.js';

// Frames of timing gathered before each resolution adaptation step.
const ADAPT_SAMPLES = 90,
  // Smoothstep's cubic 3x^2 - 2x^3, used for the fade-in.
  CUBIC_EASE = 3,
  DEFAULT_START_U = 0.02,
  DEFAULT_TIME_OF_DAY = 0.69,
  DEGREES_PER_HALF_TURN = 180,
  FADE_IN_MS = 2500,
  // Median frame rates above which the render resolution steps up (and, with SLOW_FPS, below which it steps down).
  FAST_FPS = 58,
  MAX_FRAME_DT = 0.1,
  MIN_RENDER_SIZE = 64,
  MS_PER_SECOND = 1000,
  PX_STEP_DOWN = 0.12,
  PX_STEP_UP = 0.06,
  // Px: rendered pixels per CSS pixel (floor, start, ceiling), never above the screen's own density.
  QUALITY_PRESETS = {
    high: {
      cloudDiv: 2,
      density: 1,
      distance: 1,
      dprCap: 2,
      level: 1,
      px: { ceiling: 2, floor: 1, start: 1.5 },
      shadowSize: 2048,
    },
    low: {
      cloudDiv: 4,
      density: 0.5,
      distance: 0.6,
      dprCap: 1.5,
      level: 0,
      px: { ceiling: 1.2, floor: 0.7, start: 1 },
      shadowSize: 1024,
    },
    medium: {
      cloudDiv: 3,
      density: 0.75,
      distance: 0.8,
      dprCap: 2,
      level: 0.5,
      px: { ceiling: 1.6, floor: 0.85, start: 1.3 },
      shadowSize: 1536,
    },
  },
  QUERY = new URLSearchParams(location.search),
  SLOW_FPS = 45,
  // The first frames after the loader are slow for reasons resolution won't fix (ms).
  WARMUP_MS = 3000,
  // Debugging aid: look=yawDeg,pitchDeg offsets the camera (decays like a drag).
  applyLook = (director) => {
    const look = (QUERY.get('look') || '').split(',').map((value) => (Number(value) * Math.PI) / DEGREES_PER_HALF_TURN);
    if (look.length !== 2) return;
    Object.assign(director, { lookPitch: look[1], lookYaw: look[0] });
  },
  // Random draws pick the starting cycle and the weather seed of each visit.
  // eslint-disable-next-line sonarjs/pseudo-random -- per-visit variety only, nothing secret depends on it
  chance = () => Math.random(),
  detectQuality = () => {
    const isMobile =
        /iPhone|iPad|iPod|Android/iu.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Mac/u.test(navigator.userAgent)),
      name = QUERY.get('q') || (isMobile && 'medium') || 'high',
      { px, ...preset } = QUALITY_PRESETS[name] || QUALITY_PRESETS.high,
      skip = (QUERY.get('skip') || '').split(',').filter(Boolean);
    return { mobile: isMobile, name, skip, ...preset, px: [px.floor, px.start, px.ceiling] };
  },
  dprNow = (dprCap) => Math.min(globalThis.devicePixelRatio || 1, dprCap),
  openGpu = async (canvas) => {
    try {
      return await initGPU(canvas);
    } catch (error) {
      // eslint-disable-next-line no-console -- the browser console is the only error surface
      console.warn(error);
      return false;
    }
  },
  readNumber = (key, fallback) => {
    let value = fallback;
    if (QUERY.has(key)) value = Number(QUERY.get(key));
    return value;
  },
  // A resolution fixed by ?px (pixels per CSS pixel) or ?scale (fraction of the screen's pixels); 0 adapts it.
  requestedPixelRatio = (dprCap) => {
    if (QUERY.has('px')) return readNumber('px', 1);
    if (QUERY.has('scale')) return readNumber('scale', 1) * dprNow(dprCap);
    return 0;
  },
  watchDevice = async (device) => {
    device.addEventListener?.('uncapturederror', (event) => {
      // eslint-disable-next-line no-console -- the browser console is the only error surface
      console.error(event.error.message);
    });
    const info = await device.lost;
    // eslint-disable-next-line no-console, no-underscore-dangle -- error surface; __scene is the documented debug hook
    console.warn('WebGPU device lost', info.reason, info.message, globalThis.__scene?.renderer.frame);
    document.body.classList.add('no-webgpu');
  };

// The frame loop. Render resolution is set in pixels per CSS pixel, not as a
// fraction of the screen's pixels, so a 1x and a 2x screen get the same
// sharpness, and the frame-rate adaptation never goes under the preset's floor.
class Flight {
  static async launch() {
    const canvas = document.querySelector('#scene'),
      capture = readNumber('capture', 0),
      // Captures render offscreen, so they open the device without a canvas.
      // eslint-disable-next-line unicorn/no-null -- initGPU configures no canvas context when given null
      gpu = await openGpu((!capture && canvas) || null);
    if (gpu) await Flight.#boot(canvas, capture, gpu);
    else document.body.classList.add('no-webgpu');
  }

  static async #boot(canvas, capture, gpu) {
    watchDevice(gpu.device);
    if (capture) {
      gpu.context = offscreenContext(gpu.device, canvas);
      gpu.format = gpu.context.format;
    }
    const audio = new Ambience(),
      cycle = Math.floor(chance() * (W / CYCLE)),
      director = new Director(readNumber('u', DEFAULT_START_U), readNumber('cycle', cycle)),
      environment = new Environment({
        seed: readNumber('seed', chance()),
        tod: readNumber('tod', DEFAULT_TIME_OF_DAY),
      }),
      quality = detectQuality(),
      renderer = new Renderer(gpu, quality);
    // Compiles the pipelines; init() resolves to this same renderer.
    await renderer.init();
    Flight.#takeOff({ audio, canvas, capture, director, environment, gpu, quality, renderer });
  }

  static #takeOff(scene) {
    const { director, environment, renderer } = scene;
    applyLook(director);
    attachControls(scene.canvas, director, scene.audio);
    Flight.#fly(scene);
    // eslint-disable-next-line no-underscore-dangle, unicorn/no-global-object-property-assignment -- console debug hook used by the checking-rendering skill
    globalThis.__scene = { director, env: environment, renderer };
  }

  static #fly(scene) {
    const flight = new Flight(scene);
    requestAnimationFrame(flight.#tick);
  }

  #fixedPx;
  #frameTimes = [];
  #isFrozen = QUERY.has('freeze');
  #last;
  #px;
  #scene;
  #shouldSync;
  // Set when the first frame is done: the scene fades in after the loader (captures skip the fade).
  #started = Infinity;
  #tick = (now) => this.#frame(now);
  #time = readNumber('t', 0);

  constructor(scene) {
    this.#scene = scene;
    this.#shouldSync = QUERY.has('sync') || scene.capture > 0;
    this.#fixedPx = requestedPixelRatio(scene.quality.dprCap);
    this.#px = this.#fixedPx || Math.min(scene.quality.px[1], dprNow(scene.quality.dprCap));
    this.#last = performance.now();
    if (scene.capture) this.#started = 0;
  }

  // Adapt render resolution to keep the frame rate smooth (not while warming
  // up: the first frames after the loader are slow for reasons resolution won't fix).
  #adapt(dt, now) {
    if (this.#fixedPx || now - this.#started < WARMUP_MS) {
      this.#frameTimes = [];
      return;
    }
    this.#frameTimes.push(dt);
    if (this.#frameTimes.length < ADAPT_SAMPLES) return;
    const { dprCap, px } = this.#scene.quality,
      median = this.#frameTimes.toSorted((a, b) => a - b)[Math.floor(this.#frameTimes.length / 2)],
      [lo, , hi] = px.map((limit) => Math.min(limit, dprNow(dprCap)));
    this.#frameTimes = [];
    if (median > 1 / SLOW_FPS) this.#px = Math.max(lo, this.#px - PX_STEP_DOWN);
    else if (median < 1 / FAST_FPS) this.#px = Math.min(hi, this.#px + PX_STEP_UP);
  }

  #draw(dt, now) {
    const { audio, environment, renderer } = this.#scene,
      advance = this.#step(dt),
      camera = this.#shoot(advance),
      conditions = environment.update(advance, this.#time, camera),
      fade = Math.min(1, Math.max(0, now - this.#started) / FADE_IN_MS);
    audio.update(dt, camera, conditions);
    renderer.render(camera, conditions, this.#time, fade * fade * (CUBIC_EASE - 2 * fade));
  }

  #frame(now) {
    const { capture, gpu, renderer } = this.#scene,
      dt = Math.min((now - this.#last) / MS_PER_SECOND, MAX_FRAME_DT);
    this.#last = now;
    if (!this.#isFrozen) this.#time += dt;
    this.#adapt(dt, now);
    this.#resize();
    this.#draw(dt, now);
    if (renderer.frame === 1) this.#revealWhenBaked();
    if (capture && renderer.frame >= capture) {
      captureToCanvas(gpu.device, gpu.context, this.#scene.canvas);
      return;
    }
    this.#requestNext();
  }

  // ?sync waits for the GPU each frame (useful for software renderers).
  async #requestNext() {
    if (this.#shouldSync) await this.#scene.gpu.device.queue.onSubmittedWorkDone();
    requestAnimationFrame(this.#tick);
  }

  #resize() {
    const { canvas, quality, renderer } = this.#scene,
      dpr = dprNow(quality.dprCap),
      height = Math.max(1, Math.round(canvas.clientHeight * dpr)),
      scale = Math.min(this.#px, dpr) / dpr,
      width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    renderer.resize(
      Math.max(MIN_RENDER_SIZE, Math.round(width * scale)),
      Math.max(MIN_RENDER_SIZE, Math.round(height * scale)),
    );
  }

  // The first frame carries the start-up bakes: hide the loader once it is done.
  async #revealWhenBaked() {
    await this.#scene.gpu.device.queue.onSubmittedWorkDone();
    document.body.classList.add('ready');
    if (!this.#scene.capture) this.#started = performance.now();
  }

  #shoot(advance) {
    const shot = this.#scene.director.update(advance, this.#time);
    shot.underwater = shot.pos[1] < shot.water;
    return shot;
  }

  #step(dt) {
    return (!this.#isFrozen && dt) || 0;
  }
}

await Flight.launch();
