// Gentle interaction: drag to look around (springs back), and a speaker
// toggle that only appears while the pointer is active.

// How long the speaker toggle stays visible after the last pointer activity (ms).
const BUTTON_HIDE_MS = 2600,
  // Look angle per pixel of drag, scaled by the larger canvas side (radians across the full side).
  DRAG_GAIN = 2.2,
  // Look offset limits (radians).
  MAX_PITCH = 0.6,
  MAX_YAW = 1.2,
  attachControls = (canvas, director, audio) => {
    let dragging = false,
      hideTimer = 0;
    const button = document.querySelector('#sound'),
      end = () => {
        dragging = false;
      },
      show = () => {
        button.classList.add('visible');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => button.classList.remove('visible'), BUTTON_HIDE_MS);
      };

    canvas.addEventListener('pointerdown', (event) => {
      dragging = { pitch: director.lookPitch, x: event.clientX, y: event.clientY, yaw: director.lookYaw };
      canvas.setPointerCapture(event.pointerId);
      show();
    });
    canvas.addEventListener('pointermove', (event) => {
      show();
      if (!dragging) return;
      const s = DRAG_GAIN / Math.max(canvas.clientWidth, canvas.clientHeight);
      director.lookYaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, dragging.yaw - (event.clientX - dragging.x) * s));
      director.lookPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, dragging.pitch + (event.clientY - dragging.y) * s));
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    button.addEventListener('click', () => {
      const on = audio.toggle();
      button.classList.toggle('on', on);
      show();
    });
  };

export { attachControls };
