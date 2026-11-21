---
name: committing-changes
description: Commit conventions for this repo, Conventional Commits messages and atomic commits. Use whenever creating a
  commit, splitting work into commits, writing a commit message or PR title, or the user asks to commit or push.
---

# Committing changes

## Atomic commits

One commit holds one logical change, and the site loads and renders without console errors at every commit, so
`git bisect` and reverts stay useful. Keep apart what can be reviewed or reverted separately:

- a refactor and the behaviour change it enables
- formatting or lint fixes and logic changes
- tooling or config and the code it is applied to
- unrelated fixes made along the way

Before committing, read `git diff --staged` and check it tells one story. Split mixed work with `git add -p` (or
stage whole files). If a change only works together with another, they belong in the same commit. Run the formatter
and linters on the staged files first (`linting-and-formatting` skill).

## Message format

[Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
type(scope): imperative summary in lower case, no trailing period

Optional body wrapped at 72 characters: why the change was made and anything non-obvious
about how. The diff already shows what changed.

BREAKING CHANGE: only when a URL parameter, deployed path or similar contract changes
```

- Types: `feat` (visible new behaviour), `fix`, `perf`, `refactor`, `style` (formatting only), `docs`, `test`,
  `build`, `ci`, `chore` (tooling, config, agent instructions).
- Scope is the area touched: `terrain`, `props`, `trees`, `water`, `sky`, `clouds`, `shadows`, `post`, `audio`,
  `director`, `env`, `controls`, `loader`, `deploy`, `lint`, `claude`. Leave it out when the change spans many areas.
- Keep the header within 72 characters. A `!` after the scope marks a breaking change.

Examples:

```text
feat(trees): grow rainforest crowns by space colonisation
perf(terrain): bake only newly exposed clipmap rows
fix(director): keep the camera above the reef at low tide
chore(claude): move commit rules into a skill
```

Older history uses `Area: Sentence` messages; don't copy that style.
