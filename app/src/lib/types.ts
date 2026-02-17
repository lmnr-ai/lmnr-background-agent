/** Shared types for agent messages exchanged between API route and client. */

export type AgentTextMessage = {
  type: "text";
  text: string;
};

export type AgentToolCallMessage = {
  type: "tool_call";
  toolName: string;
  toolUseId: string;
  input: string;
};

export type AgentToolResultMessage = {
  type: "tool_result";
  toolUseId: string;
  output: string;
};

export type AgentErrorMessage = {
  type: "error";
  error: string;
};

export type AgentResultMessage = {
  type: "result";
  subtype: string;
  costUsd: number;
  durationMs: number;
};

export type AgentStatusMessage = {
  type: "status";
  status: string;
};

/** Union of all message shapes streamed from the API to the client. */
export type AgentMessage =
  | AgentTextMessage
  | AgentToolCallMessage
  | AgentToolResultMessage
  | AgentErrorMessage
  | AgentResultMessage
  | AgentStatusMessage;
