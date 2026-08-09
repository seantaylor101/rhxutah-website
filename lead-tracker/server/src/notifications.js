import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export function createNotification({ leadId, title, body }) {
  const notification = {
    id: randomUUID(),
    leadId: leadId || null,
    title,
    body,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  db.prepare(
    `INSERT INTO notifications (id, leadId, title, body, createdAt, readAt)
     VALUES (@id, @leadId, @title, @body, @createdAt, @readAt)`
  ).run(notification);
  return notification;
}
