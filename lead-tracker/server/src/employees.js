import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { db } from "./db.js";

export const MIN_PASSCODE_LENGTH = 6;

export function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(passcode), salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function passcodeMatches(passcode, stored) {
  const [scheme, saltHex, hashHex] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(passcode), Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

function sameText(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function publicEmployee(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, hourlyRate: row.hourlyRate, active: !!row.active, createdAt: row.createdAt };
}

export function getEmployee(id) {
  return db.prepare(`SELECT * FROM employees WHERE id = ?`).get(id) || null;
}

export function getActiveEmployee(id) {
  return db.prepare(`SELECT * FROM employees WHERE id = ? AND active = 1`).get(id) || null;
}

export function listEmployees() {
  return db.prepare(`SELECT * FROM employees ORDER BY active DESC, name COLLATE NOCASE`).all().map(publicEmployee);
}

// the login screen takes one passcode and works out who it belongs to, so
// every employee passcode has to be different from each other and from the
// two shared owner/viewer passcodes
export function findEmployeeByPasscode(passcode) {
  const rows = db.prepare(`SELECT * FROM employees WHERE active = 1`).all();
  for (const row of rows) {
    if (passcodeMatches(passcode, row.passcodeHash)) return row;
  }
  return null;
}

export function passcodeProblem(passcode, { exceptEmployeeId } = {}) {
  const p = String(passcode || "");
  if (p.length < MIN_PASSCODE_LENGTH) return `Passcode needs at least ${MIN_PASSCODE_LENGTH} characters`;
  if (process.env.OWNER_PASSCODE && sameText(p, process.env.OWNER_PASSCODE)) return "Pick a different passcode";
  if (process.env.VIEWER_PASSCODE && sameText(p, process.env.VIEWER_PASSCODE)) return "Pick a different passcode";
  const rows = db.prepare(`SELECT id, passcodeHash FROM employees`).all();
  if (rows.some((r) => r.id !== exceptEmployeeId && passcodeMatches(p, r.passcodeHash))) {
    return "Another employee already uses that passcode";
  }
  return null;
}

export function createEmployee({ name, passcode, hourlyRate }) {
  const row = {
    id: randomUUID(),
    name,
    passcodeHash: hashPasscode(passcode),
    hourlyRate,
    active: 1,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO employees (id, name, passcodeHash, hourlyRate, active, createdAt)
     VALUES (@id, @name, @passcodeHash, @hourlyRate, @active, @createdAt)`
  ).run(row);
  return publicEmployee(row);
}
