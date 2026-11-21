// The cover email that goes with a drafted Proposal (body only; JobTread
// supplies the subject). Rules (estimating/rules.md): short, first person
// ("Thanks for having me out"), one or two sentences on why the options
// exist, and point them to sign in the proposal. It never restates the bid.
// It's only sent after Sean approves this specific proposal.

import { ESTIMATE_BASICS_QUESTIONS } from "../../shared/estimateBasics.js";

// "Sam Willis" → "Sam"; "Cindy and Layne Bell" → "Cindy and Layne"
export function greetingName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (!n) return "there";
  if (/\s(and|&)\s/i.test(n)) {
    const words = n.split(" ");
    return words.length > 3 ? words.slice(0, -1).join(" ") : n;
  }
  return n.split(" ")[0];
}

// "765 W 1725 N, Orem, UT 84057, USA" → "Orem"
export function cityOf(address) {
  const parts = String(address || "").split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const city = parts[1];
  if (/^(ut|utah|usa)$/i.test(city) || /\d{5}/.test(city)) return "";
  return city.replace(/\s+(ut|utah)$/i, "");
}

function list(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const SIDING_PHRASE = { lp: "new LP SmartSide siding", hardie: "new James Hardie siding", vinyl: "new vinyl siding", vinylShake: "new vinyl shake siding", ascend: "new Ascend siding" };

function workLabel(basics, answers = {}) {
  const trades = ESTIMATE_BASICS_QUESTIONS.find((q) => q.key === "trades");
  const phrases = (basics.trades || []).map((k) => {
    if (k === "gutters") return "new gutters and downspouts";
    if (k === "siding") return SIDING_PHRASE[answers?.siding?.product] || "new siding";
    if (k === "stucco") return answers?.stucco?.jobType === "full" ? "new stucco" : "the stucco repairs";
    if (k === "lighting") return "permanent holiday lighting";
    if (k === "drainage") return Number(answers?.drainage?.drains) === 1 ? "an in-ground drain" : "in-ground drains";
    if (k === "painting") {
      const a = answers?.painting || {};
      if (Number(a.wallSF) > 0) return "painting the exterior";
      if (Number(a.eaveLF) > 0) return "painting the eaves";
      return "the exterior painting";
    }
    if (k === "soffitFascia") {
      const a = answers?.soffitFascia || {};
      if (Number(a.bothLF) > 0 || (Number(a.soffitOnlyLF) > 0 && Number(a.fasciaOnlyLF) > 0)) return "new aluminum soffit and fascia";
      if (Number(a.soffitOnlyLF) > 0) return "new aluminum soffit";
      if (Number(a.fasciaOnlyLF) > 0) return "new aluminum fascia";
      if (Number(a.porchCapSF) > 0) return "the new aluminum porch ceiling";
      return "new aluminum soffit and fascia";
    }
    return trades.options.find((o) => o.key === k)?.label.toLowerCase();
  });
  const list_ = phrases.filter(Boolean);
  // a gutter job without new gutters is repairs and/or guards
  const g = answers?.gutters || {};
  const gi = list_.indexOf("new gutters and downspouts");
  if (gi >= 0 && !(Number(g.gutterLF) > 0) && (g.repairs?.length || g.guardOptions?.length)) {
    list_[gi] = [g.repairs?.length && "the gutter repairs", g.guardOptions?.length && "gutter guards"].filter(Boolean).join(" and ");
  }
  return list_.length ? list(list_) : "the exterior work";
}

// one sentence on why the options are there
export function upgradeSentence(offered, { gc = false, guardOptions = [] } = {}) {
  const items = [];
  if (offered.guards) items.push({ name: "gutter guards", why: "to cut down on maintenance with the trees on the property" });
  if (offered.drains) items.push({ name: "in-ground drains", why: "to carry the downspout water away from the foundation" });
  if (offered.lighting) items.push({ name: "permanent holiday lighting", why: "since we'll already be up on the eaves" });
  if (offered.insulatedWrap) items.push({ name: "an insulated reflective house wrap", why: "to help keep the walls cooler in summer and warmer in winter" });
  if (offered.emeraldPaint) items.push({ name: "Sherwin-Williams Emerald Rain Refresh paint", why: "for a longer-lasting finish" });
  const parts = [];
  if (guardOptions.length > 1) {
    const rec = guardOptions.findIndex((o) => o.recommended);
    parts.push(
      `I put together ${guardOptions.length} gutter guard options so you can choose how much of the house to cover${rec >= 0 ? `; Option ${"ABCD"[rec]} is the one I'd recommend` : ""}.`
    );
  } else if (guardOptions.length === 1) {
    parts.push("I added gutter guards as an option to cut down on maintenance.");
  }
  if (items.length) {
    if (gc) parts.push(`I included ${list(items.map((i) => i.name))} as ${items.length === 1 ? "an option" : "options"}.`);
    else {
      const [first, ...rest] = items;
      const more = rest.map((i) => `${i.name} ${i.why}`);
      parts.push(`I also included ${first.name} as an option ${first.why}${more.length ? `, as well as ${list(more)}` : ""}.`);
    }
  }
  return parts.join(" ");
}

// closing and signature as Sean writes them (Proposal 492-1)
const QUESTIONS = "If you have any questions, just reply here or call me at 801-800-0831.";
const SIGNATURE = "Thanks,\nSean\nRidgeline Home Exteriors\n801-800-0831 | sean@rhxutah.com";
const signHere = (hasOptions) => (hasOptions ? "You can choose an option and sign right in the proposal." : "You can review everything and sign right in the proposal.");

export function proposalMessage({ lead, basics, answers = {}, offered = {} }) {
  const type = basics.customerType || "retail";
  const work = workLabel(basics, answers);
  const street = String(lead.address || "").split(/[,\n]/)[0].trim();
  const homeowner = String(basics.homeownerName || "").trim();
  const hi = `Hey ${greetingName(lead.name)},`;
  const options = upgradeSentence(offered, { gc: type === "gc", guardOptions: answers?.gutters?.guardOptions || [] });

  if (type === "gc") {
    const forWhom = homeowner || street;
    return [hi, [`Here's my bid for ${work}${forWhom ? ` for ${forWhom}` : ""}.`, options].filter(Boolean).join(" "), `${signHere(!!options)} ${QUESTIONS}`, SIGNATURE].join("\n\n");
  }
  return [
    hi,
    ["Thanks for having me out.", `Here's my ${type === "insurance" ? "estimate" : "proposal"} for ${work}.`, options].filter(Boolean).join(" "),
    `${signHere(!!options)} ${QUESTIONS}`,
    SIGNATURE,
  ].join("\n\n");
}
