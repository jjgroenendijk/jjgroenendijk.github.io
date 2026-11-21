# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A real-time WebGPU renderer of an endless, procedurally generated tropical archipelago. README.md describes every
render pass. Plain ES modules served as static files: no build step, no runtime dependencies, no tests. Everything
(meshes, textures, sound) is generated in code, so there are no binary assets to add.

## Running

`python3 -m http.server 8000`, then open <http://localhost:8000> in a WebGPU browser. URL parameters are listed in the
README; `main.js` also reads `t=` (start time), `look=yawDeg,pitchDeg` and `sync` (lockstep frames). The browser
console is the only error surface: `core/gpu.js` `shader()` prints WGSL compile errors with the shader label and
source line. To check a change visually, use the `checking-rendering` skill.

## Deployment

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`, which copies only `index.html` and `src/`.
New runtime files must live under `src/` or the workflow must change. The untracked `public/`, `themes/` and
`.hugo_build.lock` are leftovers of an old Hugo site, unrelated to this app.

## Gotchas

- **Shaders are WGSL in JS template strings** (`src/shaders/*.js`), composed by concatenating libraries
  (`frameStruct + commonLib + hizLib + ...`). `shaders/common.js` interpolates JS constants from `world/` into the WGSL
  through the `f()` float formatter, so a plain JS number there must still become a valid WGSL float.
- **Frame uniforms live in three places** that must agree: `FRAME_OFS` / `FRAME_FLOATS` and the `frameStruct` WGSL in
  `shaders/common.js`, and the writes in `render/frameUniforms.js`.
- **JS/WGSL twins**: `world/terrain.js`, `noise.js`, `waves.js` and `path.js` mirror the GPU terrain, wave and
  camera-path functions with identical integer hashing and erosion. The camera director uses the JS side to stay
  clear of the ground, so a change on one side without the other makes the camera clip into terrain.
- **The world is periodic over `W` (16 km)** and every noise lattice wraps. New noise must use the wrapped helpers in
  `noise.js` / `common.js`, or seams and precision loss appear.
- **Props are GPU-driven**: `scene/catalog.js` defines scatter kinds, `TYPE`/`MAT` ids, LODs and impostors; a compute
  scatter (`shaders/props.js`) culls against the frustum and last frame's Hi-Z, and all props go out in one indirect
  draw into a visibility buffer (`propsVisibility.js`) that a fullscreen pass resolves. LOD switches rely on dithered
  cross-fades that TAA smooths, so judge LOD changes with TAA on.
- **Terrain** is a nine-level clipmap (`LEVELS`) baked incrementally into a toroidal texture array; tiles are
  GPU-culled and drawn with one indirect draw. Ground materials are baked once at start-up.
- `renderer.js` owns all passes; its header comment is the authoritative per-frame pass order.

## Working agreements

- Every file type (JS, HTML, CSS, Markdown, YAML, JSON, and WGSL where tooling exists) gets an auto-formatter and the
  strictest linting available, and architecture and clean-code principles are machine-checked (layering, cycles,
  complexity, duplication, dead code). Markdown wraps at 120 characters. CI runs the same checks and blocks
  deployment when they fail. See the `linting-and-formatting` skill.
- Commits use Conventional Commits and are atomic. See the `committing-changes` skill.
- When a correction or discovery should outlive the session, update these instructions with the
  `updating-agent-instructions` skill.
- Match the surrounding code: dense, terse JS with an explanatory comment at the top of each module and pass.
