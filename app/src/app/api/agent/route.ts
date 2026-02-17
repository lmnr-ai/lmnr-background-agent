import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { transformSdkMessage, encodeNdjsonLine } from "@/lib/stream";

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

  const agentQuery = runAgent(prompt, cwd);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const sdkMsg of agentQuery) {
          const messages = transformSdkMessage(sdkMsg);
          for (const msg of messages) {
            controller.enqueue(encodeNdjsonLine(msg));
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encodeNdjsonLine({ type: "error", error: errorMsg }),
        );
      } finally {
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
