"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@/lib/types";

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; messages: AgentMessage[] };

export function useAgent() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/messages")
      .then((res) => res.json())
      .then((data: ChatMessage[]) => setChatMessages(data))
      .catch(console.error);
  }, []);

  const sendMessage = useCallback(async (prompt: string) => {
    setChatMessages((prev) => [...prev, { role: "user", text: prompt }]);
    setIsLoading(true);

    // Placeholder for the assistant reply – we accumulate into it
    const assistantMessages: AgentMessage[] = [];
    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", messages: assistantMessages },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.text();
        assistantMessages.push({ type: "error", error: err });
        setChatMessages((prev) => [...prev.slice(0, -1), { role: "assistant", messages: [...assistantMessages] }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg: AgentMessage = JSON.parse(line);
            assistantMessages.push(msg);
            // Trigger re-render with updated messages array
            setChatMessages((prev) => [
              ...prev.slice(0, -1),
              { role: "assistant", messages: [...assistantMessages] },
            ]);
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        assistantMessages.push({
          type: "error",
          error: (err as Error).message ?? "Unknown error",
        });
        setChatMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", messages: [...assistantMessages] },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { chatMessages, sendMessage, isLoading, abort };
}
