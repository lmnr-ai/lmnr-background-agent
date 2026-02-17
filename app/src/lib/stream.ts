import "server-only";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "./types";

/**
 * Stateful transformer that converts SDK messages into AgentMessage objects.
 * Tracks in-progress tool calls to accumulate streamed JSON input.
 */
export function createMessageTransformer() {
  const pendingInputs = new Map<string, string>();

  return function transformSdkMessage(msg: SDKMessage): AgentMessage[] {
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
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            pendingInputs.set(event.content_block.id, "");
            out.push({
              type: "tool_call",
              toolName: event.content_block.name,
              toolUseId: event.content_block.id,
              input: "",
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            out.push({ type: "text", text: event.delta.text });
          } else if (event.delta.type === "input_json_delta") {
            // Accumulate tool input JSON as it streams in
            const blockIdx = event.index;
            for (const [id, prev] of pendingInputs) {
              pendingInputs.set(id, prev + event.delta.partial_json);
            }
          }
        } else if (event.type === "content_block_stop") {
          // Emit the completed tool input
          for (const [id, input] of pendingInputs) {
            if (input) {
              out.push({
                type: "tool_call",
                toolName: "",
                toolUseId: id,
                input,
              });
            }
          }
        }
        break;
      }

      case "user": {
        // Tool results come back as user messages with tool_use_result
        if (msg.tool_use_result && msg.parent_tool_use_id) {
          out.push({
            type: "tool_result",
            toolUseId: msg.parent_tool_use_id,
            output:
              typeof msg.tool_use_result === "string"
                ? msg.tool_use_result
                : JSON.stringify(msg.tool_use_result, null, 2),
          });
          pendingInputs.delete(msg.parent_tool_use_id);
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
  };
}

/**
 * Encode an AgentMessage as an NDJSON line (UTF-8 bytes).
 */
export function encodeNdjsonLine(msg: AgentMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg) + "\n");
}
