---
name: checking-rendering
description:
  Renders the WebGPU scene headlessly at a fixed, repeatable view and screenshots it, catching WGSL compile errors and
  visual regressions. Use after changing shaders, render passes, terrain, props or lighting, or when asked to run,
  screenshot or visually check the app.
---

# Checking rendering

There are no tests, so this is how a change gets verified: load the page in headless Chromium, render offscreen,
screenshot it and read the console.

1. Serve the repo: `python3 -m http.server 8000` (run it in the background).
2. Open a pinned view, so before and after images are comparable:
   `http://localhost:8000/?capture=60&cycle=3&seed=0.3&u=0.4&tod=0.5&freeze`.
   - `capture=N` renders offscreen and, after N frames, draws the image into a 2D canvas and sets
     `window.__captured = true`. Wait for that flag (allow a minute or so, since start-up bakes textures), then take the
     screenshot.
   - Choose `u` for the subject: 0 aerial, 0.25 lagoon, 0.4 jungle, 0.7 reef. `tod`: 0 midnight, 0.5 noon, 0.75 sunset.
   - `skip=water,props,...` drops passes to isolate a problem. `scale=1` fixes resolution.
3. Collect every console message. Any `[label] line:col` WGSL error, `uncapturederror` or "device lost" means the change
   is broken, whatever the image looks like.
4. Compare against a capture of the same URL from the base commit (`git stash` or a worktree) when judging a visual
   change.

Playwright with Chromium: in the cloud environment `require('playwright')` works as is. Locally, launch Chrome or
Chromium with WebGPU enabled (`--enable-unsafe-webgpu`, and `--use-angle=swiftshader` or `--enable-features=Vulkan` on
machines without a usable GPU). `window.__scene` (`{ renderer, director, env }`) is available for inspection.
