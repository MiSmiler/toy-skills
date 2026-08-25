/**
 * User-level context-file resolution for the subagent's isolated `pi`
 * subprocess.
 *
 * The child `pi` is spawned with `--no-context-files`, which suppresses every
 * auto-loaded context file (global + project + ancestor AGENTS.md / CLAUDE.md).
 * We re-inject only the user-level file so the subagent still obeys the user's
 * standing language / terminology rules while staying blind to the repo's
 * workflow rules (see the context-file policy decision).
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * pi's user-level context-file precedence, in the order pi's resource loader
 * resolves them (`loadContextFileFromDir`) — the first existing file wins:
 * `AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md`. The uppercase variants are
 * the ones pi also considers, so we mirror that list exactly.
 */
const USER_CONTEXT_FILE_NAMES = [
	"AGENTS.override.md",
	"AGENTS.md",
	"AGENTS.MD",
	"CLAUDE.md",
	"CLAUDE.MD",
] as const;

/**
 * Resolve the user-level context file pi would otherwise auto-load from the
 * agent directory, honoring pi's precedence. Returns `undefined` when none of
 * the candidate files exist (or are readable regular files).
 *
 * @param agentDir The agent config directory (e.g. `~/.pi/agent/`), as
 *   returned by `getAgentDir()`.
 */
export function resolveUserContextFile(agentDir: string): string | undefined {
	for (const name of USER_CONTEXT_FILE_NAMES) {
		const filePath = join(agentDir, name);
		try {
			if (existsSync(filePath) && statSync(filePath).isFile()) {
				return filePath;
			}
		} catch {
			// Ignore an unreadable entry and fall through to the next candidate.
		}
	}
	return undefined;
}
