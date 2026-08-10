import { db } from "./db.js";
import { sendBackupSnapshotEmail } from "./notifyEmail.js";

// reuses the settings key/value table rather than a dedicated column/table —
// this is a single global marker, not per-lead state
function getLastBackupEmailAt() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'lastBackupEmailAt'`).get();
  return row ? row.value : null;
}

function setLastBackupEmailAt(iso) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('lastBackupEmailAt', @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ value: iso });
}

function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// once-per-calendar-day off-site copy of the same snapshot already written to
// disk, so losing the Render disk itself doesn't mean losing everything
export async function maybeSendBackupEmail(snapshot) {
  const last = getLastBackupEmailAt();
  if (last && dayKey(last) === dayKey(snapshot.takenAt)) return;

  await sendBackupSnapshotEmail(snapshot);
  setLastBackupEmailAt(snapshot.takenAt);
}
