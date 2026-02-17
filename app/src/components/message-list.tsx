"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/use-agent";
import { UserMessage, AssistantMessage } from "./message";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
        Send a message to start the coding agent.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {messages.map((msg, i) =>
        msg.role === "user" ? (
          <UserMessage key={i} text={msg.text} />
        ) : (
          <AssistantMessage key={i} messages={msg.messages} />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}
