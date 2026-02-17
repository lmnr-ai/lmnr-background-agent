"use client";

import { useAgent } from "@/hooks/use-agent";
import { MessageList } from "./message-list";
import { InputBar } from "./input-bar";

export function Chat() {
  const { chatMessages, sendMessage, isLoading, abort } = useAgent();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-4 py-3">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Background Agent
        </h1>
        {isLoading && (
          <span className="text-xs text-zinc-400 animate-pulse">
            Agent working...
          </span>
        )}
      </header>
      <MessageList messages={chatMessages} />
      <InputBar onSend={sendMessage} isLoading={isLoading} onAbort={abort} />
    </div>
  );
}
