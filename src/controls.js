// Gentle interaction: drag to look around (springs back), and a speaker
// toggle that only appears while the pointer is active.

export function attachControls(canvas, director, audio) {
  const button = document.getElementById('sound');
  let hideTimer = 0;
  const show = () => {
    button.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => button.classList.remove('visible'), 2600);
  };

  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, yaw: director.lookYaw, pitch: director.lookPitch };
    canvas.setPointerCapture(e.pointerId);
    show();
  });
  canvas.addEventListener('pointermove', (e) => {
    show();
    if (!dragging) return;
    const s = 2.2 / Math.max(canvas.clientWidth, canvas.clientHeight);
    director.lookYaw = Math.max(-1.2, Math.min(1.2, dragging.yaw - (e.clientX - dragging.x) * s));
    director.lookPitch = Math.max(-0.6, Math.min(0.6, dragging.pitch + (e.clientY - dragging.y) * s));
  });
  const end = () => { dragging = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  button.addEventListener('click', () => {
    const on = audio.toggle();
    button.classList.toggle('on', on);
    show();
  });
}
