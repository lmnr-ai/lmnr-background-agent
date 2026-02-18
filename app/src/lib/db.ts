import "server-only";

import Database from "better-sqlite3";
import type { AgentMessage } from "./types";

export type DbChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; messages: AgentMessage[] };

const DB_PATH = process.env.DB_PATH || "/tmp/chat.db";

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
  }
  return _db;
}

export function saveUserMessage(text: string): number {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO messages (role, content) VALUES (?, ?)")
    .run("user", text);
  return Number(result.lastInsertRowid);
}

export function saveAssistantMessage(messages: AgentMessage[]): number {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO messages (role, content) VALUES (?, ?)")
    .run("assistant", JSON.stringify(messages));
  return Number(result.lastInsertRowid);
}

export function getAllMessages(): DbChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT role, content FROM messages ORDER BY id ASC")
    .all() as { role: string; content: string }[];

  return rows.map((row) => {
    if (row.role === "user") {
      return { role: "user" as const, text: row.content };
    }
    return {
      role: "assistant" as const,
      messages: JSON.parse(row.content) as AgentMessage[],
    };
  });
}
