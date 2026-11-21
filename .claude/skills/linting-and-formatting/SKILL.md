---
name: linting-and-formatting
description:
  Formatter, strictest-possible linting and machine-checked architecture and clean-code rules (layering, cycles,
  complexity, duplication, dead code) for every file type in this repo, and the CI that enforces it all. Use before
  committing, after editing any file, when a lint check fails, when adding a file type or tool, or when changing lint,
  format or CI configuration.
---

# Linting and formatting

Every file type is auto-formatted and linted with the strictest configuration its tool offers, and warnings count as
errors. Commit only when `npm run check` passes. The tooling is dev-only: Pages ships just `index.html` and `src/`, so
the site stays build-free.

## Commands

- `npm ci` once, then `npm run format` (Prettier, writes) and `npm run check` (format check plus every linter; CI runs
  exactly this).
- `npm run lint:<name>` runs one check: `js`, `md`, `html`, `css`, `arch`, `dup`, `dead`, `actions`.

## What runs

- **Formatting**: Prettier for JS, HTML, CSS, Markdown, YAML and JSON (`.prettierrc.json`: 120 columns, Markdown
  `proseWrap: always`). Prettier leaves template-string contents alone, so WGSL keeps its hand formatting.
- **JS** (`eslint.config.js`): every core rule (`js.configs.all`), every unicorn rule, sonarjs recommended, with strict
  size and complexity limits in `LIMITS`, `id-length` allowing the single-letter maths names, and a ban on browser and
  GPU globals in `src/world/` and `src/core/math.js` (that code runs on the CPU next to the camera director).
  `eslint-config-prettier` turns off only stylistic rules that fight the formatter. `no-magic-numbers` allows -1, 0,
  0.5, 1 and 2 everywhere and is off in the numeric-model files listed in the config (meshes, noise, terrain, sky,
  waves, sound); everywhere else each number gets a named constant, and in the model files reused or meaningful numbers
  still do.
- **Markdown** (`.markdownlint-cli2.jsonc`): all rules, lines at most 120 characters, tables and code included.
- **HTML and CSS** (`index.html`): html-validate (recommended, document, a11y) and Stylelint standard through
  postcss-html.
- **Architecture** (`.dependency-cruiser.cjs`): imports point down `main.js` → `render/` → `shaders/` → `scene/` →
  `world/` → `core/`. Shaders are generated from the scene's ids and sizes (`scene/catalog.js`, `scene/flocks.js`), so
  scene code never imports from `shaders/`. `audio/` and `debug/` are leaves used only by `main.js`. No cycles, orphans
  or imports from outside `src/`.
- **Duplication** (`.jscpd.json`): capped at 0.1%. The JS/WGSL twins are intended duplication across two languages and
  are not what jscpd measures.
- **Dead code** (`knip.json`): no unused files, exports or dev dependencies.
- **Workflows**: actionlint, in CI. Locally it runs only when installed (`brew install actionlint`).
- **WGSL**: no linter fits WGSL embedded in JS, so its check is the browser's compiler (`checking-rendering`).

## Patterns the rules push towards

The whole codebase passes with no baseline, so new code has to as well. What the strict set means in practice here:

- One `const` (or `let`) statement per scope (`one-var`), in dependency order; modules with private helpers end in an
  `export { ... }` list.
- No ternaries (`no-ternary`): use `if`, a lookup table, or `Number(condition)` as a 0/1 factor.
- Numbers outside the numeric-model files are named constants, often grouped in an object (`HEIGHT.cruise`). Numbers
  inside arrays count as magic too.
- Object keys are sorted (`sort-keys`). Where key order is observable (iterated, or defining ids or buffer layout), use
  an array or an explicit `id`/`order` field instead.
- WebGPU usage flags go through `flags(...)` from `core/gpu.js` rather than `|`.
- Justified inline disables that exist today: `no-bitwise` in the integer hashes that mirror WGSL, `max-params` on a few
  positional GPU signatures, `no-console` where the console is the error surface, and the `__scene`/`__captured` debug
  hooks.

## Rules for changing the setup

- Turn a rule off only when it contradicts another enabled rule or can't work here, with a comment next to it saying why
  (see `sort-vars`, `unicorn/prefer-ternary` and `unicorn/consistent-arrow-return-style` in `eslint.config.js`).
- Prefer fixing code to suppressing. An unavoidable suppression is inline, covers one line, names the rule and gives a
  reason: `// eslint-disable-next-line no-bitwise -- integer hash must match the WGSL twin`.
- Don't run `eslint --fix` across the codebase. Some unicorn fixes change semantics here: `prefer-math-trunc` turns
  `x | 0` into `Math.trunc(x)`, which drops the int32 wraparound the hashes rely on. Apply fixes per rule and review
  each diff.
- A new file type or tool gets added to `npm run check` in the same commit, so CI covers it straight away.

## CI

The `check` job in `.github/workflows/pages.yml` runs `npm ci`, `npm run check` and actionlint on every pull request and
every push to `main`. The Pages deploy needs that job, so a failing check blocks the release. CI never formats or pushes
fixes.
