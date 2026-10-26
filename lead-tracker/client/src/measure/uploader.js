// Drains the offline photo queue to the server, one photo at a time, oldest
// first. Runs whenever something is queued, when the phone comes back
// online, and on a slow timer as a backstop. Each photo carries an id made
// on the phone, so a retry of an upload that actually landed (the response
// was what got lost) is recognized by the server rather than saved twice.
import { offlineStore } from "./offlineStore.js";
import { measureApi } from "./measureApi.js";

const BACKOFF_MS = [5000, 15000, 60000, 5 * 60000];
const listeners = new Set();
let running = false;
let timer = null;
let blocked = null; // e.g. "signed-out" — stop hammering until that changes

function notify(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // a listener's problem isn't the queue's
    }
  }
}

export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isNetworkError(err) {
  return !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
}

export async function kickUploads() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      const now = Date.now();
      const items = (await offlineStore.allQueued())
        .filter((i) => i.status !== "failed" && (i.nextAttemptAt || 0) <= now)
        .sort((a, b) => a.createdAt - b.createdAt);
      const item = items[0];
      if (!item) break;
      try {
        notify({ type: "uploading", clientId: item.clientId, leadId: item.leadId });
        const payload = await measureApi.uploadPhoto(item.leadId, item);
        await offlineStore.deleteQueued(item.clientId);
        await offlineStore.putProject(item.leadId, payload);
        blocked = null;
        notify({ type: "uploaded", clientId: item.clientId, leadId: item.leadId, payload });
      } catch (err) {
        if (err.duplicate) {
          // the same photo is already on this house — drop the copy
          await offlineStore.deleteQueued(item.clientId);
          notify({ type: "duplicate", clientId: item.clientId, leadId: item.leadId });
          continue;
        }
        if (err.status === 401) {
          blocked = "signed-out";
          notify({ type: "blocked", reason: blocked });
          break;
        }
        const attempts = (item.attempts || 0) + 1;
        const retryable = isNetworkError(err);
        await offlineStore.putQueued({
          ...item,
          attempts,
          lastError: err.message,
          status: retryable ? "pending" : "failed",
          nextAttemptAt: Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
        });
        notify({ type: "error", clientId: item.clientId, leadId: item.leadId, error: err.message, retryable });
        if (retryable) break; // connection's down — the rest would fail too
      }
    }
  } finally {
    running = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(kickUploads, 30000);
}

export function queueStatus() {
  return blocked;
}

// a photo the server refused (not a connection problem) — try it once more
// on request, or throw it away
export async function retryFailed(clientId) {
  const item = await offlineStore.getQueued(clientId);
  if (!item) return;
  await offlineStore.putQueued({ ...item, status: "pending", nextAttemptAt: 0 });
  notify({ type: "queued", clientId, leadId: item.leadId });
  kickUploads();
}

export async function discardQueued(clientId) {
  const item = await offlineStore.getQueued(clientId);
  await offlineStore.deleteQueued(clientId);
  notify({ type: "discarded", clientId, leadId: item?.leadId });
}

export async function enqueuePhoto(item) {
  await offlineStore.putQueued({ ...item, status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: Date.now() });
  notify({ type: "queued", clientId: item.clientId, leadId: item.leadId });
  kickUploads();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    blocked = null;
    kickUploads();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kickUploads();
  });
}
