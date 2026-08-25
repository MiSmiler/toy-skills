/**
 * Subagent Tool — dispatch a task to a bundled role in an isolated `pi`
 * subprocess and return only a clean `<final_result>`.
 *
 * Single mode only: `{ agent, task }`. The agent name resolves against the
 * three bundled roles (`scout` / `reviewer` / `worker`). Each role runs in its
 * own `pi` subprocess (isolated context), inherits the parent session's model
 * (the frontmatter omits `model`), and shares the full toolset minus `subagent`
 * so it cannot nest.
 *
 * On success the tool returns only the inner Markdown of the last
 * `<final_result>` block as `content`; the full transcript stays in `details`.
 * A genuine failure (nonzero exit / error / aborted stop reason), or a
 * successful run that never emitted a `<final_result>` block, sets `isError`
 * with the real error — a clean summary never masks a failure.
 *
 * Forked from the official pi subagent example, modified for single-mode
 * clean return, bundled-role discovery, and default model inheritance.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	getMarkdownTheme,
	withFileMutationQueue,
	type ExtensionAPI,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, discoverAgents } from "./agents.ts";
import { resolveUserContextFile } from "./context-files.ts";
import {
	buildChainContent,
	buildContent,
	buildParallelContent,
	injectPrevious,
	type CleanResult,
	type ParallelTaskResult,
} from "./clean-return.ts";

const COLLAPSED_ITEM_COUNT = 10;
const MAX_PARALLEL_TASKS = 4;
const MAX_PARALLEL_CONCURRENCY = 3;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: ThemeColor, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "bundled" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

type SubagentMode = "single" | "parallel" | "chain";

/** One unit of work handed to a bundled role: the role to invoke, its task, and an optional cwd. */
interface SubagentTaskInput {
	agent: string;
	task: string;
	cwd?: string;
}

interface SubagentDetails {
	mode: SubagentMode;
	results: SingleResult[];
	/** For `chain` mode, the 0-based index of the step that failed (pipeline stopped there), if any. */
	failedIndex?: number | null;
}

/** The last assistant text part of a final assistant message, if any. */
function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall")
					items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

