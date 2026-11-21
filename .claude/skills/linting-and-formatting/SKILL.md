---
name: linting-and-formatting
description:
  Formatter, strictest-possible linting and machine-checked architecture and clean-code rules (layering, cycles,
  complexity, duplication, dead code) for every file type in this repo, plus the baselines that hold pre-existing
  violations and the CI that enforces it all. Use before committing, after editing any file, when a lint check fails,
  when adding a file type or tool, or when changing lint, format or CI configuration.
---

# Linting and formatting

Every file type is auto-formatted and linted with the strictest configuration its tool offers, and warnings count as
errors. Commit only when `npm run check` passes. The tooling is dev-only: Pages ships just `index.html` and `src/`, so
the site stays build-free.

## Commands

- `npm ci` once, then `npm run format` (Prettier, writes) and `npm run check` (format check plus every linter; CI runs
  exactly this).
- `npm run lint:<name>` runs one check: `js`, `md`, `html`, `css`, `arch`, `dup`, `dead`, `actions`.
- `npm run lint:prune` after fixing baselined ESLint violations, to shrink `eslint-suppressions.json`.

## What runs

- **Formatting**: Prettier for JS, HTML, CSS, Markdown, YAML and JSON (`.prettierrc.json`: 120 columns, Markdown
  `proseWrap: always`). Prettier leaves template-string contents alone, so WGSL keeps its hand formatting.
- **JS** (`eslint.config.js`): every core rule (`js.configs.all`), every unicorn rule, sonarjs recommended, with strict
  size and complexity limits in `LIMITS`, `id-length` allowing the single-letter maths names, and a ban on browser and
  GPU globals in `src/world/` and `src/core/math.js` (that code runs on the CPU next to the camera director).
  `eslint-config-prettier` turns off only stylistic rules that fight the formatter.
- **Markdown** (`.markdownlint-cli2.jsonc`): all rules, lines at most 120 characters, tables and code included.
- **HTML and CSS** (`index.html`): html-validate (recommended, document, a11y) and Stylelint standard through
  postcss-html.
- **Architecture** (`.dependency-cruiser.cjs`): imports point down `main.js` → `render/` → `shaders/` → `scene/` →
  `world/` → `core/`. Shaders are generated from the scene's ids and sizes (`scene/catalog.js`, `scene/flocks.js`), so
  scene code never imports from `shaders/`. `audio/` and `debug/` are leaves used only by `main.js`. No cycles, orphans
  or imports from outside `src/`.
- **Duplication** (`.jscpd.json`): capped just above the current 0.7%, so it can only go down. The JS/WGSL twins are
  intended duplication across two languages and are not what jscpd measures.
- **Dead code** (`knip.json`): no unused files, exports or dev dependencies.
- **Workflows**: actionlint, in CI. Locally it runs only when installed (`brew install actionlint`).
- **WGSL**: no linter fits WGSL embedded in JS, so its check is the browser's compiler (`checking-rendering`).

## Baselines

Code that predates the strict setup is recorded, not exempted from the rules:

- `eslint-suppressions.json`: per-file, per-rule counts of existing ESLint violations. A file may not gain violations;
  when you touch a file, fixing some of its entries and running `npm run lint:prune` is welcome.

Never regenerate a baseline to make new violations pass.

## Rules for changing the setup

- Turn a rule off only when it contradicts another enabled rule or can't work here, with a comment next to it saying why
  (see `unicorn/consistent-arrow-return-style` in `eslint.config.js`).
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
