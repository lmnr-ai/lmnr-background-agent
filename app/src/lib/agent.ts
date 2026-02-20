import "server-only";

import {
  createSdkMcpServer,
  query as origQuery,
  tool,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { Laminar } from "@lmnr-ai/lmnr";
import { readFile } from "fs/promises";
import { z } from "zod/v4";
import { SYSTEM_PROMPT } from "./system-prompt";

const query = Laminar.wrapClaudeAgentQuery(origQuery);

const screenshots = createSdkMcpServer({
  name: "screenshots",
  tools: [
    tool(
      "upload_screenshot",
      "Upload a screenshot image to GitHub. Returns a URL that can be embedded in PR descriptions and markdown.",
      {
        filePath: z.string().describe("Absolute path to the image file"),
        repository: z
          .string()
          .describe("GitHub repository in owner/repo format, e.g. lmnr-ai/lmnr"),
      },
      async ({ filePath, repository }) => {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return {
            content: [
              { type: "text" as const, text: "Missing GITHUB_TOKEN env var" },
            ],
            isError: true,
          };
        }

        const fileBuffer = await readFile(filePath);
        const resp = await fetch(
          `https://uploads.github.com/repos/${repository}/issues/assets`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "image/png",
            },
            body: fileBuffer,
          },
        );

        if (!resp.ok) {
          const body = await resp.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Upload failed (${resp.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await resp.json()) as { url: string };
        return {
          content: [{ type: "text" as const, text: data.url }],
        };
      },
    ),
  ],
});

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
    "mcp__screenshots__*",
  ],
  mcpServers: {
    browser: {
      command: "npx",
      args: ["@playwright/mcp", "--browser", "chromium", "--no-sandbox"],
    },
    screenshots,
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
