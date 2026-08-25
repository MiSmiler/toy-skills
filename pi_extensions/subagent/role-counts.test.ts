import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ROLE_STATUS_KEY,
	ROLES,
	emptyRoleCounts,
	formatRoleCounts,
	incrementRoleCounts,
} from "./role-counts.ts";

describe("emptyRoleCounts", () => {
	it("starts every bundled role at zero", () => {
		const counts = emptyRoleCounts();
		for (const role of ROLES) assert.equal(counts[role], 0);
	});
});

describe("incrementRoleCounts", () => {
	it("increments one role and leaves the others untouched", () => {
		let counts = emptyRoleCounts();
		counts = incrementRoleCounts(counts, "scout");
		counts = incrementRoleCounts(counts, "worker");
		counts = incrementRoleCounts(counts, "worker");
		assert.equal(counts.scout, 1);
		assert.equal(counts.reviewer, 0);
		assert.equal(counts.worker, 2);
	});

	it("starts from zero when a role absent from the initial set is counted", () => {
		const counts = incrementRoleCounts({}, "reviewer");
		assert.equal(counts.reviewer, 1);
		// roles never present stay absent in the set, but render as 0 in the footer
		assert.equal(formatRoleCounts(counts), "scout:0 reviewer:1 worker:0");
	});

	it("does not mutate the input counter set", () => {
		const original = emptyRoleCounts();
		incrementRoleCounts(original, "scout");
		assert.equal(original.scout, 0);
	});
});

describe("formatRoleCounts", () => {
	it("renders all three roles in fixed order, zero included", () => {
		assert.equal(
			formatRoleCounts({ scout: 2, reviewer: 5, worker: 0 }),
			"scout:2 reviewer:5 worker:0",
		);
	});

	it("renders zeros for roles missing from the counter set", () => {
		assert.equal(formatRoleCounts({ scout: 1 }), "scout:1 reviewer:0 worker:0");
	});

	it("ignores non-bundled role keys that are stored internally", () => {
		const counts = incrementRoleCounts(emptyRoleCounts(), "mystery");
		assert.equal(formatRoleCounts(counts), "scout:0 reviewer:0 worker:0");
	});
});

describe("ROLE_STATUS_KEY", () => {
	it("is a distinct footer key", () => {
		assert.equal(ROLE_STATUS_KEY, "subagent");
	});
});