/** Map a subagent result to the clean-return module's input shape. */
function toCleanResult(r: SingleResult): CleanResult {
	return {
		exitCode: r.exitCode,
		stopReason: r.stopReason,
		errorMessage: r.errorMessage,
		stderr: r.stderr,
		finalOutput: getFinalOutput(r.messages),
	};
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

interface DispatchDefaults {
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

async function runSingleAgent(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		};
	}

	// Suppress every auto-loaded context file (global + project + ancestor
	// AGENTS.md / CLAUDE.md): the child subagent must not inherit the repo's
	// workflow rules. The user-level file is re-injected separately below.
	const args: string[] = ["--mode", "json", "-p", "--no-session", "--no-context-files"];
	// Roles omit `model` in their frontmatter, so they inherit the dispatching
	// session's model. An optional per-role override still wins.
	const model = agent.model ?? dispatchDefaults.model;
	if (model) args.push("--model", model);
	if (!agent.model && dispatchDefaults.thinkingLevel) {
		args.push("--thinking", dispatchDefaults.thinkingLevel);
	}
	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [
					{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" },
				],
				details: { mode: "single", results: [currentResult], failedIndex: null },
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		// Re-inject only the user-level context file (honoring pi's precedence,
		// AGENTS.override.md > AGENTS.md > CLAUDE.md) so the subagent still obeys
		// the user's standing language / terminology rules, while staying blind to
		// the project / ancestor AGENTS.md that --no-context-files suppressed.
		// Multiple --append-system-prompt values are joined with "\n\n", so the
		// role's agent body and the user-level file coexist in the system prompt.
		const userContextFile = resolveUserContextFile(getAgentDir());
		if (userContextFile) {
			args.push("--append-system-prompt", userContextFile);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: { type?: string; message?: Message };
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) {
			currentResult.stopReason = "aborted";
			currentResult.errorMessage = "Subagent was aborted";
		}
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

/** Map completed subagent runs to the clean-return module's labelled aggregation shape. */
function toParallelTaskResults(results: SingleResult[]): ParallelTaskResult[] {
	return results.map((r) => ({ agent: r.agent, result: toCleanResult(r) }));
}

/**
 * Run independent tasks concurrently, capped at {@link MAX_PARALLEL_TASKS} tasks
 * per call and {@link MAX_PARALLEL_CONCURRENCY} in-flight subprocesses. Returns
 * results in task order (holes are never left: every worker drains the whole
 * queue). Streaming updates re-aggregate the completed results so far.
 */
async function runParallel(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agents: AgentConfig[],
	tasks: SubagentTaskInput[],
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
): Promise<SingleResult[]> {
	const capped = tasks.slice(0, MAX_PARALLEL_TASKS);
	const results: (SingleResult | undefined)[] = new Array(capped.length);

	const emit = () => {
		if (!onUpdate) return;
		const done = results.filter((r): r is SingleResult => r !== undefined);
		const built = buildParallelContent(toParallelTaskResults(done));
		onUpdate({
			content: [{ type: "text", text: built.content }],
			details: { mode: "parallel", results: done, failedIndex: null },
		});
	};

	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (nextIndex < capped.length && !signal?.aborted) {
			const idx = nextIndex++;
			const task = capped[idx];
			const result = await runSingleAgent(
				defaultCwd,
				dispatchDefaults,
				agents,
				task.agent,
				task.task,
				task.cwd,
				signal,
				undefined,
			);
			results[idx] = result;
			emit();
		}
	}

	const workerCount = Math.min(MAX_PARALLEL_CONCURRENCY, capped.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	return results as SingleResult[];
}

interface ChainOutcome {
	results: SingleResult[];
	failedIndex: number | null;
}

/**
 * Run a chained pipeline in order. Each step's `{previous}` placeholder is
 * replaced with the previous (successful) step's clean `<final_result>` content
 * before dispatch; the pipeline stops at the first failed step, which the caller
 * is told about so it can report it. Streaming updates reflect the steps
 * completed so far.
 */
async function runChain(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agents: AgentConfig[],
	steps: SubagentTaskInput[],
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
): Promise<ChainOutcome> {
	const results: SingleResult[] = [];
	let previousContent = "";
	let failedIndex: number | null = null;

	const emit = () => {
		if (!onUpdate) return;
		const built = buildChainContent(toParallelTaskResults(results), failedIndex);
		onUpdate({
			content: [{ type: "text", text: built.content }],
			details: { mode: "chain", results: [...results], failedIndex },
		});
	};

	for (let i = 0; i < steps.length; i++) {
		if (signal?.aborted) break;
		const step = steps[i];
		const task = injectPrevious(step.task, previousContent);
		const result = await runSingleAgent(
			defaultCwd,
			dispatchDefaults,
			agents,
			step.agent,
			task,
			step.cwd,
			signal,
			undefined,
		);
		results.push(result);
		const built = buildContent(toCleanResult(result));
		if (built.isError) {
			failedIndex = i;
			emit();
			break;
		}
		previousContent = built.content;
		emit();
	}

	return { results, failedIndex };
}

const SubagentTaskParams = Type.Object({
	agent: Type.String({ description: "Role to invoke: scout / reviewer / worker." }),
	task: Type.String({ description: "Task to delegate to the role." }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent process." })),
});

// OpenAI function schemas require a single top-level `type: "object"`; a
// `Type.Union` serialises to `{ anyOf: [...] }` with no top-level `type` and is
// rejected by the API. So the three call shapes (single / parallel / chain) are
// modelled as optional fields on one object, and `execute` dispatches on which
// key is present.
const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Role to invoke (single mode): scout / reviewer / worker." })),
	task: Type.Optional(Type.String({ description: "Task to delegate (single mode)." })),
	tasks: Type.Optional(Type.Array(SubagentTaskParams, {
		description: "Independent tasks to fan out concurrently (parallel mode, capped at 4).",
	})),
	chain: Type.Optional(Type.Array(SubagentTaskParams, {
		description: "Chained steps run in order (chain mode); each may reference the previous step via {previous}.",
	})),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subagent process." })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to bundled roles (scout / reviewer / worker) in isolated contexts.",
			"Single: { agent, task } returns the clean <final_result> inner Markdown.",
			"Parallel: { tasks[] } fans out independent tasks concurrently (capped at 4 tasks).",
			"Chain: { chain[] } runs steps in order, injecting each step's {previous} content.",
			"Full transcripts are kept in details.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const dispatchDefaults: DispatchDefaults = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};
			const agents = discoverAgents();

			if (Array.isArray(params.tasks)) {
				const results = await runParallel(
					ctx.cwd,
					dispatchDefaults,
					agents,
					params.tasks,
					signal,
					onUpdate,
				);
				const builtContent = buildParallelContent(toParallelTaskResults(results));
				return {
					content: [{ type: "text", text: builtContent.content }],
					details: { mode: "parallel", results, failedIndex: null },
				};
			}

			if (Array.isArray(params.chain)) {
				const { results, failedIndex } = await runChain(
					ctx.cwd,
					dispatchDefaults,
					agents,
					params.chain,
					signal,
					onUpdate,
				);
				const builtContent = buildChainContent(
					toParallelTaskResults(results),
					failedIndex,
				);
				return {
					content: [{ type: "text", text: builtContent.content }],
					details: { mode: "chain", results, failedIndex },
				};
			}

			// Single mode.
			const agentName = params.agent;
			const task = params.task;
			if (typeof agentName !== "string" || typeof task !== "string") {
				throw new Error('subagent single mode requires both "agent" and "task".');
			}
			const result = await runSingleAgent(
				ctx.cwd,
				dispatchDefaults,
				agents,
				agentName,
				task,
				params.cwd,
				signal,
				onUpdate,
			);
			const builtContent = buildContent(toCleanResult(result));
			return {
				content: [{ type: "text", text: builtContent.content }],
				details: { mode: "single", results: [result], failedIndex: null },
			};
		},

		renderCall(args, theme, _context) {
			if (Array.isArray(args.tasks)) {
				const total = args.tasks.length;
				const capped = Math.min(total, MAX_PARALLEL_TASKS);
				const note =
					total > MAX_PARALLEL_TASKS
						? theme.fg("warning", ` (capped to ${MAX_PARALLEL_TASKS})`)
						: "";
				const names = args.tasks.map((t) => t.agent).join(", ") || "...";
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", "parallel") +
					theme.fg("muted", ` [${capped} task${capped === 1 ? "" : "s"}${note}]`);
				text += `\n  ${theme.fg("dim", names)}`;
				return new Text(text, 0, 0);
			}

			if (Array.isArray(args.chain)) {
				const count = args.chain.length;
				const names = args.chain.map((t) => t.agent).join(" → ") || "...";
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", "chain") +
					theme.fg("muted", ` [${count} step${count === 1 ? "" : "s"}]`);
				text += `\n  ${theme.fg("dim", names)}`;
				return new Text(text, 0, 0);
			}

			const agentName = args.agent || "...";
			const preview =
				args.task && args.task.length > 60
					? `${args.task.slice(0, 60)}...`
					: args.task;
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", " [bundled]");
			text += `\n  ${theme.fg("dim", preview ?? "...")}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const modeLabel = details.mode;
			const multiple = details.results.length > 1;

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded
							? item.text
							: item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			// Render one subagent result's expanded section. Uses the same
			// clean-return contract as `execute` so the rendered status icon and
			// error text never disagree with the `content` the model received.
			const presentSection = (container: Container, r: SingleResult, index: number) => {
				const builtContent = buildContent(toCleanResult(r));
				const isError = builtContent.isError;
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");

				if (multiple) {
					container.addChild(
						new Text(
							theme.fg("accent", `─── ${modeLabel} result ${index + 1} — ${r.agent} ───`),
							0,
							0,
						),
					);
				}

				let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				container.addChild(new Text(header, 0, 0));
				if (isError)
					container.addChild(new Text(theme.fg("error", `Error: ${builtContent.content}`), 0, 0));

				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
				container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));

				const displayItems = getDisplayItems(r.messages);
				const toolCalls = displayItems.filter((i) => i.type === "toolCall");
				const showCleanOutput = !isError && builtContent.content.length > 0;
				if (toolCalls.length === 0 && !showCleanOutput) {
					container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
				} else {
					for (const item of toolCalls)
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") +
									formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					if (showCleanOutput) {
						container.addChild(new Spacer(1));
						container.addChild(new Markdown(builtContent.content, 0, 0, mdTheme));
					}
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
				}
			};

			if (expanded) {
				const container = new Container();
				if (multiple) {
					const count = details.results.length;
					container.addChild(
						new Text(
							theme.fg("toolTitle", theme.bold(`subagent ${modeLabel}`)) +
								theme.fg("muted", ` (${count} result${count === 1 ? "" : "s"})`),
							0,
							0,
						),
					);
				}
				if (details.mode === "chain" && details.failedIndex != null) {
					container.addChild(
						new Text(
							theme.fg("error", `Pipeline stopped at step ${details.failedIndex + 1}`),
							0,
							0,
						),
					);
				}
				details.results.forEach((r, i) => {
					if (i > 0) container.addChild(new Spacer(1));
					presentSection(container, r, i);
				});
				return container;
			}

			// Collapsed: one compact line per result, all concatenated.
			let text = "";
			details.results.forEach((r, i) => {
				const builtContent = buildContent(toCleanResult(r));
				const isError = builtContent.isError;
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const heading = multiple
					? `${theme.fg("accent", `${modeLabel} ${i + 1}: `)}`
					: "";
				let line = `${heading}${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) line += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError) {
					line += `\n${theme.fg("error", `Error: ${builtContent.content}`)}`;
				} else {
					const displayItems = getDisplayItems(r.messages);
					if (displayItems.length === 0) {
						line += `\n${theme.fg("muted", "(no output)")}`;
					} else {
						line += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
						if (displayItems.length > COLLAPSED_ITEM_COUNT)
							line += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
					}
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) line += `\n${theme.fg("dim", usageStr)}`;
				if (text) text += "\n\n";
				text += line;
			});
			return new Text(text, 0, 0);
		},
	});

	// pi ignores a returned `isError` from `execute` (a normal return always
	// leaves the result unflagged); only a throw from `execute` sets it. To flag
	// a subagent failure without losing the transcript kept in `details`, derive
	// the clean-return contract here and patch `isError` post-hoc.
	pi.on("tool_result", (event) => {
		if (event.toolName !== "subagent") return;
		const details = event.details as SubagentDetails | undefined;
		if (!details || details.results.length === 0) return;

		let isError = false;
		if (details.mode === "single") {
			const r = details.results[0];
			if (r) isError = buildContent(toCleanResult(r)).isError;
		} else if (details.mode === "parallel") {
			isError = buildParallelContent(toParallelTaskResults(details.results)).isError;
		} else if (details.mode === "chain") {
			isError = buildChainContent(
				toParallelTaskResults(details.results),
				details.failedIndex ?? null,
			).isError;
		}

		if (isError) return { isError: true };
	});
}
