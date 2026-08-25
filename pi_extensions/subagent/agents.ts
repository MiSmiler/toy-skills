/**
 * Role discovery — reads the roles bundled with the extension.
 *
 * Unlike the forked official sample (which discovers user/project agent
 * Markdown from `~/.pi/agent/agents` and `.pi/agents`), this extension ships
 * its roles next to the entry module and trusts them. There is no agent-scope
 * selection, no project-agent confirmation, and no reading of global or
 * project agent directories. The three bundled roles are discovered fresh on
 * every invocation, so prompt edits take effect without reloading.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/** A role definition parsed from a bundled Markdown agent file. */
export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	/** The Markdown body (after frontmatter), used as the subagent's system prompt. */
	systemPrompt: string;
	source: "bundled";
	filePath: string;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else yields no tools rather than throwing: a
 * single malformed role file must not take down discovery of the others.
 */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/** Directory (relative to this module) holding the bundled role Markdown files. */
const BUNDLED_AGENTS_DIR = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"agents",
);

function loadAgentsFromDir(dir: string): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (
			typeof frontmatter.name !== "string" ||
			typeof frontmatter.description !== "string"
		) {
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model:
				typeof frontmatter.model === "string"
					? frontmatter.model
					: undefined,
			systemPrompt: body,
			source: "bundled",
			filePath,
		});
	}

	return agents;
}

/**
 * Discover the bundled roles. Returns exactly the three bundled roles
 * (`scout` / `reviewer` / `worker`), deduplicated by name.
 */
export function discoverAgents(): AgentConfig[] {
	const agentMap = new Map<string, AgentConfig>();
	for (const agent of loadAgentsFromDir(BUNDLED_AGENTS_DIR)) {
		agentMap.set(agent.name, agent);
	}
	return Array.from(agentMap.values());
}
