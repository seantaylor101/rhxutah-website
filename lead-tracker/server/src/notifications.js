import { randomUUID } from "node:crypto";
import { db } from "./db.js";

// role is who this alert is for ("owner" or "viewer") — every call site
// should pass one explicitly so the Alerts panel can scope what each role
// sees instead of showing every notification to whoever opens it
export function createNotification({ leadId, title, body, role }) {
  const notification = {
    id: randomUUID(),
    leadId: leadId || null,
    title,
    body,
    role: role || null,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  db.prepare(
    `INSERT INTO notifications (id, leadId, title, body, role, createdAt, readAt)
     VALUES (@id, @leadId, @title, @body, @role, @createdAt, @readAt)`
  ).run(notification);
  return notification;
}
