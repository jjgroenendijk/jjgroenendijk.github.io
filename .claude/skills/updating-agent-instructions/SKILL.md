---
name: updating-agent-instructions
description:
  When and how to change this repo's agent instructions (CLAUDE.md, .claude/skills, .claude/rules, hooks), what belongs
  where, and how to write them for Claude 5 models. Use when the user corrects a recurring behaviour, asks to remember
  or change a rule, a gotcha is discovered, code that an instruction describes changes, or a skill or CLAUDE.md is
  created, edited or reviewed.
---

# Updating agent instructions

## When to update

- The user corrects how work is done, and the correction applies beyond this one task.
- You hit a codebase gotcha that cost real time and that reading the files wouldn't make obvious.
- Code that an instruction names (file, function, constant, URL parameter, workflow) is renamed, moved or removed. Fix
  the instruction in the same change, since stale instructions mislead more than missing ones.
- The same procedure or explanation gets repeated in chat across sessions: turn it into a skill.

Don't update for one-off preferences, things that only matter to the current task, facts the code or git history already
records, or anything a fresh look at the repo would show. Personal preferences go in user-level files or memory, not in
the repo.

## Where it goes

- **`CLAUDE.md`**, loaded every session: what the repo is, how to run it, and gotchas that bite anyone touching the
  code.
- **A skill** in `.claude/skills/<name>/SKILL.md`, loaded on demand: a procedure, checklist or opinionated how-to.
- **`.claude/rules/*.md` with a `paths:` glob**: a rule that only applies to certain files.
- **A hook or permission** in `.claude/settings.json`: something that must happen every time, or must never happen.
- **A separate file next to a skill's `SKILL.md`**, linked from it: long reference material for that skill.

A rule phrased "always do X after Y" or "never do Z" is a hook or permission candidate, because instructions get weighed
against context and hooks don't. Keep `CLAUDE.md` to about 200 lines at most, and keep it an index: when a section grows
into steps, move it to a skill and leave a one-line pointer.

## How to write them

These models follow instructions closely and use judgement well, so instructions work best when they read like a
briefing to a capable colleague:

- **State intent and reasons, not just rules.** "Match the surrounding comment density" beats "never write comments"; a
  reason lets the model handle cases the rule didn't anticipate.
- **Plain emphasis.** No CAPS, MUST or repeated warnings; they cause over-application. Say a thing once, in the place it
  applies. Keep hard guardrails in hooks instead.
- **Spend words on what Claude can't infer**: local gotchas, coupled files, project opinions. Leave out general
  programming advice, descriptions of the file tree and anything the code makes obvious.
- **No old-model scaffolding**: no "think step by step", "be thorough" or "double-check your work". Effort settings
  handle that.
- **Be specific about style.** Name the concrete patterns wanted or unwanted rather than adjectives like "clean".
- **Prefer real references to prose**: point at an existing file or function as the example to follow.
- **Match freedom to fragility.** Give heuristics where several approaches work, and exact commands only where steps are
  fragile or order-dependent.
- Markdown wraps at 120 characters, like all Markdown in the repo.

## Skill format

- Folder and `name`: lowercase gerund phrase with hyphens, unique and specific (`checking-rendering`, not `utils`).
  Don't name a project skill `verify` or `simplify`: Claude Code then runs it before every commit.
- `description`: third person, what it does plus when to use it, with trigger words a user would actually say. Keep it
  under 1,024 characters, with no angle brackets.
- Body: under 500 lines, written as standing instructions (the body stays in context once loaded). Link any supporting
  files directly from `SKILL.md`, one level deep, and say whether to run them or read them.
- Set `disable-model-invocation: true` for skills with side effects that only the user should trigger.
- Frontmatter must start on line 1 and be valid YAML, or every field is silently dropped.

## Checking a change

1. Look for conflicts: grep `CLAUDE.md` and `.claude/` for the topic and merge rather than add a second version.
2. Check that every path, command and name the instructions mention still exists.
3. For a new or reworked skill, try a realistic prompt in a fresh session and see whether it triggers and is followed.
   Leftover context from writing the skill hides gaps.
4. Run the Markdown formatter and linter (`linting-and-formatting`) and commit as `docs(claude): ...` or
   `chore(claude): ...` (`committing-changes`), separate from code changes unless the instruction describes that exact
   change.
