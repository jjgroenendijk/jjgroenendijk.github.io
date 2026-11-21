// Steps the fish schools and bird flocks once per frame. The agents live in a
// storage buffer that persists between frames; the scatter pass reads it.
import { shader, buffer, bindLayout, bindGroup, entry } from '../core/gpu.js';
import { flockWGSL, FISH_COUNT, BIRD_COUNT, FLOCK_GROUPS, AGENT_BYTES } from '../shaders/flock.js';

const MAX_STEP = 0.1;    // s: longer frames (a hitch, a hidden tab) are slowed down
const TIME_WRAP = 10000; // s: keeps the shader's time precise

export class FlockPass {
  constructor(device, shared) {
    this.device = device;
    this.state = buffer(device, (FISH_COUNT + BIRD_COUNT) * AGENT_BYTES, GPUBufferUsage.STORAGE, 'flock-state');
    this.step = buffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'flock-step');
    const layout = bindLayout(device, 'flock', [entry.uniform(), entry.storage()]);
    this.group = bindGroup(device, layout, [this.step, this.state], 'flock');
    this.pipeline = device.createComputePipelineAsync({
      label: 'flock',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, layout] }),
      compute: { module: shader(device, flockWGSL, 'flock'), entryPoint: 'main' },
    });
    this.lastTime = null;
  }

  encode(encoder, frameGroup, time) {
    const dt = this.lastTime === null ? 0 : Math.min(Math.max(time - this.lastTime, 0), MAX_STEP);
    this.lastTime = time;
    this.device.queue.writeBuffer(this.step, 0, new Float32Array([dt, time % TIME_WRAP, 0, 0]));
    const pass = encoder.beginComputePass({ label: 'flock' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group);
    pass.dispatchWorkgroups(FLOCK_GROUPS);
    pass.end();
  }
}
