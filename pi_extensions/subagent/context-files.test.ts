import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveUserContextFile } from "./context-files.ts";

const TEMP_DIRS: string[] = [];

function makeAgentDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-context-test-"));
	TEMP_DIRS.push(dir);
	return dir;
}

function touch(dir: string, name: string): string {
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, `${name} content\n`, { encoding: "utf-8" });
	return filePath;
}

afterEach(() => {
	while (TEMP_DIRS.length > 0) {
		const dir = TEMP_DIRS.pop()!;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("resolveUserContextFile", () => {
	it("prefers AGENTS.override.md over AGENTS.md and CLAUDE.md", () => {
		const dir = makeAgentDir();
		touch(dir, "CLAUDE.md");
		touch(dir, "AGENTS.md");
		const override = touch(dir, "AGENTS.override.md");
		assert.equal(resolveUserContextFile(dir), override);
	});

	it("prefers AGENTS.md over CLAUDE.md when no override is present", () => {
		const dir = makeAgentDir();
		touch(dir, "CLAUDE.md");
		const agents = touch(dir, "AGENTS.md");
		assert.equal(resolveUserContextFile(dir), agents);
	});

	it("falls back to CLAUDE.md when only it exists", () => {
		const dir = makeAgentDir();
		const claude = touch(dir, "CLAUDE.md");
		assert.equal(resolveUserContextFile(dir), claude);
	});

	it("returns undefined when no user context file exists", () => {
		const dir = makeAgentDir();
		assert.equal(resolveUserContextFile(dir), undefined);
	});

	it("skips a directory that shadows the AGENTS.md filename", () => {
		const dir = makeAgentDir();
		fs.mkdirSync(path.join(dir, "AGENTS.md"));
		assert.equal(resolveUserContextFile(dir), undefined);
	});

	it("returns undefined for a non-existent agent dir", () => {
		const dir = path.join(os.tmpdir(), `pi-context-missing-${Date.now()}`);
		assert.equal(resolveUserContextFile(dir), undefined);
	});
});
