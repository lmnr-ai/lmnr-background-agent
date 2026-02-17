"use client";

import { useState } from "react";
import type { AgentToolCallMessage, AgentToolResultMessage } from "@/lib/types";

export function ToolCall({
  toolCall,
  toolResult,
}: {
  toolCall: AgentToolCallMessage;
  toolResult?: AgentToolResultMessage;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <span
          className={`transition-transform text-xs ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
          {toolCall.toolName}
        </span>
        {toolResult && (
          <span className="ml-auto text-xs text-green-600 dark:text-green-400">
            done
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-3 py-2 space-y-2">
          {toolCall.input && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                Input
              </p>
              <pre className="whitespace-pre-wrap break-all text-xs bg-zinc-50 dark:bg-zinc-900 p-2 rounded font-mono">
                {toolCall.input}
              </pre>
            </div>
          )}
          {toolResult && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
                Output
              </p>
              <pre className="whitespace-pre-wrap break-all text-xs bg-zinc-50 dark:bg-zinc-900 p-2 rounded font-mono max-h-64 overflow-y-auto">
                {toolResult.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
