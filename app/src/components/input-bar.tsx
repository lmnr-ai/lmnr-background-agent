"use client";

import { useRef, type FormEvent } from "react";

export function InputBar({
  onSend,
  isLoading,
  onAbort,
}: {
  onSend: (prompt: string) => void;
  isLoading: boolean;
  onAbort: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (!value || isLoading) return;
    onSend(value);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3"
    >
      <textarea
        ref={inputRef}
        rows={1}
        placeholder="Describe a coding task..."
        className="flex-1 resize-none rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:focus:border-zinc-400"
        onKeyDown={handleKeyDown}
        disabled={isLoading}
      />
      {isLoading ? (
        <button
          type="button"
          onClick={onAbort}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
        >
          Send
        </button>
      )}
    </form>
  );
}
