// Trade questionnaire: the questions asked after Start Estimate, one set per
// trade picked in the estimate basics. Each answer maps to a parameter on the
// JobTread job, which the catalog assembly's quantity formulas read — so the
// numbers can still be adjusted in JobTread afterwards and everything reprices.
//
// Blank answers count as zero (or the default noted in the label); only
// what's truly needed to price the job is required.
//
// Automated so far: gutters, stucco, and siding in LP SmartSide, James
// Hardie, Alside Ascend and vinyl. Other trades are added as their JobTread
// assemblies are built.

export const TRADE_QUESTIONS = {
  gutters: {
    label: "Gutters",
    questions: [
      // new gutters are optional: a repairs/guards-only job (like Scott
      // Peterson's) has no new gutter footage
      {
        key: "gutterLF",
        label: "New gutter footage (LF; blank for repairs/guards only)",
        type: "number",
        required: (a) => !(a?.repairs?.length || a?.guardOptions?.length),
        param: "Gutter LF",
      },
      { key: "color", label: "Gutter color (e.g. Dark Bronze)", type: "text", required: false },
      {
        key: "size",
        label: "Gutter size (blank = 5\")",
        type: "single",
        required: false,
        options: [
          { key: "5", label: '5" (2x3 downspouts)' },
          { key: "6", label: '6" (3x4 downspouts)' },
        ],
      },
      { key: "oneStory", label: "1-story downspouts", type: "number", required: false, param: "One Story Downspouts" },
      { key: "twoStory", label: "2-story downspouts", type: "number", required: false, param: "Two Story Downspouts" },
      { key: "threeStory", label: "3-story downspouts", type: "number", required: false, param: "Three Story Downspouts" },
      { key: "offsets", label: "Downspout offsets (brick, etc.)", type: "number", required: false, param: "Downspout Offsets" },
      { key: "miters", label: "Box miters (corners; each counts as 3 ft)", type: "number", required: false, param: "Miters" },
      {
        key: "tearOffLF",
        label: "Old gutter to tear off (LF)",
        type: "number",
        required: false,
        param: "Gutter Tear-off LF",
      },
      {
        key: "trees",
        label: "Trees near the gutters? (blank = no)",
        type: "single",
        required: false,
        options: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No" },
        ],
      },
      {
        key: "roofDrainDownspouts",
        label: "Downspouts that drain onto a roof (no drain needed)",
        type: "number",
        required: false,
      },
      {
        key: "difficultAccessLF",
        label: "Guard footage with difficult access (tree cover, grade drop, 2nd story)",
        type: "number",
        required: false,
        upgrade: "guards",
      },
      // repair / odd-job lines, priced per job from the presets in
      // estimating/pricing.json (gutterRepairs); never lifetime warranty
      { key: "repairs", label: "Repairs & odd jobs", type: "repairs", required: false },
      // good/better/best gutter guard options, each with its footage and the
      // reason (what was found on site); one is marked recommended
      { key: "guardOptions", label: "Gutter guard options", type: "guardOptions", required: false },
      // the upgrade options — only asked when that upgrade is offered
      {
        key: "drains",
        label: "In-ground drains (blank = one per downspout that reaches the ground; 0 = don't offer)",
        type: "number",
        required: false,
        param: "In-Ground Drains",
        upgrade: "drains",
      },
      {
        key: "drainsPast8",
        label: "Drains running past 8 ft (only if you know)",
        type: "number",
        required: false,
        param: "Drain Extra Pipe Sections",
        upgrade: "drains",
      },
      {
        key: "drainExtraLF",
        label: "Total extra feet past 8 ft (only if you know)",
        type: "number",
        required: false,
        param: "Drain Extra LF",
        upgrade: "drains",
      },
      {
        key: "lightingLF",
        label: "Permanent lighting footage (for the upgrade option; blank = gutter footage)",
        type: "number",
        required: false,
        param: "Lighting LF",
        upgrade: "lighting",
      },
    ],
  },
  siding: {
    label: "Siding",
    questions: [
      {
        key: "product",
        label: "Siding product",
        type: "single",
        required: true,
        options: [
          { key: "lp", label: "LP SmartSide" },
          { key: "hardie", label: "James Hardie" },
          { key: "ascend", label: "Ascend" },
          { key: "vinyl", label: "Vinyl" },
          // the whole wall in Foundry 7" Staggered Shake; for lap with some
          // shake (gables etc.), pick Vinyl and fill in the shake area
          { key: "vinylShake", label: "Vinyl shake (Foundry)" },
        ],
      },
      {
        key: "wallSF",
        label: "Wall area (sq ft, no window deductions; 10% is added)",
        type: "number",
        required: true,
        param: "Wall SF",
      },
      // part of the wall area; priced higher than lap (batten: LP and Hardie
      // only; shake: LP, Hardie and vinyl)
      {
        key: "battenSF",
        label: "Board-and-batten area (sq ft, part of the wall area)",
        type: "number",
        required: false,
        products: ["lp", "hardie"],
      },
      {
        key: "shakeSF",
        label: "Shake area (sq ft, part of the wall area)",
        type: "number",
        required: false,
        // vinyl shake is Foundry 7" Staggered Shake (installed like vinyl lap)
        products: ["lp", "hardie", "vinyl"],
      },
      {
        key: "tearOff",
        label: "What comes off (blank = from the existing exterior)",
        type: "single",
        required: false,
        options: [
          { key: "none", label: "Nothing" },
          { key: "vinyl", label: "Vinyl / aluminum" },
          { key: "wood", label: "Wood / difficult" },
          { key: "stucco", label: "Stucco" },
        ],
      },
      { key: "tearOffSF", label: "Tear-off area (sq ft, blank = wall area)", type: "number", required: false },
      { key: "resheathSF", label: "Resheathing (sq ft, only if needed)", type: "number", required: false, param: "Resheathing SF" },
      { key: "dumpsters", label: "Dumpsters (blank = 1)", type: "number", required: false },
      {
        key: "metalWraps",
        label: "Metal wraps (windows, man doors, garage doors)",
        type: "number",
        required: false,
        param: "Metal Wraps",
        products: ["vinyl", "vinylShake"],
      },
    ],
  },
  stucco: {
    label: "Stucco",
    questions: [
      {
        key: "jobType",
        label: "Stucco job (leave blank if it's only the items below)",
        type: "single",
        required: false,
        options: [
          { key: "full", label: "Full stucco job" },
          { key: "repair", label: "Repair" },
        ],
      },
      {
        key: "stuccoSF",
        label: "Wall area (sq ft; 10% is added)",
        type: "number",
        required: (a) => a?.jobType === "full",
        showIf: (a) => a?.jobType === "full",
        param: "Stucco SF",
      },
      {
        key: "popouts",
        label: "Popout windows to cut back",
        type: "number",
        required: false,
        showIf: (a) => a?.jobType === "repair",
        param: "Popout Windows",
      },
      {
        key: "otherRepairs",
        label: "Other stucco repairs (cracks, patches, damage)? (blank = yes)",
        type: "single",
        required: false,
        showIf: (a) => a?.jobType === "repair",
        options: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No, popouts only" },
        ],
      },
      {
        key: "gutterWallSpots",
        label: "Spots where a gutter is butted against the stucco wall",
        type: "number",
        required: false,
        param: "Gutter Wall Spots",
      },
      { key: "foundationLF", label: "Foundation plaster (linear ft)", type: "number", required: false, param: "Foundation Plaster LF" },
    ],
  },
  // aluminum only. Footage is along the eaves/rakes; $25 retail / $22 GC per
  // foot for both, half that when only one is done
  soffitFascia: {
    label: "Soffit & fascia",
    questions: [
      { key: "bothLF", label: "Soffit AND fascia (linear ft)", type: "number", required: false },
      { key: "soffitOnlyLF", label: "Soffit only (linear ft)", type: "number", required: false },
      { key: "fasciaOnlyLF", label: "Fascia only (linear ft)", type: "number", required: false },
      { key: "overhangIn", label: "Overhang depth (inches, blank = 18)", type: "number", required: false },
      { key: "porchCapSF", label: "Porch cap / soffit ceiling (sq ft)", type: "number", required: false },
    ],
  },
  // in-ground drains on their own (no gutters, or bid as their own section):
  // $500 standard 9x9, 12x12 $630 as the customer's choice, past 8 ft $35 a
  // pipe section + $15/ft
  drainage: {
    label: "Drainage",
    questions: [
      { key: "drains", label: "In-ground drains (one per downspout)", type: "number", required: true },
      { key: "drainsPast8", label: "Drains running past 8 ft (only if you know)", type: "number", required: false },
      { key: "drainExtraLF", label: "Total extra feet past 8 ft (only if you know)", type: "number", required: false },
    ],
  },
  // permanent lighting on its own: $30/ft + $500 control box, every customer
  lighting: {
    label: "Permanent lighting",
    questions: [{ key: "lightingLF", label: "Lighting (linear ft)", type: "number", required: true }],
  },
  // repaint $4/sq ft of wall (no window deductions), eaves $7/ft, garage
  // doors $400, man doors $300, $500 minimum
  painting: {
    label: "Painting",
    questions: [
      { key: "wallSF", label: "Walls to repaint (sq ft, no window deductions)", type: "number", required: false },
      { key: "eaveLF", label: "Eaves to paint (linear ft)", type: "number", required: false },
      { key: "garageDoors", label: "Garage doors", type: "number", required: false },
      { key: "manDoors", label: "Man doors", type: "number", required: false },
    ],
  },
};

