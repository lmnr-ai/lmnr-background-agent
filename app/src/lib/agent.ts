import "server-only";

import { query as origQuery, type Options } from "@anthropic-ai/claude-agent-sdk";

import { Laminar } from '@lmnr-ai/lmnr';

let initialized = false;
function getQuery() {
  if (!initialized) {
    Laminar.initialize();
    initialized = true;
  }
  return Laminar.wrapClaudeAgentQuery(origQuery);
}

const DEFAULT_OPTIONS: Options = {
  model: "claude-sonnet-4-5",
  allowedTools: [
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Glob",
    "Grep",
    "MultiEdit",
  ],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append:
      "You are a background coding agent. Complete the task autonomously without asking for clarification.",
  },
};

/**
 * Run the Claude agent with streaming. Returns the Query async generator.
 *
 * @param prompt  The user's task description
 * @param cwd    Working directory for the agent (defaults to process.cwd())
 */
export function runAgent(prompt: string, cwd?: string) {
  const stderrChunks: string[] = [];
  const q = getQuery()({
    prompt,
    options: {
      ...DEFAULT_OPTIONS,
      cwd: cwd ?? process.env.AGENT_CWD ?? process.cwd(),
      includePartialMessages: true,
      debug: true,
      stderr: (data: string) => {
        console.error("[agent-sdk]", data);
        stderrChunks.push(data);
      },
    },
  });
  // Expose stderr for error reporting
  (q as any)._stderrChunks = stderrChunks;
  return q;
}
