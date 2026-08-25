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

/**
 * Replace every `{previous}` placeholder in a `chain` step's task text with the
 * clean content of the previous step. A task that carries no placeholder is
 * returned unchanged; an empty `previous` (the first step) simply removes the
 * placeholder. This is deliberately a literal string substitution with no
 * Markdown or template semantics.
 */
export function injectPrevious(task: string, previous: string): string {
	if (!task.includes("{previous}")) return task;
	return task.split("{previous}").join(previous);
}

/**
 * One completed parallel fan-out task, labelled by its agent for aggregation.
 * `agent` is the role name for the per-task heading; `result` is the clean
 * return input for that task.
 */
export interface ParallelTaskResult {
	agent: string;
	result: CleanResult;
}

/**
 * Aggregate the clean results of a `parallel` fan-out into a single
 * `content` + `isError` pair the parent model sees.
 *
 * `content` is a header line followed by each task's own clean
 * `<final_result>` (or its real error text, on a failed task) under a per-task
 * heading, so one coherent summary covers every task. `isError` is true when at
 * least one task failed, so a partial failure is never masked by a clean
 * aggregate.
 */
export function buildParallelContent(tasks: ParallelTaskResult[]): BuiltContent {
	if (tasks.length === 0) {
		return { content: "No parallel tasks were provided.", isError: true };
	}

	const built = tasks.map(({ result }) => buildContent(result));
	const succeeded = built.filter((b) => !b.isError).length;
	const failed = built.length - succeeded;
	const noun = tasks.length === 1 ? "task" : "tasks";
	const header =
		`Parallel: ${tasks.length} ${noun}, ${succeeded} succeeded, ${failed} failed`;

	const blocks = built.map((b, i) => {
		const task = tasks[i];
		const status = b.isError ? "failed" : "ok";
		return `### Task ${i + 1} — ${task.agent} (${status})\n${b.content}`;
	});

	return {
		content: `${header}\n\n${blocks.join("\n\n")}`,
		isError: failed > 0,
	};
}

/**
 * Aggregate a `chain`'s completed steps.
 *
 * On full success this is the **last** step's clean `<final_result>` — the
 * pipeline's final output. All upstream results are only meaningful through the
 * `{previous}` content already injected at execution time, so they are not
 * concatenated. On a failure, `content` names the failed step (its 1-based index
 * and agent) and surfaces its real error, with `isError: true` — the pipeline
 * stopped there.
 */
export function buildChainContent(
	steps: ParallelTaskResult[],
	failedIndex: number | null,
): BuiltContent {
	if (steps.length === 0) {
		return { content: "No chain steps were provided.", isError: true };
	}

	if (failedIndex !== null) {
		const failed = steps[failedIndex];
		const built = buildContent(failed.result);
		return {
			content: `Chain step ${failedIndex + 1} (${failed.agent}) failed:\n${built.content}`,
			isError: true,
		};
	}

	return buildContent(steps[steps.length - 1].result);
}
