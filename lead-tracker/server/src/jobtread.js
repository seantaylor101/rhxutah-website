// JobTread (Pave API) client for Lead Hammer.
//
// Used when the owner taps "Start Estimate" on a lead: the lead becomes a
// customer + location + job in JobTread (reusing an existing customer when
// the phone or email already matches one). Nothing here ever sends anything
// to a customer — estimates are only drafted, and sending stays a manual
// step for the owner.
//
// Needs JOBTREAD_GRANT_KEY (a grant scoped to the Ridgeline Home Exteriors
// organization only).

import { ESTIMATE_BASICS_QUESTIONS } from "../../shared/estimateBasics.js";
import { JOBTREAD } from "../../estimating/index.js";

const PAVE_URL = "https://api.jobtread.com/pave";

// Lead Hammer source key → JobTread customer "Lead Source" option
const LEAD_SOURCE_MAP = {
  referral: "Referral",
  referral_bni: "Referral",
  google: "Google",
  facebook: "Facebook",
  website: "Website",
};

// JobTread rejects over-long names (jobs: 30 characters)
function capName(name, max = 120) {
  const n = String(name || "").trim();
  return n.length > max ? n.slice(0, max).trimEnd() : n;
}

export function jobtreadConfigured() {
  return !!process.env.JOBTREAD_GRANT_KEY;
}

