/**
 * Per-role invocation counters for the subagent footer status line (issue #17).
 *
 * This is the pure, pi-independent core of the per-session counter: counting and
 * rendering helpers here are unit-tested directly. The counter is recorded in
 * memory only — the extension module that owns it is re-instantiated on every
 * session transition, so it resets when a new or resumed session starts.
 */

/** Footer status key, distinct from other extensions' keys (e.g. write-guard's `wg`). */
export const ROLE_STATUS_KEY = "subagent";
/** The bundled roles, in the fixed display order. */
export const ROLES = ["scout", "reviewer", "worker"] as const;

/** A role counter set. Roles that are present but not in `ROLES` are stored but not rendered. */
export type RoleCounts = Record<string, number>;

/** A fresh, all-zero counter set for the three bundled roles. */
export function emptyRoleCounts(): RoleCounts {
	return { scout: 0, reviewer: 0, worker: 0 };
}

/** Apply one invocation to a role, returning a new counter set (non-mutating). */
export function incrementRoleCounts(counts: RoleCounts, role: string): RoleCounts {
	return { ...counts, [role]: (counts[role] ?? 0) + 1 };
}

/** Render the counter string for the footer status, e.g. `scout:2 reviewer:5 worker:0`. */
export function formatRoleCounts(counts: RoleCounts): string {
	return ROLES.map((role) => `${role}:${counts[role] ?? 0}`).join(" ");
}
