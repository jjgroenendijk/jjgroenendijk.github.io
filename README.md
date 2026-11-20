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
| `cycle=3` | which of the eight shot cycles to play (random by default) |
| `seed=0.3` | weather seed (random by default); with `cycle` it makes runs repeatable |
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

1. **Terrain cache** (compute): heights, normals and far horizon shadows of a nine-level geometry clipmap (about 12 km of view distance) are baked into a texture array, only for levels that moved.
2. **Cloud shadow map** (compute): the light let through by the cloud layer is baked into a small texture, so the ground, plants and water sample it once instead of evaluating cloud noise per pixel.
3. **Scatter** (compute): vegetation, coral, wildlife and set pieces are placed around the camera, frustum culled (cheaply before any terrain noise is evaluated) and sorted into up to three levels of detail, straight into GPU buffers that drive indirect draws.
4. **Shadows**: three stabilised cascades. Distant cascades only get large casters at coarse detail, and the far cascade is redrawn every other frame.
5. **Clouds**: ray-marched volumetric cumulus at reduced resolution.
6. **Opaque**: props first (so they hide terrain behind them early), then terrain in frustum-culled tiles, then sky (reverse-Z, HDR).
7. **Water**: Gerstner waves, refraction with absorption, screen-space reflections, foam; floating particles.
8. **Post**: volumetric light shafts, TAA, bloom, ACES tonemapping and grading.

The world is periodic over 16 km in both directions, with every noise lattice wrapped, so the camera can fly forever without losing floating-point precision.
The JavaScript copy of the terrain function in `world/` uses the same integer hashing as the WGSL version, so the camera director can keep a safe distance from the ground.

Deployment: `.github/workflows/pages.yml` publishes `index.html` and `src/` to GitHub Pages.
