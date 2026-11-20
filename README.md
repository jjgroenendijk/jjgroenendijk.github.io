# jjgroenendijk.github.io

An endless, procedurally generated tropical island, rendered in real time with WebGPU.
Open the page and the camera starts drifting through the archipelago: high over the islands, low across turquoise lagoons, along jungle valleys and over coral reefs, through a full day and night cycle with drifting weather.
There are no binary assets: terrain, plants, animals, ships, clouds, sound and textures are all generated in code.

Requires a browser with WebGPU (recent Chrome/Edge, Safari 26+ on iOS/macOS).

## Run locally

Any static file server works, for example:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Useful URL parameters while developing:

| parameter | effect |
|-----------|--------|
| `u=0.4` | start at this point of the shot cycle (0 aerial, 0.25 lagoon, 0.4 jungle, 0.7 reef) |
| `tod=0.7` | time of day (0 midnight, 0.5 noon, 0.75 sunset) |
| `q=low\|medium\|high` | quality preset |
| `scale=0.8` | fixed render scale (disables adaptive resolution) |
| `freeze` | stop time |
| `capture=N` | render offscreen and show frame N as an image (for headless/software GPUs) |
| `skip=water,props` | leave out render passes (debugging) |

## How it works

```
src/
  main.js            boot, main loop, adaptive resolution
  controls.js        drag-to-look and the sound toggle
  core/              WebGPU helpers, matrix math
  world/             periodic noise, terrain, waves, sky model, environment (time/weather), camera director
  scene/             procedural meshes (plants, reef, fauna, pirates) and the scatter catalogue
  render/            one module per render pass, orchestrated by renderer.js
  shaders/           WGSL sources (common library + one file per pass)
  audio/             procedural ambient soundscape (Web Audio)
```

Each frame:

1. **Terrain cache** (compute): heights, normals and far horizon shadows of a geometry clipmap are baked into a texture array, only for levels that moved.
2. **Scatter** (compute): vegetation, coral, wildlife and set pieces are placed around the camera, frustum culled and LOD-sorted straight into GPU buffers that drive indirect draws.
3. **Shadows**: three stabilised cascades.
4. **Clouds**: ray-marched volumetric cumulus at reduced resolution.
5. **Opaque**: terrain, props, sky (reverse-Z, HDR).
6. **Water**: Gerstner waves, refraction with absorption, screen-space reflections, foam; floating particles.
7. **Post**: volumetric light shafts, TAA, bloom, ACES tonemapping and grading.

The world is periodic over 16 km in both directions, with every noise lattice wrapped, so the camera can fly forever without losing floating-point precision.
The JavaScript copy of the terrain function in `world/` uses the same integer hashing as the WGSL version, so the camera director can keep a safe distance from the ground.

Deployment: `.github/workflows/pages.yml` publishes the repository root to GitHub Pages.
