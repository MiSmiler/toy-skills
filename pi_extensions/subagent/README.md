# Subagent

Single-mode subagent tool. Delegate a task to one of three bundled roles —
`scout`, `reviewer`, `worker` — which runs in its own isolated `pi` subprocess
(isolated context, so the parent session stays clean). Only the role's clean
`<final_result>` inner Markdown comes back as the tool's `content`; the full
transcript stays in `details` for the collapsed / expanded (Ctrl+O) view.

Single mode only: `{ agent, task }`. (Parallel fan-out and chained pipelines are
a separate, later ticket and are not wired here.)

## What comes back

- **On success**: `content` is the inner Markdown of the **last**
  `<final_result>...</final_result>` block in the final assistant text. `details`
  is `{ mode: "single", results }` — the full transcript for the TUI view,
  never fed back to the model.
- **On genuine failure** (nonzero exit / error stop reason / aborted): `isError`
  is set and `content` is the real error text (`errorMessage` / `stderr` /
  output). A clean summary never masks a failure.
- **Missing `<final_result>`**: a successful run that never emitted the tag sets
  `isError` with "Subagent did not produce a `<final_result>` output."

Each role inherits the parent session's model (no hardcoded provider pins) and
shares the full toolset `read, bash, edit, write, grep, find, ls`. `subagent`
is not in that list, so subagents cannot nest.

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

Runs the clean-return module's tests with the built-in `node:test` runner and
Node's native TypeScript type-stripping (no pi runtime import, no extra
loader).
