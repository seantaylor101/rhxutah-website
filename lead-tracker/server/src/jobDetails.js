import { randomUUID } from "node:crypto";

// Keep in sync with MATERIAL_SUPPLIERS / JOB_EQUIPMENT in client/src/App.jsx
export const MATERIAL_SUPPLIERS = [
  "Lansing Sandy",
  "Lansing PG",
  "Alside Orem",
  "Alside West Jordan",
  "Timberline Exteriors",
  "LKL West Jordan",
  "LKL Spanish Fork",
];

export const JOB_EQUIPMENT = {
  brake: "Brake and sawhorses",
  ladder32: "32' ladder",
  scaffoldPlanks: "Scaffold planks",
  miterSaw: "Miter saw and stand",
  hammerChisel: "Hammer chisel",
  shopVac: "Shop vac",
};

const SUPPLIER_SET = new Set(MATERIAL_SUPPLIERS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyMaterials() {
  return { ordered: false, supplier: "", availability: "", availableDate: "" };
}

export function emptyJobDetails() {
  return { instructions: "", materials: emptyMaterials(), pickups: [], equipment: [] };
}

// tolerant read of whatever's stored in the jobDetails column — missing or
// malformed JSON (e.g. every lead created before this column existed) just
// reads as an empty profile rather than erroring the whole leads list
export function parseJobDetails(raw) {
  const base = emptyJobDetails();
  if (!raw) return base;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  return {
    instructions: typeof parsed.instructions === "string" ? parsed.instructions : "",
    materials: { ...emptyMaterials(), ...(parsed.materials || {}) },
    pickups: Array.isArray(parsed.pickups) ? parsed.pickups : [],
    equipment: Array.isArray(parsed.equipment) ? parsed.equipment : [],
  };
}

function cleanMaterials(input) {
  if (!input || !input.ordered) return { ok: true, value: emptyMaterials() };
  const supplier = String(input.supplier || "");
  if (!SUPPLIER_SET.has(supplier)) return { ok: false, error: "Pick a supplier from the list" };
  const availability = input.availability === "date" ? "date" : "immediate";
  const availableDate = availability === "date" ? String(input.availableDate || "") : "";
  if (availability === "date" && !DATE_RE.test(availableDate)) {
    return { ok: false, error: "availableDate must be YYYY-MM-DD" };
  }
  return { ok: true, value: { ordered: true, supplier, availability, availableDate } };
}

function cleanPickups(items) {
  const out = [];
  for (const item of items) {
    const text = String(item?.text || "").trim();
    if (!text) continue;
    out.push({
      id: typeof item?.id === "string" && item.id ? item.id : randomUUID(),
      text,
      where: String(item?.where || "").trim(),
      done: !!item?.done,
    });
  }
  return out;
}

function cleanEquipment(keys) {
  return [...new Set(keys.filter((k) => typeof k === "string" && k in JOB_EQUIPMENT))];
}

// Merges a partial job-details patch onto what's stored. The owner can change
// anything; the project manager (viewer) can mark materials ordered, check
// equipment off, and tick pick-up items done — but can't rewrite the owner's
// instructions or add/remove/reword pick-up items, so a PM's check-off never
// clobbers what the owner wrote.
export function applyJobDetailsPatch(current, patch, role) {
  const next = {
    ...current,
    materials: { ...current.materials },
    pickups: current.pickups.map((p) => ({ ...p })),
    equipment: [...current.equipment],
  };
  const isOwner = role === "owner";

  if ("instructions" in patch) {
    if (!isOwner) return { ok: false, status: 403, error: "Editor access required to change instructions" };
    next.instructions = String(patch.instructions || "").trim();
  }

  if ("materials" in patch) {
    const res = cleanMaterials(patch.materials);
    if (!res.ok) return { ok: false, status: 400, error: res.error };
    next.materials = res.value;
  }

  if ("equipment" in patch) {
    if (!Array.isArray(patch.equipment)) return { ok: false, status: 400, error: "equipment must be an array" };
    next.equipment = cleanEquipment(patch.equipment);
  }

  if ("pickups" in patch) {
    if (!Array.isArray(patch.pickups)) return { ok: false, status: 400, error: "pickups must be an array" };
    if (isOwner) {
      next.pickups = cleanPickups(patch.pickups);
    } else {
      const doneById = new Map(patch.pickups.filter((p) => p && p.id).map((p) => [p.id, !!p.done]));
      next.pickups = next.pickups.map((p) => (doneById.has(p.id) ? { ...p, done: doneById.get(p.id) } : p));
    }
  }

  return { ok: true, value: next };
}
