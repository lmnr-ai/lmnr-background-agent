"use client";

import type { AgentMessage } from "@/lib/types";
import { ToolCall } from "./tool-call";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2.5 text-sm text-white dark:text-zinc-900 whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

export function AssistantMessage({ messages }: { messages: AgentMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
        Thinking...
      </div>
    );
  }

  // Group consecutive text messages and pair tool_call / tool_result
  const elements: React.ReactNode[] = [];
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      elements.push(
        <p
          key={`text-${elements.length}`}
          className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed"
        >
          {textBuffer}
        </p>,
      );
      textBuffer = "";
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    switch (msg.type) {
      case "text":
        textBuffer += msg.text;
        break;

      case "tool_call": {
        flushText();
        // Find matching result
        const result = messages.find(
          (m) => m.type === "tool_result" && m.toolUseId === msg.toolUseId,
        );
        elements.push(
          <ToolCall
            key={`tool-${msg.toolUseId}-${i}`}
            toolCall={msg}
            toolResult={result?.type === "tool_result" ? result : undefined}
          />,
        );
        break;
      }

      case "tool_result":
        // Already handled above alongside tool_call
        break;

      case "error":
        flushText();
        elements.push(
          <div
            key={`err-${i}`}
            className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {msg.error}
          </div>,
        );
        break;

      case "result":
        flushText();
        elements.push(
          <div
            key={`result-${i}`}
            className="text-xs text-zinc-400 dark:text-zinc-500 pt-1"
          >
            Completed in {(msg.durationMs / 1000).toFixed(1)}s &middot; $
            {msg.costUsd.toFixed(4)}
          </div>,
        );
        break;

      case "status":
        break;
    }
  }

  flushText();

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">{elements}</div>
    </div>
  );
}
