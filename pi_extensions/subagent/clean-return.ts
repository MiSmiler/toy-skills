/**
 * Clean-return module for the `subagent` tool.
 *
 * This is the single testing seam of the extension. It owns every decision
 * that differs from the forked official subagent sample around what comes back
 * to the parent: extracting the last `<final_result>` block, assembling a
 * per-result `content` + `isError` pair, and (in later tickets) `{previous}`
 * injection and parallel aggregation.
 *
 * The module is deliberately pure and free of any runtime imports from the pi
 * packages (it uses local structural types only), so it can be unit-tested
 * standalone without spawning a real `pi` subprocess or importing the
 * extension host.
 */

/** Shown to the model when a subagent finishes successfully but never emitted a `<final_result>` block. */
export const MISSING_FINAL_RESULT_MESSAGE =
	"Subagent did not produce a `<final_result>` output.";

/**
 * The minimal slice of a completed subagent run that the clean-return contract
 * needs. Local structural type — no pi package types, so the module stays
 * import-free.
 */
export interface CleanResult {
	exitCode: number;
	stopReason?: string;
	errorMessage?: string;
	stderr: string;
	/** The full final assistant text (raw transcript tail), if any. */
	finalOutput: string;
}

/** What `buildContent` returns: the text the parent model sees plus the error flag. */
export interface BuiltContent {
	content: string;
	isError: boolean;
}

/**
 * Whether a subagent run genuinely failed (as opposed to succeeding with a
 * malformed output). A nonzero exit, or an LLM `error` / `aborted` stop reason,
 * is always a failure.
 */
export function isFailedResult(
	result: Pick<CleanResult, "exitCode" | "stopReason">,
): boolean {
	return (
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

/**
 * Extract the Markdown inside the **last** `<final_result>...</final_result>`
 * block of a final assistant text, trimmed, or `null` when no block exists.
 *
 * A present-but-empty block yields `""` (a valid, if empty, result). Only the
 * total absence of a block yields `null`.
 */
export function extractFinalResult(text: string): string | null {
	if (!text) return null;
	const pattern = /<final_result>([\s\S]*?)<\/final_result>/g;
	let last: string | null = null;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		last = (match[1] ?? "").trim();
	}
	return last;
}

/**
 * Assemble a mode-agnostic `content` + `isError` pair for a single result.
 *
 * On success it returns the extracted `<final_result>` inner Markdown. On a
 * genuine failure (nonzero exit / error / aborted stop reason) it bypasses
 * extraction entirely and surfaces the real error text, so a clean summary
 * never masks a failure. A successful run that contains no `<final_result>`
 * block is likewise treated as a failure.
 */
export function buildContent(result: CleanResult): BuiltContent {
	if (isFailedResult(result)) {
		return {
			content:
				result.errorMessage ||
				result.stderr ||
				result.finalOutput ||
				"(no output)",
			isError: true,
		};
	}

	const clean = extractFinalResult(result.finalOutput);
	if (clean === null) {
		return { content: MISSING_FINAL_RESULT_MESSAGE, isError: true };
	}

	return { content: clean, isError: false };
}
