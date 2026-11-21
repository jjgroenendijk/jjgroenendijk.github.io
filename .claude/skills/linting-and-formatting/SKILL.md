---
name: linting-and-formatting
description: Formatter and strictest-possible linting for every file type in this repo (JS, embedded WGSL, HTML, CSS,
  Markdown, YAML, JSON), plus machine-checked architecture and clean-code rules (layering, cycles, complexity,
  duplication, dead code) and the 120-character Markdown line length. Use before committing, after editing
  any file, when adding a new file type, or when setting up or changing lint and format tooling.
---

# Linting and formatting

The standard: every file type is auto-formatted and linted with the strictest configuration the tool offers, and
warnings count as errors. Code is committed only when the formatter is clean and the linters pass.

## Target tooling

All of it is dev-only. The Pages workflow ships only `index.html` and `src/`, so `package.json`, `node_modules` and
config files never reach the site, and the app itself stays build-free.

- **JS** (`src/**/*.js`): Prettier; ESLint flat config starting from `js.configs.all` plus `eslint-plugin-unicorn`
  `all`, `eslint-plugin-sonarjs` and the architecture rules below.
- **HTML and inline CSS** (`index.html`): Prettier; `html-validate` (`recommended` + `strict`), and Stylelint
  through `postcss-html`.
- **Markdown**: Prettier with `proseWrap: "always"` and `printWidth: 120`; `markdownlint-cli2` with all rules on and
  `MD013` set to 120.
- **YAML**: Prettier; `actionlint` for `.github/workflows`, `yamllint` strict elsewhere.
- **JSON**: Prettier, whose parse step doubles as the check.
- **WGSL** (template strings in `src/shaders`): no standalone formatter or linter fits embedded WGSL, so compile
  errors in the browser console (`checking-rendering`) are the check.

Expose it as `npm run format` (write), `npm run lint` (check everything, non-zero exit on any warning) and
`npm run check` (format check plus lint, never writes).

## CI

CI enforces the same checks, so nothing unformatted or failing lint lands on `main`:

- A `check` job (`.github/workflows/check.yml`, or a job in `pages.yml`) runs `npm ci` and `npm run check` on every
  pull request and on every push to `main`. It also runs `actionlint` on the workflows.
- Deployment depends on it. The Pages `deploy` job has `needs: check` (or the deploy workflow runs only after a
  successful check run), so a failing check blocks the release.
- CI only checks. It never auto-formats or pushes fixes; the fix happens locally with `npm run format`.
- Pin action versions, and keep tool versions locked through `package-lock.json`, so local and CI results agree.
- When adding a new linter or file type, add it to `npm run check` in the same commit, so CI covers it immediately.

If some of this isn't in the repo yet, set it up when you first touch that file type, as its own `build(lint)` commit,
then apply the formatter in a separate `style` commit so logic diffs stay readable.

## Architecture and clean-code checks

Use machine checks wherever a principle can be checked, so it holds without relying on review:

- **Layering** (`dependency-cruiser`, rules in `.dependency-cruiser.cjs`): imports only point down this stack.
  - `main.js`, `controls.js`
  - `render/`
  - `scene/`, `shaders/`
  - `world/`
  - `core/`

  `audio/` and `debug/` are leaves, imported only from `main.js`. `world/` stays GPU-free, because the camera
  director runs it on the CPU. Also forbid:
  - circular imports
  - orphan modules
  - imports of `../` paths outside `src/`
  - deep imports into another layer's internals where a public module exists

  The layers have no file-level cycle today, but `scene/` and `shaders/` depend on each other: `scene/catalog.js` and
  `scene/trees.js` import constants from `shaders/`, and `shaders/` imports `TYPE`/`MAT` from `scene/catalog.js`.
  Record those imports as known violations (a dependency-cruiser `--ignore-known` baseline), then remove them by
  moving the shared constants so they point one way. Don't loosen the rule to fit them.
- **Size and complexity** (ESLint core + `eslint-plugin-sonarjs`):
  - `complexity`
  - `sonarjs/cognitive-complexity`
  - `max-depth`
  - `max-params`
  - `max-statements`
  - `max-lines-per-function`
  - `max-lines`
  - `max-nested-callbacks`

  Set strict thresholds. Existing hotspots go into a temporary per-file override with a comment, which shrinks as
  code is refactored and never grows. WGSL strings are data, so exclude template literals from line counts
  (`skipComments` / `ignorePattern`), or scope the size rules away from `src/shaders`.
- **Duplication** (`jscpd`, threshold close to 0%): duplicated JS logic gets extracted. The JS/WGSL twins in `world/`
  vs `shaders/` are intended duplication across two languages and stay out of scope.
- **Dead code** (`knip`): no unused files, exports or dependencies.
- **Naming and idioms** (`unicorn`, ESLint `id-length`, `prefer-const`, `no-param-reassign`, `eqeqeq`,
  `no-implicit-coercion`, `no-shadow`):
  - Short math names are the house style in shaders and vector code, so allow those (for example `x`, `y`, `z`, `t`,
    `k`, `p`, `n`, `d`, `i`, `j`) through `exceptions`, rather than turning the rule off.
  - `no-magic-numbers` stays on outside shader and noise constants; name the constants that matter.
- **Purity of the world layer**: forbid `GPU*`, `navigator`, `document` and `window` in `src/world/**` and
  `src/core/math.js` with `no-restricted-globals` / `no-restricted-syntax`.

Run all of these from `npm run lint`, so a single command covers style, architecture and clean-code checks.

## Strictness rules

- Turn rules off only when they contradict another enabled rule or can't work here (for example the WGSL template
  strings, or WebGPU globals such as `GPUBufferUsage`, which go in the globals config instead). Put a comment next to
  each disabled rule saying why.
- Prefer fixing the code to suppressing a rule. An unavoidable suppression is inline, covers one line, names the rule
  and gives the reason: `// eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin`.
- The codebase is deliberately dense. Formatter options that only fight that style (a very short print width, for
  example) are a judgement call to raise with the user, but rules that catch real bugs stay on.
- After changing lint config, run the whole suite and fix or justify every new finding in the same PR.

## Before committing

Run `npm run format` and `npm run lint` on the changed files, re-stage what the formatter rewrote, and commit only
when both are clean. Treat a lint failure as part of the task, not a follow-up.
