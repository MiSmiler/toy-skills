# pi_extensions

Source code for self-developed pi coding-agent extensions.

These files are **not auto-loaded** from this directory. Extensions must be
installed manually using one of the methods below.

Two layouts exist:

- **Single-file** — one `.ts` module (e.g. `level-picker.ts`, `write-guard.ts`).
- **Multi-file** — a directory holding an entry module plus sibling modules and
  bundled assets (e.g. `subagent/`). A multi-file extension must always be
  installed or loaded as its **directory** (or its entry `index.ts`), never as a
  single file, because the sibling `import`s and bundled assets (role Markdown,
  etc.) resolve relative to the entry module.

## Install methods

### Method 1: Place in the auto-discovery directory

The auto-discovery directory (`~/.pi/agent/extensions/`) picks up extensions
without any `settings.json` entry. Use this only if you want the extension
auto-discovered.

**Single-file:** copy the file.

```bash
cp level-picker.ts ~/.pi/agent/extensions/
```

**Multi-file:** place the whole **directory** (never a single file), copied or
symlinked:

```bash
cp -r "$PWD/subagent" ~/.pi/agent/extensions/subagent   # frozen copy
ln -s "$PWD/subagent" ~/.pi/agent/extensions/subagent   # live link to the repo
```

Then run `/reload` in pi to load it. The extension is now available in all
projects.

> **Usually unnecessary for multi-file.** A directory extension is loaded live
> from wherever you point at it, so you don't have to copy or link it into the
> auto-discovery folder. Prefer `pi -e` (temporary) or Method 2 (persistent) —
> both point at the source directory directly, so edits to the bundled role
> Markdown take effect with no copy/link and no `/reload`.

To test an extension without installing, use `pi -e`:

```bash
# single-file
pi -e ./level-picker.ts

# multi-file: the directory resolves to its index.ts (equivalent here)
pi -e ./subagent
pi -e ./subagent/index.ts
```

`-e` only loads the extension for that one run (temporary); it does not persist.

### Method 2: Configure in settings.json

Add the extension path to the `extensions` field of `settings.json`.

- Global: `~/.pi/agent/settings.json` (paths resolve relative to `~/.pi/agent`)
- Project: `.pi/settings.json` (paths resolve relative to `.pi`)

```json
{
  "extensions": [
    "/absolute/path/to/pi_extensions/level-picker.ts",
    "/absolute/path/to/pi_extensions/subagent"
  ]
}
```

Absolute paths and `~` are supported. Then run `/reload` in pi.

**Multi-file in settings:** a directory entry resolves to its `index.ts` (pi
checks `package.json`'s `pi.extensions`, then falls back to `index.ts`/`index.js`
via `resolveExtensionEntries`), so pointing at the directory or at the entry
`index.ts` are equivalent. Use an **absolute** path for multi-file extensions so
their sibling imports and bundled assets resolve correctly regardless of where
pi is started.

> Note: project-local settings and extensions load only after the project is
> trusted. Prefer the global settings file or Method 1 unless the extension is
> meant for a single project.

## Extensions

| File | Description | Entry points |
|------|-------------|--------------|
| `level-picker.ts` | Select the current model's thinking level in the editor slot | `alt+l`, `/level` |
| `write-guard.ts` | Confirm `write` tool calls before execution | auto |
| `subagent/` | Delegate to bundled roles (`scout` / `reviewer` / `worker`) in isolated `pi` subprocesses: single `{ agent, task }`, parallel `{ tasks[] }` (capped at 4), or chain `{ chain[] }` with `{previous}` injection; returns clean `<final_result>`s | tool `subagent` |

> `subagent/` is a multi-file extension (entry module + discovery + clean-return
> module + bundled role Markdown), so it must be installed as a **directory**
> named `subagent` containing `index.ts` (copy or symlink the whole directory,
> not a single file). See `pi_extensions/subagent/README.md`.

### Why `alt+l` instead of `ctrl+shift+l`?

`ctrl+shift+l` was the first choice, but it collides with the built-in
`ctrl+l` (`app.model.select`): in terminals that do **not** support the
[Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
(such as Windows Terminal), `ctrl+shift+l` is transmitted as the same byte as
`ctrl+l` (`0x0C`), so the built-in model selector opens instead of this
extension's panel.

`alt+l` sends `ESC l`, which is byte-wise distinct from `ctrl+l` in every
terminal, so it is reliably distinguishable. If you use a Kitty-protocol
terminal (Kitty, iTerm2, Ghostty, WezTerm with the protocol enabled, recent
Windows Terminal), `ctrl+shift+l` can be re-added as an additional binding.
