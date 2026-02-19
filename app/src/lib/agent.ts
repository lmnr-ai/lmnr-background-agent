import "server-only";

import { query as origQuery, type Options } from "@anthropic-ai/claude-agent-sdk";
import { Laminar } from "@lmnr-ai/lmnr";
import { SYSTEM_PROMPT } from "./system-prompt";

const query = Laminar.wrapClaudeAgentQuery(origQuery);

const DEFAULT_OPTIONS: Options = {
  model: process.env.AGENT_MODEL || "claude-sonnet-4-5",
  allowedTools: [
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Glob",
    "Grep",
    "MultiEdit",
    "WebSearch",
    "WebFetch",
    "mcp__browser__*",
  ],
  mcpServers: {
    browser: {
      command: "npx",
      args: ["@playwright/mcp-server"],
    },
  },
  permissionMode: "acceptEdits",
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: SYSTEM_PROMPT,
  },
  settingSources: ["project"],
};

export type AgentRun = {
  query: ReturnType<typeof origQuery>;
  stderrChunks: string[];
};

/**
 * Run the Claude agent with streaming.
 *
 * @param prompt   The user's task description
 * @param options  Optional overrides (cwd, continue conversation)
 */
export function runAgent(
  prompt: string,
  options?: { cwd?: string; continue?: boolean },
): AgentRun {
  const stderrChunks: string[] = [];
  const q = query({
    prompt,
    options: {
      ...DEFAULT_OPTIONS,
      cwd: options?.cwd ?? process.env.AGENT_CWD ?? process.cwd(),
      continue: options?.continue,
      includePartialMessages: true,
      debug: true,
      stderr: (data: string) => {
        console.error("[agent-sdk]", data);
        stderrChunks.push(data);
      },
    },
  });
  return { query: q, stderrChunks };
}
