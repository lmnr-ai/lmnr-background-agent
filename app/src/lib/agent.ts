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

const supabaseStorage = createSdkMcpServer({
  name: "supabase-storage",
  tools: [
    tool(
      "upload_screenshot",
      "Upload a screenshot image file to Supabase Storage. Returns the public URL of the uploaded image.",
      { filePath: z.string(), name: z.string() },
      async ({ filePath, name }) => {
        const url = process.env.PUBLIC_SUPABASE_URL;
        const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
        if (!url || !key) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY env vars",
              },
            ],
            isError: true,
          };
        }

        const fileBuffer = await readFile(filePath);
        const resp = await fetch(
          `${url}/storage/v1/object/screenshots/${name}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
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

        const publicUrl = `${url}/storage/v1/object/public/screenshots/${name}`;
        return {
          content: [{ type: "text" as const, text: publicUrl }],
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
    "mcp__supabase-storage__*",
  ],
  mcpServers: {
    browser: {
      command: "npx",
      args: ["@playwright/mcp", "--browser", "chromium", "--no-sandbox"],
    },
    "supabase-storage": supabaseStorage,
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
