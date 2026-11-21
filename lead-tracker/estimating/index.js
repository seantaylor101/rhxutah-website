// Loads the estimating source of truth (pricing.json, jobtread.json,
// rules.md) and checks it, so a missing or mistyped rate fails loudly at
// startup instead of quietly pricing a job wrong. Server-side only (reads
// files); the client imports the JSON directly where it needs presets.

import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

export const PRICING = JSON.parse(read("pricing.json"));
export const JOBTREAD = JSON.parse(read("jobtread.json"));
export const RULES_TEXT = read("rules.md");
export const WORDING = JSON.parse(read("wording.json"));

const CUSTOMER_TYPES = ["retail", "gc", "insurance"];

// every path the estimator reads; a test runs this too
const REQUIRED = [
  "rounding.perUnitStep",
  "rounding.lumpStep",
  ...CUSTOMER_TYPES.map((t) => `tax.rateByCustomerType.${t}`),
  "waste.siding",
  ...CUSTOMER_TYPES.flatMap((t) => [`gutters.ratesPerFoot.${t}.5`, `gutters.ratesPerFoot.${t}.6`]),
  "gutters.minimum.minimumFeet",
  ...CUSTOMER_TYPES.map((t) => `gutters.minimum.floor.${t}`),
  "gutters.takeoff.feetPerMiter",
  "gutters.takeoff.downspoutFeetByStory.1",
  "gutters.takeoff.downspoutFeetByStory.2",
  "gutters.takeoff.downspoutFeetByStory.3",
  "gutters.takeoff.feetPerOffset",
  "gutterGuards.ratesPerFoot.5",
  "gutterGuards.ratesPerFoot.6",
  "gutterGuards.difficultAccess.pricePerFoot",
  "gutterGuards.difficultAccess.costPerFoot",
  "gutterRepairs.corrugatedExtension.laborAdd",
  "drainage.standardEach",
  "drainage.highCapacityEach",
  "drainage.extraPipeSection",
  "drainage.extraPerFoot",
  ...["lp", "hardie", "ascend", "vinyl", "vinylShake"].flatMap((p) => CUSTOMER_TYPES.map((t) => `siding.ratesPerSF.${p}.${t}`)),
  ...["batten", "shake"].flatMap((s) => CUSTOMER_TYPES.map((t) => `siding.styleRatesPerSF.${s}.${t}`)),
  ...CUSTOMER_TYPES.map((t) => `siding.dumpster.price.${t}`),
  "siding.dumpster.cost",
  ...CUSTOMER_TYPES.map((t) => `soffitFascia.bothPerFoot.${t}`),
  ...CUSTOMER_TYPES.map((t) => `soffitFascia.porchCapPerSF.${t}`),
  ...CUSTOMER_TYPES.map((t) => `stucco.fullPerSF.${t}`),
  "stucco.repairMinimum.price",
  "stucco.popoutPerWindow",
  "siding.tearOffPerSF.vinyl",
  "siding.tearOffPerSF.wood",
  "siding.tearOffPerSF.stucco",
  "siding.resheathPerSF.price",
  "siding.metalWrapEach",
  "siding.insulatedWrapUpgradePerSF.price",
  "stucco.foundationPlasterPerFoot",
  "stucco.gutterWall.cutBack",
  "stucco.gutterWall.stuccoRepair",
  "painting.wallPerSF",
  "painting.eavePerFoot",
  "painting.garageDoorEach",
  "painting.manDoorEach",
  "painting.minimum",
  "lighting.perFoot",
  "lighting.controller",
];

const REQUIRED_JT = [
  "organizationId",
  "costTypes.other",
  "costTypes.labor",
  "costTypes.materials",
  "units.each",
  "units.lf",
  "units.lump",
  "units.sf",
  "proposalTemplateId",
  "proposal.type",
  "proposal.name",
  "proposal.fromName",
  "proposal.fromOrganizationName",
  "proposal.fromAddress",
  "proposal.fromEmailAddress",
  "proposal.fromPhoneNumber",
  "proposal.dueDays",
  "sending.statusAfterSend",
  ...["gutters", "gutterGuards", "drainage", "soffitFascia", "siding_lp", "siding_hardie", "siding_ascend", "siding_vinyl", "sidingPrep", "stucco", "lighting"].map((k) => `costCodes.${k}`),
];

export function get(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function validate(pricing = PRICING, jobtread = JOBTREAD) {
  const problems = [];
  for (const p of REQUIRED) if (typeof get(pricing, p) !== "number") problems.push(`pricing.json: ${p} must be a number`);
  for (const p of REQUIRED_JT) if (get(jobtread, p) == null || get(jobtread, p) === "") problems.push(`jobtread.json: ${p} is missing`);
  return problems;
}

const problems = validate();
if (problems.length) throw new Error(`Estimating data is incomplete:\n${problems.join("\n")}`);

// --- helpers every builder uses ---

const roundTo = (v, step) => Math.round(Math.round(Number(v || 0) / step) * step * 100) / 100;

// per LF / SF / square → nearest quarter; each / lump sum → nearest $5
export function roundUnitPrice(v) {
  return roundTo(v, PRICING.rounding.perUnitStep);
}
export function roundLumpPrice(v) {
  return roundTo(v, PRICING.rounding.lumpStep);
}
export function roundPriceFor(unitKey, v) {
  return unitKey === "each" || unitKey === "lump" ? roundLumpPrice(v) : roundUnitPrice(v);
}

export function customerTypeOf(basics) {
  const t = basics?.customerType;
  return CUSTOMER_TYPES.includes(t) ? t : "retail";
}

// a rate table keyed by customer type
export function byType(table, basics) {
  return table[customerTypeOf(basics)] ?? table.retail;
}

export function taxRateFor(basics) {
  return byType(PRICING.tax.rateByCustomerType, basics);
}
