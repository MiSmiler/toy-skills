import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	MISSING_FINAL_RESULT_MESSAGE,
	buildContent,
	extractFinalResult,
	isFailedResult,
} from "./clean-return.ts";

describe("extractFinalResult", () => {
	it("extracts the trimmed inner Markdown of a single block", () => {
		const text =
			"some preamble\n<final_result>\n## Findings\n- a\n- b\n</final_result>\nmore text";
		assert.equal(extractFinalResult(text), "## Findings\n- a\n- b");
	});

	it("returns the last block when multiple are present", () => {
		const text =
			"<final_result>first block</final_result> ... <final_result>second block</final_result>";
		assert.equal(extractFinalResult(text), "second block");
	});

	it("returns null when no block exists", () => {
		assert.equal(extractFinalResult("just an answer, no tag"), null);
		assert.equal(extractFinalResult(""), null);
	});

	it("returns an empty string for a present-but-empty block", () => {
		assert.equal(extractFinalResult("<final_result></final_result>"), "");
		assert.equal(extractFinalResult("<final_result>   </final_result>"), "");
	});
});

describe("isFailedResult", () => {
	it("is true for a nonzero exit", () => {
		assert.equal(isFailedResult({ exitCode: 1 }), true);
	});

	it("is true for an error stop reason", () => {
		assert.equal(
			isFailedResult({ exitCode: 0, stopReason: "error" }),
			true,
		);
	});

	it("is true for an aborted stop reason", () => {
		assert.equal(
			isFailedResult({ exitCode: 0, stopReason: "aborted" }),
			true,
		);
	});

	it("is false for a clean end", () => {
		assert.equal(isFailedResult({ exitCode: 0, stopReason: "end" }), false);
	});

	it("is false when stopReason is absent", () => {
		assert.equal(isFailedResult({ exitCode: 0 }), false);
	});
});

describe("buildContent", () => {
	it("returns the clean inner Markdown on success", () => {
		const built = buildContent({
			exitCode: 0,
			stderr: "",
			finalOutput: "<final_result>\n## Done\nok\n</final_result>",
		});
		assert.deepEqual(built, { content: "## Done\nok", isError: false });
	});

	it("flags isError when a successful run has no <final_result> block", () => {
		const built = buildContent({
			exitCode: 0,
			stopReason: "end",
			stderr: "",
			finalOutput: "answer without a tag",
		});
		assert.deepEqual(built, {
			content: MISSING_FINAL_RESULT_MESSAGE,
			isError: true,
		});
	});

	it("surfaces the real error for a nonzero exit, never a masked summary", () => {
		const built = buildContent({
			exitCode: 1,
			stderr: "boom",
			finalOutput: "<final_result>must not be returned</final_result>",
		});
		assert.deepEqual(built, { content: "boom", isError: true });
	});

	it("prefers errorMessage over stderr and finalOutput for a failure", () => {
		const built = buildContent({
			exitCode: 2,
			errorMessage: "LLM exploded",
			stderr: "some stderr",
			finalOutput: "final text",
		});
		assert.deepEqual(built, { content: "LLM exploded", isError: true });
	});

	it("reports an aborted stop reason as an error with the real message", () => {
		const built = buildContent({
			exitCode: 0,
			stopReason: "aborted",
			errorMessage: "User aborted",
			stderr: "",
			finalOutput: "",
		});
		assert.deepEqual(built, { content: "User aborted", isError: true });
	});

	it("falls back to (no output) when a failure has no message at all", () => {
		const built = buildContent({ exitCode: 3, stderr: "", finalOutput: "" });
		assert.deepEqual(built, { content: "(no output)", isError: true });
	});
});