export const AUTOMATED_TRADES = Object.keys(TRADE_QUESTIONS);

// siding is only drafted for the products with a JobTread assembly
export const AUTOMATED_SIDING = ["lp", "hardie", "ascend", "vinyl", "vinylShake"];
// products that get painted on site (the others have a factory finish)
export const PAINTED_SIDING = ["lp", "hardie"];
// no default: Sean picks what he's installing on every siding job
export function sidingProduct(answers = {}) {
  return answers?.siding?.product || null;
}

// what's coming off the walls: the answer, or a guess from the existing
// exterior in the basics
export function tearOffType(basics = {}, siding = {}) {
  if (siding.tearOff) return siding.tearOff;
  const ext = new Set(basics.existingExterior || []);
  if (ext.has("newConstruction")) return "none";
  if (ext.has("stucco")) return "stucco";
  if (ext.has("wood") || ext.has("fiberCement") || ext.has("lp")) return "wood";
  if (ext.has("vinyl") || ext.has("aluminum")) return "vinyl";
  return "none";
}

// drains to offer: what was entered, or one per downspout that reaches the
// ground (downspouts draining onto a roof don't get one)
export function defaultDrainCount(g = {}) {
  if (g.drains !== undefined && g.drains !== "") return Number(g.drains) || 0;
  const downspouts = Number(g.oneStory || 0) + Number(g.twoStory || 0) + Number(g.threeStory || 0);
  return Math.max(0, downspouts - Number(g.roofDrainDownspouts || 0));
}

