// Estimate basics: the short set of questions answered on every lead before
// an estimate gets built, so the estimating questionnaire (and the JobTread
// estimate it drafts) never has to stop and ask for the basics. Shared by
// the server (validation, owner-only storage) and the client (the form).
//
// "required" questions are the ones the estimator can't start without; the
// rest are helpful but optional. Nothing here blocks logging a lead — the
// lead profile just shows what's still missing.

export const ESTIMATE_BASICS_QUESTIONS = [
  {
    key: "customerType",
    label: "Customer type",
    type: "single",
    required: true,
    options: [
      { key: "retail", label: "Retail homeowner" },
      { key: "gc", label: "General contractor" },
      { key: "insurance", label: "Insurance claim" },
    ],
  },
  {
    key: "homeownerName",
    label: "Homeowner name (if the lead isn't the homeowner)",
    type: "text",
    required: false,
    placeholder: "e.g. Beckie Price — for jobs from Erick or another GC",
  },
  {
    key: "trades",
    label: "Work needed",
    type: "multi",
    required: true,
    options: [
      { key: "siding", label: "Siding" },
      { key: "gutters", label: "Gutters" },
      { key: "soffitFascia", label: "Soffit & fascia" },
      { key: "stucco", label: "Stucco / stone" },
      { key: "painting", label: "Painting" },
      { key: "drainage", label: "Drainage" },
      { key: "lighting", label: "Permanent lighting" },
      { key: "repair", label: "Repair only" },
    ],
  },
  {
    key: "stories",
    label: "Stories",
    type: "single",
    required: true,
    options: [
      { key: "1", label: "1" },
      { key: "2", label: "2" },
      { key: "3", label: "3" },
      { key: "mixed", label: "Mixed" },
    ],
  },
  {
    key: "existingExterior",
    label: "Existing exterior",
    type: "multi",
    required: true,
    options: [
      { key: "vinyl", label: "Vinyl" },
      { key: "aluminum", label: "Aluminum" },
      { key: "wood", label: "Wood" },
      { key: "fiberCement", label: "Hardie / fiber cement" },
      { key: "lp", label: "LP SmartSide" },
      { key: "stucco", label: "Stucco" },
      { key: "brickStone", label: "Brick / stone" },
      { key: "newConstruction", label: "New construction" },
    ],
  },
  {
    key: "measurements",
    label: "Measurements",
    type: "single",
    required: true,
    options: [
      { key: "leadHammer", label: "Measured in Lead Hammer" },
      { key: "report", label: "Report (EagleView, Hover…)" },
      { key: "onSite", label: "Measuring on site" },
      { key: "notYet", label: "Not yet" },
    ],
  },
  {
    key: "timeline",
    label: "Timeline",
    type: "single",
    required: true,
    options: [
      { key: "asap", label: "ASAP" },
      { key: "1to3", label: "1–3 months" },
      { key: "later", label: "3+ months" },
      { key: "pricing", label: "Just pricing" },
    ],
  },
  {
    key: "hoa",
    label: "HOA approval needed",
    type: "single",
    required: false,
    options: [
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
      { key: "unsure", label: "Not sure" },
    ],
  },
  { key: "yearBuilt", label: "Year built (approx.)", type: "text", required: false, placeholder: "e.g. 1998" },
  {
    key: "budget",
    label: "Budget or financing",
    type: "text",
    required: false,
    placeholder: "e.g. around $15K, wants financing",
  },
  {
    key: "notes",
    label: "Anything else for the estimate",
    type: "text",
    multiline: true,
    required: false,
    placeholder: "Colors, problem areas, what the customer cares about…",
  },
];

const MAX_TEXT = 1000;

export function emptyEstimateBasics() {
  const out = {};
  for (const q of ESTIMATE_BASICS_QUESTIONS) out[q.key] = q.type === "multi" ? [] : "";
  return out;
}

// keeps only known questions and valid option keys, so whatever's stored is
// always safe to render and to hand to the estimator
export function cleanEstimateBasics(input) {
  const out = emptyEstimateBasics();
  if (!input || typeof input !== "object") return out;
  for (const q of ESTIMATE_BASICS_QUESTIONS) {
    const value = input[q.key];
    if (q.type === "multi") {
      const valid = new Set(q.options.map((o) => o.key));
      out[q.key] = Array.isArray(value) ? [...new Set(value.map(String))].filter((v) => valid.has(v)) : [];
    } else if (q.type === "single") {
      const v = value == null ? "" : String(value);
      out[q.key] = q.options.some((o) => o.key === v) ? v : "";
    } else {
      out[q.key] = value == null ? "" : String(value).trim().slice(0, MAX_TEXT);
    }
  }
  return out;
}

export function parseEstimateBasics(raw) {
  if (!raw) return emptyEstimateBasics();
  try {
    return cleanEstimateBasics(JSON.parse(raw));
  } catch {
    return emptyEstimateBasics();
  }
}

function isAnswered(q, value) {
  return q.type === "multi" ? Array.isArray(value) && value.length > 0 : !!String(value || "").trim();
}

// required questions still unanswered — an address counts too, since every
// estimate (and JobTread job) needs one, but it lives on the lead itself
export function missingEstimateBasics(basics, address) {
  const b = basics || emptyEstimateBasics();
  const missing = [];
  if (!String(address || "").trim()) missing.push({ key: "address", label: "Address" });
  for (const q of ESTIMATE_BASICS_QUESTIONS) {
    if (q.required && !isAnswered(q, b[q.key])) missing.push({ key: q.key, label: q.label });
  }
  return missing;
}

export const ESTIMATE_BASICS_REQUIRED_COUNT =
  ESTIMATE_BASICS_QUESTIONS.filter((q) => q.required).length + 1; // + address
