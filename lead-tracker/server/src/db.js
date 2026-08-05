import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "leads.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stage TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    startDate TEXT,
    revenue REAL,
    wonAt TEXT,
    paidAt TEXT,
    source TEXT,
    sourceOther TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT
  );
`);