// Upgrades are offered only where they fit the work being done — on GC bids
// too — never as random add-ons:
//   gutter guards: gutter jobs with trees near the gutters
//   in-ground drains: gutter jobs with downspouts that reach the ground
//   permanent lighting: retail remodels that include siding (never a
//     gutters-only job or a GC bid)
//   insulated reflective house wrap: siding jobs
//   Emerald Rain Refresh paint: GC siding bids (retail already gets it)
export function upgradesFor(basics, answers = {}) {
  const trades = new Set(basics?.trades || []);
  const retail = (basics?.customerType || "") !== "gc";
  const gutters = trades.has("gutters");
  const siding = trades.has("siding");
  return {
    // guard options entered by hand replace the single trees upgrade
    guards: gutters && answers?.gutters?.trees === "yes" && !answers?.gutters?.guardOptions?.length,
    // when Drainage is its own trade on the lead, drains are bid there instead
    drains: gutters && !trades.has("drainage") && defaultDrainCount(answers?.gutters) > 0,
    lighting: gutters && retail && siding && !trades.has("lighting"),
    // siding jobs: insulated wrap for everyone; Emerald is the paint upgrade
    // on GC bids (retail bids already get Emerald)
    insulatedWrap: siding,
    // all Hardie jobs get Emerald, so the upgrade is only for GC LP bids
    emeraldPaint: siding && !retail && sidingProduct(answers) === "lp",
  };
}

