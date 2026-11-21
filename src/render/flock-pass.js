// Steps the fish schools and bird flocks once per frame. The agents live in a
// storage buffer that persists between frames; the scatter pass reads it.
import { AGENT_BYTES, flockWGSL } from '../shaders/flock.js';
import { BIRD_COUNT, FISH_COUNT, FLOCK_GROUPS } from '../scene/flocks.js';
import { bindGroup, bindLayout, buffer, entry, flags, shader } from '../core/gpu.js';

// Longer frames than MAX_STEP seconds (a hitch, a hidden tab) are slowed down; time wraps every TIME_WRAP seconds to
// keep the shader's time precise. The step uniform is one vec4f: dt, time and padding.
const MAX_STEP = 0.1,
  STEP_BYTES = 16,
  TIME_WRAP = 10_000;

export class FlockPass {
  lastTime;

  constructor(device, shared) {
    this.device = device;
    this.state = buffer(device, (FISH_COUNT + BIRD_COUNT) * AGENT_BYTES, GPUBufferUsage.STORAGE, 'flock-state');
    this.step = buffer(device, STEP_BYTES, flags(GPUBufferUsage.UNIFORM, GPUBufferUsage.COPY_DST), 'flock-step');
    const layout = bindLayout(device, 'flock', [entry.uniform(), entry.storage()]);
    this.group = bindGroup(device, layout, [this.step, this.state], 'flock');
    this.pipeline = device.createComputePipelineAsync({
      compute: { entryPoint: 'main', module: shader(device, flockWGSL, 'flock') },
      label: 'flock',
      layout: device.createPipelineLayout({ bindGroupLayouts: [shared.frame, layout] }),
    });
  }

  encode(encoder, frameGroup, time) {
    // The first frame steps by zero
    const dt = Math.min(Math.max(time - (this.lastTime ?? time), 0), MAX_STEP),
      pass = encoder.beginComputePass({ label: 'flock' });
    this.lastTime = time;
    this.device.queue.writeBuffer(this.step, 0, new Float32Array([dt, time % TIME_WRAP, 0, 0]));
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group);
    pass.dispatchWorkgroups(FLOCK_GROUPS);
    pass.end();
  }
}