export async function pave(query) {
  const grantKey = process.env.JOBTREAD_GRANT_KEY;
  if (!grantKey) throw new Error("JobTread isn't connected yet (JOBTREAD_GRANT_KEY is missing)");
  const res = await fetch(PAVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`JobTread error (${res.status}): ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JobTread returned an unreadable response");
  }
}

let cachedOrgId = null;
export async function organizationId() {
  if (cachedOrgId) return cachedOrgId;
  const data = await pave({ currentGrant: { organization: { id: {} } } });
  cachedOrgId = data?.currentGrant?.organization?.id;
  if (!cachedOrgId) throw new Error("Couldn't find the JobTread organization for this grant");
  return cachedOrgId;
}

// "(801) 555-0123" → "+18015550123" (how JobTread stores phone numbers)
export function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

// pulls the street off "123 Main St, Lehi, UT" for the location's name,
// matching how existing JobTread locations are named
function streetOf(address) {
  return String(address || "").split(/[,\n]/)[0].trim();
}

const STREET_WORDS = {
  street: "st", avenue: "ave", drive: "dr", road: "rd", lane: "ln", court: "ct", circle: "cir",
  boulevard: "blvd", place: "pl", way: "way", trail: "trl", parkway: "pkwy",
  north: "n", south: "s", east: "e", west: "w",
};

// "4713 Pheasant Ridge Trail North" and "4713 Pheasant Ridge Trl N" match
function normStreet(address) {
  return streetOf(address)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] || w)
    .join("");
}

function sameStreet(a, b) {
  const na = normStreet(a);
  return !!na && na === normStreet(b);
}

// an existing customer contact whose phone or email matches the lead
export async function findCustomerAccount(orgId, { phone, email }) {
  const e164 = toE164(phone);
  const cleanEmail = String(email || "").trim();
  const matches = [];
  if (e164) matches.push({ and: [[["customField", "type"], "phoneNumber"], ["value", e164]] });
  if (cleanEmail) matches.push({ and: [[["customField", "type"], "emailAddress"], ["value", "like", cleanEmail]] });
  if (!matches.length) return null;

  const data = await pave({
    organization: {
      $: { id: orgId },
      contacts: {
        $: {
          with: { m: { _: "customFieldValues", $: { where: { or: matches } } } },
          where: { and: [[["account", "type"], "customer"], [["m", "count"], ">", 0]] },
          size: 1,
        },
        nodes: {
          id: {},
          account: { id: {}, name: {}, locations: { $: { size: 50 }, nodes: { id: {}, address: {} } } },
        },
      },
    },
  });
  const contact = data?.organization?.contacts?.nodes?.[0];
  return contact ? { contactId: contact.id, ...contact.account } : null;
}

// Every job gets an identifier up front, so a referral partner's account
// (e.g. Erick Funn, who sends a lot of jobs) never fills up with look-alike
// "Gutters" jobs: "<homeowner or street> <work>", like "Beckie Price Gutters"
// or "123 Main St Gutters". JobTread caps job names at 30 characters, so the
// longest version that fits is used; whatever doesn't fit (a long Job field)
// goes in the job's description instead.
const MAX_JOB_NAME = JOBTREAD.limits.jobName;

function tradeLabelsOf(basics) {
  const trades = ESTIMATE_BASICS_QUESTIONS.find((q) => q.key === "trades");
  return (basics.trades || []).map((k) => trades.options.find((o) => o.key === k)?.label).filter(Boolean);
}

function fit(name) {
  return name.length > MAX_JOB_NAME ? name.slice(0, MAX_JOB_NAME).trimEnd() : name;
}

export function jobNameFor(lead, basics) {
  const jobField = String(lead.job || "").trim().replace(/\s+/g, " ");
  const tradeLabels = tradeLabelsOf(basics);
  const homeowner = String(basics.homeownerName || "").trim();
  const leadIsHomeowner = !homeowner || homeowner.toLowerCase() === String(lead.name || "").trim().toLowerCase();
  // the lead is the homeowner: their name is already on the customer, so
  // the street is what tells their jobs apart
  const identifier = leadIsHomeowner ? streetOf(lead.address) : homeowner;

  const withId = (work) =>
    !identifier ? work : work.toLowerCase().includes(identifier.toLowerCase()) ? work : `${identifier} ${work}`;
  const candidates = [
    jobField && withId(jobField),
    tradeLabels.length && withId(tradeLabels.join(", ")),
    tradeLabels.length && withId(tradeLabels[0]),
    identifier,
    jobField,
    "Exterior work",
  ].filter(Boolean);
  return candidates.find((c) => c.length <= MAX_JOB_NAME) || fit(candidates[0]);
}

// the Job field text, when it didn't make it into the job name whole
export function jobFieldLeftOut(lead, basics) {
  const jobField = String(lead.job || "").trim();
  return jobField && !jobNameFor(lead, basics).toLowerCase().includes(jobField.replace(/\s+/g, " ").toLowerCase());
}

// plain-text summary of the basics, put on the JobTread job's description so
// the estimate (and anyone opening the job) has them
export function basicsSummary(basics, lead = {}) {
  const lines = [];
  if (jobFieldLeftOut(lead, basics)) lines.push(`Job notes: ${String(lead.job).trim()}`);
  for (const q of ESTIMATE_BASICS_QUESTIONS) {
    const v = basics[q.key];
    if (q.type === "multi") {
      if (v?.length) lines.push(`${q.label}: ${v.map((k) => q.options.find((o) => o.key === k)?.label || k).join(", ")}`);
    } else if (q.type === "single") {
      if (v) lines.push(`${q.label}: ${q.options.find((o) => o.key === v)?.label || v}`);
    } else if (v) {
      lines.push(`${q.label}: ${v}`);
    }
  }
  return `From Lead Hammer:\n${lines.join("\n")}`;
}

// Raised when a customer with the same name or street address already exists
// in JobTread (but no phone/email match): Sean picks one or says "create
// new" instead of the estimator guessing.
export class PossibleDuplicateError extends Error {
  constructor(candidates) {
    super("A customer with this name or address is already in JobTread");
    this.candidates = candidates;
  }
}

const normName = (n) => String(n || "").toLowerCase().replace(/[^a-z]/g, "");

// customers with the same full name, or a location on the same street
// address. Matching on name alone is exact (other Petersons don't count).
export async function findSimilarAccounts(orgId, lead) {
  const name = String(lead.name || "").trim();
  const houseNumber = (streetOf(lead.address).match(/^\d+/) || [""])[0];
  const lastWord = name.split(/\s+/).pop() || "";
  const data = await pave({
    organization: {
      $: { id: orgId },
      ...(lastWord
        ? {
            accounts: {
              $: { where: { and: [["type", "customer"], ["name", "like", `%${lastWord}%`]] }, size: 50 },
              nodes: { id: {}, name: {} },
            },
          }
        : {}),
      ...(houseNumber
        ? {
            locations: {
              $: { where: { and: [["address", "like", `${houseNumber} %`], [["account", "type"], "customer"]] }, size: 50 },
              nodes: { id: {}, address: {}, account: { id: {}, name: {} } },
            },
          }
        : {}),
    },
  });
  const out = new Map();
  for (const a of data?.organization?.accounts?.nodes || []) {
    if (normName(a.name) && normName(a.name) === normName(name)) out.set(a.id, { accountId: a.id, name: a.name, matchedOn: ["name"] });
  }
  for (const l of data?.organization?.locations?.nodes || []) {
    if (!sameStreet(l.address, lead.address)) continue;
    const prev = out.get(l.account.id) || { accountId: l.account.id, name: l.account.name, matchedOn: [] };
    if (!prev.matchedOn.includes("address")) prev.matchedOn.push("address");
    prev.address = l.address;
    prev.locationId = l.id;
    out.set(l.account.id, prev);
  }
  return [...out.values()];
}

async function accountWithLocations(accountId) {
  const data = await pave({
    account: { $: { id: accountId }, id: {}, name: {}, type: {}, locations: { $: { size: 50 }, nodes: { id: {}, address: {} } } },
  });
  const a = data?.account;
  if (!a?.id || a.type !== "customer") throw new Error("That JobTread customer couldn't be found");
  return a;
}

// Makes sure the lead exists in JobTread as customer → location → job,
// reusing whatever's already linked (existing) or already in JobTread.
// Fills in `link` as it goes (so a failure partway through still leaves the
// ids of whatever got created, and a retry picks up from there) and returns it.
//
// Duplicate guard: a phone/email match is reused automatically. Otherwise a
// customer with the same name or street address stops here with a
// PossibleDuplicateError, unless Sean already chose: `choice.useAccountId`
// (reuse that customer) or `choice.createNew` (make a new one anyway).
export async function syncLeadToJobTread(lead, basics, link = {}, choice = {}) {
  const orgId = await organizationId();

  // 1. customer account (+ contact)
  if (!link.accountId && choice.useAccountId) {
    const a = await accountWithLocations(choice.useAccountId);
    link.accountId = a.id;
    link.accountName = a.name;
    link.reusedCustomer = true;
    const loc = (a.locations?.nodes || []).find((l) => sameStreet(l.address, lead.address));
    if (loc) link.locationId = loc.id;
  }
  if (!link.accountId) {
    const found = await findCustomerAccount(orgId, lead);
    if (!found && !choice.createNew) {
      const candidates = await findSimilarAccounts(orgId, lead);
      if (candidates.length) throw new PossibleDuplicateError(candidates);
    }
    if (found) {
      link.accountId = found.id;
      link.accountName = found.name;
      link.reusedCustomer = true;
      const loc = (found.locations?.nodes || []).find((l) => sameStreet(l.address, lead.address));
      if (loc) link.locationId = loc.id;
    } else {
      const accountFields = { Type: basics.customerType === "gc" ? "Commercial" : "Residential", Status: "Appointment Set" };
      if (LEAD_SOURCE_MAP[lead.source]) accountFields["Lead Source"] = LEAD_SOURCE_MAP[lead.source];
      const created = await pave({
        createAccount: {
          $: { organizationId: orgId, type: "customer", name: capName(lead.name), suffixIfNecessary: true, customFieldValues: accountFields },
          createdAccount: { id: {}, name: {} },
        },
      });
      link.accountId = created.createAccount.createdAccount.id;
      link.accountName = created.createAccount.createdAccount.name;

      const contactFields = {};
      const e164 = toE164(lead.phone);
      if (e164) contactFields[JOBTREAD.customFields.contactPhone] = e164;
      if (String(lead.email || "").trim()) contactFields[JOBTREAD.customFields.contactEmail] = lead.email.trim();
      await pave({
        createContact: {
          $: { accountId: link.accountId, name: capName(lead.name), customFieldValues: contactFields },
          createdContact: { id: {} },
        },
      });
    }
  }

  // 2. location
  if (!link.locationId) {
    const created = await pave({
      createLocation: {
        $: { accountId: link.accountId, name: capName(streetOf(lead.address) || lead.address, 30), address: lead.address },
        createdLocation: { id: {} },
      },
    });
    link.locationId = created.createLocation.createdLocation.id;
  }

  // 3. job
  if (!link.jobId) {
    const created = await pave({
      createJob: {
        $: {
          locationId: link.locationId,
          name: jobNameFor(lead, basics),
          description: basicsSummary(basics, lead),
          customFieldValues: { [JOBTREAD.customFields.jobStatus]: JOBTREAD.customFields.jobStatusEstimating },
        },
        createdJob: { id: {}, number: {} },
      },
    });
    link.jobId = created.createJob.createdJob.id;
    link.jobNumber = created.createJob.createdJob.number;
  }

  link.syncedAt = new Date().toISOString();
  return link;
}

export function jobUrl(jobId) {
  return `https://app.jobtread.com/jobs/${jobId}`;
}
