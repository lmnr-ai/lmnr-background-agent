import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { createMessageTransformer, encodeNdjsonLine } from "@/lib/stream";
import { saveUserMessage, saveAssistantMessage } from "@/lib/db";
import type { AgentMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min edge function timeout

export async function POST(req: NextRequest) {
  const body = await req.json();
  const prompt: string | undefined = body.prompt;
  const cwd: string | undefined = body.cwd;

  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid `prompt` field" },
      { status: 400 },
    );
  }

  saveUserMessage(prompt);

  const { query: agentQuery, stderrChunks } = runAgent(prompt, cwd);
  const transformSdkMessage = createMessageTransformer();
  const collectedMessages: AgentMessage[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const sdkMsg of agentQuery) {
          const messages = transformSdkMessage(sdkMsg);
          for (const msg of messages) {
            collectedMessages.push(msg);
            controller.enqueue(encodeNdjsonLine(msg));
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const stderr = stderrChunks.join("");
        const fullError = stderr ? `${errorMsg}\n\nstderr:\n${stderr}` : errorMsg;
        const errorMessage: AgentMessage = { type: "error", error: fullError };
        collectedMessages.push(errorMessage);
        controller.enqueue(encodeNdjsonLine(errorMessage));
      } finally {
        try {
          saveAssistantMessage(collectedMessages);
        } catch (e) {
          console.error("Failed to save assistant message:", e);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
