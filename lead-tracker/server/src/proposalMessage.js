// The email message that goes out with a drafted Proposal, written the way
// Sean writes his own proposal emails in JobTread: "Hey <first name>, here is
// the quote for <work> ...", a sentence on any upgrade options and why
// they're there, a close inviting questions or scheduling, "Thanks so much,
// Sean". GC messages are short and to the point; retail ones mention the
// lifetime workmanship warranty. It's only pre-filled — Sean can still edit
// it in JobTread's send screen before anything goes out.

import { ESTIMATE_BASICS_QUESTIONS } from "../../shared/estimateBasics.js";

const SIGNATURE = "Sean Taylor\nRidgeline Home Exteriors\n801-800-0831";

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

const SIDING_PHRASE = { lp: "new LP SmartSide siding", hardie: "new James Hardie siding", vinyl: "new vinyl siding", ascend: "new Ascend siding" };

function workLabel(basics, answers = {}) {
  const trades = ESTIMATE_BASICS_QUESTIONS.find((q) => q.key === "trades");
  const phrases = (basics.trades || []).map((k) => {
    if (k === "gutters") return "new gutters and downspouts";
    if (k === "siding") return SIDING_PHRASE[answers?.siding?.product] || "new siding";
    if (k === "stucco") return answers?.stucco?.jobType === "repair" ? "the stucco repairs" : "new stucco";
    return trades.options.find((o) => o.key === k)?.label.toLowerCase();
  });
  const list_ = phrases.filter(Boolean);
  return list_.length ? list(list_) : "the exterior work";
}

// one sentence on the upgrade options, saying why each one is there — like
// "I also added gutter guards as an option to eliminate maintenance due to
// the large trees on the property as well as an in-ground drain..."
export function upgradeSentence(offered, { gc = false } = {}) {
  const items = [];
  if (offered.guards) items.push({ name: "gutter guards", why: "to cut down on maintenance with the trees on the property" });
  if (offered.drains) items.push({ name: "in-ground drains", why: "to carry the downspout water away from the foundation" });
  if (offered.lighting) items.push({ name: "permanent holiday lighting", why: "since we'll already be up on the eaves" });
  if (offered.insulatedWrap) {
    items.push({ name: "an insulated reflective house wrap", why: "to help keep the walls cooler in summer and warmer in winter" });
  }
  if (offered.emeraldPaint) items.push({ name: "Sherwin-Williams Emerald Rain Refresh paint", why: "" });
  if (!items.length) return "";
  if (gc) return `I added ${list(items.map((i) => i.name))} as ${items.length === 1 ? "an option" : "options"}.`;
  const [first, ...rest] = items;
  const more = rest.map((i) => `${i.name}${i.why ? ` ${i.why}` : ""}`);
  return `I also added ${first.name} as an option${first.why ? ` ${first.why}` : ""}${more.length ? `, as well as ${list(more)}` : ""}.`;
}

export function proposalMessage({ lead, basics, answers = {}, offered = {} }) {
  const type = basics.customerType || "retail";
  const work = workLabel(basics, answers);
  const city = cityOf(lead.address);
  const street = String(lead.address || "").split(/[,\n]/)[0].trim();
  const homeowner = String(basics.homeownerName || "").trim();
  const hi = `Hey ${greetingName(lead.name)},`;

  if (type === "gc") {
    const forWhom = homeowner || street;
    return [
      hi,
      [`Here is the estimate for the ${work}${forWhom ? ` for ${forWhom}` : ""}.`, upgradeSentence(offered, { gc: true })]
        .filter(Boolean)
        .join(" "),
      "Let me know if you have any questions or would like to move forward.",
      "Thanks so much,\n\nSean",
    ].join("\n\n");
  }

  if (type === "insurance") {
    return [
      hi,
      `Here is my estimate for the ${work}${street ? ` at ${street}` : ""}. ${upgradeSentence(offered)}`.trim(),
      "Please let me know if you have any questions.",
      `Thanks so much,\n\n${SIGNATURE}`,
    ].join("\n\n");
  }

  return [
    hi,
    `Here is the quote for ${work} on your home${city ? ` in ${city}` : ""}. ${upgradeSentence(offered)}`.trim(),
    "Let me know if you have any questions or if you'd like to move forward and get it scheduled. We have a lifetime workmanship warranty, so if you ever have an issue caused by our workmanship, we'll come out and fix it. We stand by our work.",
    `Thanks so much,\n\n${SIGNATURE}`,
  ].join("\n\n");
}
