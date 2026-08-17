import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const insertActivity = db.prepare(
  `INSERT INTO activity_log (id, type, entityId, entityName, fromStage, toStage, role, createdAt)
   VALUES (@id, @type, @entityId, @entityName, @fromStage, @toStage, @role, @createdAt)`
);

// records a lead/warranty-request stage move for the owner's activity log
export function logMove({ type, entityId, entityName, fromStage, toStage, role }) {
  insertActivity.run({
    id: randomUUID(),
    type,
    entityId,
    entityName,
    fromStage: fromStage || null,
    toStage,
    role,
    createdAt: new Date().toISOString(),
  });
}

const insertAccess = db.prepare(`INSERT INTO access_log (id, role, createdAt) VALUES (?, ?, ?)`);
const lastAccessForRole = db.prepare(
  `SELECT createdAt FROM access_log WHERE role = ? ORDER BY createdAt DESC LIMIT 1`
);

// throttle window so a single app open (which can trigger more than one
// authenticated request in quick succession) doesn't log several rows
const ACCESS_LOG_THROTTLE_MS = 60 * 1000;

// records the viewer (project manager) opening the app — throttled so a
// burst of requests from one app-open only produces one row
export function logAccess(role) {
  const last = lastAccessForRole.get(role);
  if (last && Date.now() - new Date(last.createdAt).getTime() < ACCESS_LOG_THROTTLE_MS) return;
  insertAccess.run(randomUUID(), role, new Date().toISOString());
}