export function questionsFor(trade, basics, answers = {}) {
  const set = TRADE_QUESTIONS[trade];
  if (!set) return [];
  const offered = upgradesFor(basics, answers);
  return set.questions.filter(
    (q) =>
      (!q.upgrade || offered[q.upgrade]) &&
      (!q.products || q.products.includes(sidingProduct(answers))) &&
      (!q.showIf || q.showIf(answers?.[trade] || {}))
  );
}

function toNumber(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// keeps known questions only; numbers must be zero or more
export function cleanTradeAnswers(input) {
  const out = {};
  for (const [trade, set] of Object.entries(TRADE_QUESTIONS)) {
    const given = (input && input[trade]) || {};
    const answers = {};
    for (const q of set.questions) {
      const v = given[q.key];
      if (q.type === "number") {
        const n = toNumber(v);
        if (n !== null && !Number.isNaN(n)) answers[q.key] = n;
      } else if (q.type === "single") {
        if (q.options.some((o) => o.key === String(v))) answers[q.key] = String(v);
      } else if (q.type === "text") {
        const t = v == null ? "" : String(v).trim().slice(0, 60);
        if (t) answers[q.key] = t;
      } else if (q.type === "repairs") {
        const list = cleanRepairs(v);
        if (list.length) answers[q.key] = list;
      } else if (q.type === "guardOptions") {
        const list = cleanGuardOptions(v);
        if (list.length) answers[q.key] = list;
      }
    }
    out[trade] = answers;
  }
  return out;
}

const num = (v) => {
  const n = toNumber(v);
  return n === null || Number.isNaN(n) ? null : n;
};
const text = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));

// [{ preset, qty, price, name }]: preset is a key of gutterRepairs.presets in
// estimating/pricing.json (checked again when drafting); price blank = the
// preset's price; name only for "other"
export function cleanRepairs(v) {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 20)
    .map((r) => {
      const preset = /^[a-zA-Z]{1,40}$/.test(String(r?.preset || "")) ? String(r.preset) : "";
      const out = { preset };
      const qty = num(r?.qty);
      const price = num(r?.price);
      if (qty !== null) out.qty = qty;
      if (price !== null) out.price = price;
      const name = text(r?.name, 120);
      if (name) out.name = name;
      return out;
    })
    .filter((r) => r.preset && (r.preset !== "other" || r.name));
}

// [{ label, lf, difficultLF, reason, recommended }]: at most one recommended
export function cleanGuardOptions(v) {
  if (!Array.isArray(v)) return [];
  let recommended = false;
  return v
    .slice(0, 4)
    .map((o) => {
      const out = { label: text(o?.label, 60), lf: num(o?.lf) || 0 };
      const d = num(o?.difficultLF);
      if (d) out.difficultLF = d;
      // what makes it difficult, e.g. "tree cover & 8' grade drop"
      const note = text(o?.difficultNote, 60);
      if (d && note) out.difficultNote = note;
      const reason = text(o?.reason, 400);
      if (reason) out.reason = reason;
      if (o?.recommended && !recommended) out.recommended = recommended = true;
      return out;
    })
    .filter((o) => o.label && o.lf > 0);
}

// a question's required can depend on the other answers (e.g. stucco wall
// area only on a full job)
export function isQuestionRequired(q, tradeAnswers) {
  return typeof q.required === "function" ? !!q.required(tradeAnswers || {}) : !!q.required;
}

export function missingTradeAnswers(trade, answers, basics) {
  return questionsFor(trade, basics, { [trade]: answers })
    .filter((q) => isQuestionRequired(q, answers) && (answers?.[q.key] === undefined || answers?.[q.key] === "" || (Array.isArray(answers?.[q.key]) && !answers[q.key].length)))
    .map((q) => ({ key: q.key, label: q.label }));
}
