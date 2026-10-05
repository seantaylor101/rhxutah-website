// The list of material suppliers offered when marking a sub/PM's materials
// ordered — starts with these defaults but can grow permanently (see
// addMaterialSupplier) as new suppliers get used on real jobs, stored in the
// settings table rather than hardcoded so every future job sees the update.
import { db } from "./db.js";

export const DEFAULT_MATERIAL_SUPPLIERS = [
  "Lansing Sandy",
  "Lansing PG",
  "Alside Orem",
  "Alside West Jordan",
  "Timberline Exteriors",
  "LKL West Jordan",
  "LKL Spanish Fork",
];

export function getMaterialSuppliers() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'materialSuppliers'`).get();
  if (!row) return DEFAULT_MATERIAL_SUPPLIERS;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_MATERIAL_SUPPLIERS;
  } catch {
    return DEFAULT_MATERIAL_SUPPLIERS;
  }
}

export function addMaterialSupplier(name) {
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, error: "Supplier name is required" };
  if (clean.length > 80) return { ok: false, error: "Supplier name is too long" };
  const current = getMaterialSuppliers();
  const exists = current.some((s) => s.toLowerCase() === clean.toLowerCase());
  const next = exists ? current : [...current, clean];
  if (!exists) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('materialSuppliers', @value)
       ON CONFLICT(key) DO UPDATE SET value = @value`
    ).run({ value: JSON.stringify(next) });
  }
  return { ok: true, value: next };
}
