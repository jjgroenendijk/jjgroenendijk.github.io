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

At start-up six ground materials (white and black sand, grass, leaf litter, rock, basalt) are baked into two texture arrays with full mip chains: albedo and height, and normal, roughness and occlusion. The patterns are procedural (warped Voronoi grains, tufts, leaves, cracked rock with lichen), tile seamlessly, and the mips keep roughness honest by folding the lost normal detail into it (Toksvig).

The heightfield itself is fbm with analytic derivatives: from the second octave on, detail is damped on steep slopes, and on the hillsides two octaves of gully noise carve ridges and channels that run downhill, the finer ones branching along the coarser.

Each frame:

1. **Terrain cache** (compute): heights, normals, far horizon shadows, sky visibility (horizon ambient occlusion) and curvature of a nine-level geometry clipmap (about 12 km of view distance) are baked into a toroidal texture array. When a level scrolls only the newly exposed rows and columns are baked; the slow-changing far detail (horizon shadows, soft cloud-lit tint) is refreshed a band of rows per frame, so no frame pays for a whole level.
2. **Sky lighting** (compute): the sky's radiance is baked into a small direction LUT and projected onto nine spherical-harmonic coefficients, only when the sun, moon or haze change. Fog, reflections and refraction read the LUT; every surface gets directional sky ambient from the SH9 irradiance.
3. **Caustics** (compute): photons are refracted through the animated water surface and splatted into a map around the camera, giving the dancing light patterns on the shallow sea floor.
4. **Cloud shadow map** (compute): the light let through by the cloud layer is baked into a small texture, so the ground, plants and water sample it once instead of evaluating cloud noise per pixel.
5. **Flocking** (compute): fish schools and bird flocks are boids that keep apart, align with and stay close to their neighbours while following a target that roams along the island. Their state persists between frames.
6. **Scatter** (compute): vegetation, coral, wildlife and set pieces are placed around the camera, frustum culled (cheaply before any terrain noise is evaluated), occlusion culled against last frame's depth pyramid, and sorted into levels of detail, straight into GPU buffers. A final pass lays all draw slots end to end so the camera view draws every prop with a single indirect draw. Every instance sits on the cached terrain heights, exactly on the drawn ground. Distant palms and trees are re-scattered only every other frame and beyond about 700 m become impostor cards: camera-facing quads showing one of eight views baked into a texture atlas at start-up.
7. **Terrain culling** (compute): each clipmap tile finds its exact height range in the cache and is tested against the frustum and the depth pyramid; the visible tiles are compacted into one index list, so terrain and water are one indirect draw each.
8. **Shadows**: three stabilised, cached cascades. A cascade is only redrawn when it gets too old (every frame, every 2nd, every 8th) or the sun or view moved noticeably; otherwise last render is reused with its matrix shifted. Distant cascades only get large casters at coarse detail.
9. **Clouds**: ray-marched volumetric cumulus at reduced resolution.
10. **Prop visibility buffer**: the single prop draw writes only depth and a (slot, instance, triangle) ID per pixel. A fullscreen resolve rebuilds each pixel's triangle, interpolates it with perspective-correct barycentrics and shades it once, so the many overlapping layers of jungle foliage are no longer shaded and then thrown away.
11. **Opaque**: the resolved props, then terrain tiles (which lose the depth test wherever a prop covers them), then sky (reverse-Z, HDR). The ground picks at most two materials per pixel from slope, curvature, altitude and region and blends them by height, so sand settles between pebbles. Flat ground uses stochastic tiling (offset variants cross-faded by a slow noise) against visible repeats, cliffs use triplanar mapping; detail normals are combined with reoriented normal mapping. Shading is PBR: Lambert plus GGX with Schlick Fresnel, and a specular ambient from the sky LUT with an analytic environment BRDF and specular occlusion. Occlusion combines the material, sky visibility and a cavity term from curvature. Rain wets the ground (darker, smoother, puddles in hollows) and it dries out in the sun. The beach shows wet sand behind each wave's run-up and a trail of footprints. Afterwards a min-depth pyramid (Hi-Z) is built for next frame's culling.
12. **Water**: Gerstner waves, refraction with absorption, and foam. Reflections are traced at half resolution against the smooth swell and looked up with a ripple offset; floating particles.
13. **Post**: volumetric light shafts, TAA, bloom, ACES tonemapping and grading.

The world is periodic over 16 km in both directions, with every noise lattice wrapped, so the camera can fly forever without losing floating-point precision.
The JavaScript copy of the terrain function in `world/` uses the same integer hashing and erosion as the WGSL version, so the camera director can keep a safe distance from the ground.

Deployment: `.github/workflows/pages.yml` publishes `index.html` and `src/` to GitHub Pages.
