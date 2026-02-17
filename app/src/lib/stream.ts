import "server-only";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "./types";

/**
 * Transform an SDK message into zero or more AgentMessage objects
 * suitable for sending to the client over NDJSON.
 */
export function transformSdkMessage(msg: SDKMessage): AgentMessage[] {
  const out: AgentMessage[] = [];

  switch (msg.type) {
    case "assistant": {
      // Skip: when includePartialMessages is enabled the SDK emits
      // stream_event deltas first, then the complete assistant message.
      // We already forwarded the deltas so emitting the full message
      // again would duplicate every response in the UI.
      break;
    }

    case "stream_event": {
      const event = msg.event;
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          out.push({ type: "text", text: event.delta.text });
        }
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          out.push({
            type: "tool_call",
            toolName: event.content_block.name,
            toolUseId: event.content_block.id,
            input: "",
          });
        }
      }
      break;
    }

    case "result": {
      if (msg.subtype === "success") {
        out.push({
          type: "result",
          subtype: msg.subtype,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
        });
      } else {
        out.push({
          type: "error",
          error: `Agent ended with: ${msg.subtype}`,
        });
      }
      break;
    }

    default:
      break;
  }

  return out;
}

/**
 * Encode an AgentMessage as an NDJSON line (UTF-8 bytes).
 */
export function encodeNdjsonLine(msg: AgentMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg) + "\n");
}
