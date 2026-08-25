# Subagent

Multimode subagent tool. Delegate work to one of three bundled roles — `scout`,
`reviewer`, `worker` — each in its own isolated `pi` subprocess (isolated
context, so the parent session stays clean). Only the roles' clean
`<final_result>` inner Markdown comes back as the tool's `content`; the full
transcripts stay in `details` for the collapsed / expanded (Ctrl+O) view.

Three dispatch modes:

- **Single**: `{ agent, task }` — one role runs, returns its clean `<final_result>`.
- **Parallel**: `{ tasks: [...] }` — independent tasks fan out concurrently,
  capped at **4** tasks per call and **3** concurrent subprocesses. `content` is
  a header line plus each task's clean content under a per-task heading.
- **Chain**: `{ chain: [...] }` — steps run in order; each step's `{previous}`
  placeholder is replaced with the previous step's clean `<final_result>`
  content. The pipeline stops at the first failed step and names it.

## Session counter

While the session is open, the footer status line shows how many times each
role has been invoked this session, e.g. `scout:0 reviewer:5 worker:2` (always
all three slots, zero included). A role counts once each time it is actually
dispatched to a subprocess. The counter is **in-memory only**: the extension
module is re-instantiated on every session transition, so it resets when a new
or resumed session starts — nothing is written to disk.

## What comes back

- **Single, on success**: `content` is the inner Markdown of the **last**
  `<final_result>...</final_result>` block in the final assistant text.
- **Parallel**: `content` = a header line (`Parallel: N tasks, X succeeded, Y
  failed`) + each task's clean content (or its real error text) labelled by
  index and agent. `isError` is set when **any** task fails.
- **Chain, on success**: `content` is the **last** step's clean
  `<final_result>` — the pipeline's final output. On a failed step, the pipeline
  stops, `content` names the failed step (1-based index + agent) and surfaces
  its real error, and `isError` is set.
- **`details`** is `{ mode, results, failedIndex? }` — the full per-run
  transcript(s) for the TUI view, never fed back to the model.
- **On genuine failure** (nonzero exit / error stop reason / aborted): `isError`
  is set and `content` is the real error text (`errorMessage` / `stderr` /
  output). A clean summary never masks a failure.
- **Missing `<final_result>`**: a successful run that never emitted the tag sets
  `isError` with "Subagent did not produce a `<final_result>` output."

Each role inherits the parent session's model (no hardcoded provider pins) and
shares the full toolset `read, bash, edit, write, grep, find, ls`. `subagent`
is not in that list, so subagents cannot nest.

## Context files

Each role runs in an isolated `pi` subprocess launched with `--no-context-files`,
so subagents never auto-load the project / ancestor `AGENTS.md` or `CLAUDE.md`
— those describe the parent's workflow, not a scoped subagent's narrow job. Only
the **user-level** `~/.pi/agent/AGENTS.md` (or `AGENTS.override.md` when present)
is re-injected via `--append-system-prompt`, honoring pi's precedence
(`AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md`), so the subagent still obeys
the user's standing language / terminology rules. The role's agent body
(`agents/*.md`) is appended alongside it, so the role persona + output contract
still apply.

## Install

This is a multi-file extension (entry module + discovery + clean-return module +
bundled role Markdown), so it must be installed as a **directory** containing
`index.ts`. Copy or symlink the whole directory so the role Markdown and
discovery module resolve relative to the entry module.

```bash
mkdir -p ~/.pi/agent/extensions/subagent
cp -r ./pi_extensions/subagent/index.ts \
      ./pi_extensions/subagent/agents.ts \
      ./pi_extensions/subagent/clean-return.ts \
      ./pi_extensions/subagent/context-files.ts \
      ./pi_extensions/subagent/agents \
      ~/.pi/agent/extensions/subagent/
```

Then run `/reload` in pi. (Or add the entry `index.ts` path to the `extensions`
field in `settings.json`.) Role prompt edits are re-read on every invocation, so
no reload is needed to change them.

## Test

```bash
# from pi_extensions/subagent
npm test
```

Runs the clean-return, context-files, and role-counts modules' tests with the
built-in `node:test` runner and Node's native TypeScript type-stripping (no pi
runtime import, no extra loader).
