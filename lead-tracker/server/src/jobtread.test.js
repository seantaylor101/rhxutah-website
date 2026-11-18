import { test } from "node:test";
import assert from "node:assert/strict";
import { toE164, syncLeadToJobTread, jobNameFor } from "./jobtread.js";

process.env.JOBTREAD_GRANT_KEY = "test-key";

function mockFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.query);
    const out = responder(body.query);
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  return calls;
}

const lead = { name: "Pat Doe", phone: "(801) 555-0123", email: "pat@example.com", address: "123 Main St, Lehi, UT", source: "google", job: "" };
const basics = { customerType: "retail", trades: ["gutters", "siding"] };

test("phone normalizes to E.164", () => {
  assert.equal(toE164("(801) 555-0123"), "+18015550123");
  assert.equal(toE164("1-801-555-0123"), "+18015550123");
  assert.equal(toE164("555"), "");
});

test("job names always carry an identifier", () => {
  // homeowner is the lead → street + work
  assert.equal(jobNameFor(lead, basics), "123 Main St Gutters, Siding");
  assert.equal(jobNameFor({ ...lead, job: "Gutters" }, basics), "123 Main St Gutters");
  // referral partner (Erick) → homeowner + work
  const erick = { ...lead, name: "Erick Funn", job: "Gutters" };
  assert.equal(jobNameFor(erick, { ...basics, homeownerName: "Beckie Price" }), "Beckie Price Gutters");
  // Job field already names the homeowner → used as-is
  assert.equal(jobNameFor({ ...erick, job: "Beckie Price gutters" }, { ...basics, homeownerName: "Beckie Price" }), "Beckie Price gutters");
  // no homeowner given → street keeps Erick's jobs apart
  assert.equal(jobNameFor({ ...erick, address: "254 S 700 W, Layton" }, basics), "254 S 700 W Gutters");
});

test("referral partner: new address gets its own location under the same customer", async () => {
  const calls = mockFetch((q) => {
    if (q.currentGrant) return { currentGrant: { organization: { id: "org1" } } };
    if (q.organization)
      return { organization: { contacts: { nodes: [{ id: "c", account: { id: "erick", name: "Erick Funn", locations: { nodes: [{ id: "old", address: "254 S 700 W" }] } } }] } } };
    if (q.createLocation) return { createLocation: { createdLocation: { id: "new" } } };
    if (q.createJob) return { createJob: { createdJob: { id: "job3", number: "488" } } };
    throw new Error("unexpected " + Object.keys(q));
  });
  const link = await syncLeadToJobTread(
    { ...lead, name: "Erick Funn", job: "Gutters" },
    { ...basics, homeownerName: "Beckie Price" },
    {}
  );
  assert.equal(link.accountId, "erick");
  assert.equal(link.locationId, "new");
  assert.equal(calls.find((c) => c.createJob).createJob.$.name, "Beckie Price Gutters");
  assert.ok(!calls.some((c) => c.createAccount));
});

test("new customer: creates account, contact, location, job", async () => {
  const calls = mockFetch((q) => {
    if (q.currentGrant) return { currentGrant: { organization: { id: "org1" } } };
    if (q.organization) return { organization: { contacts: { nodes: [] } } };
    if (q.createAccount) return { createAccount: { createdAccount: { id: "acc1", name: "Pat Doe" } } };
    if (q.createContact) return { createContact: { createdContact: { id: "con1" } } };
    if (q.createLocation) return { createLocation: { createdLocation: { id: "loc1" } } };
    if (q.createJob) return { createJob: { createdJob: { id: "job1", number: "486" } } };
    throw new Error("unexpected " + JSON.stringify(q));
  });
  const link = await syncLeadToJobTread(lead, basics, {});
  assert.equal(link.jobId, "job1");
  assert.equal(link.jobNumber, "486");
  const acct = calls.find((c) => c.createAccount).createAccount.$;
  assert.equal(acct.customFieldValues["Lead Source"], "Google");
  assert.equal(acct.customFieldValues.Type, "Residential");
  assert.equal(calls.find((c) => c.createContact).createContact.$.customFieldValues.Phone, "+18015550123");
  assert.equal(calls.find((c) => c.createLocation).createLocation.$.name, "123 Main St");
  assert.equal(calls.find((c) => c.createJob).createJob.$.customFieldValues.Status, "Estimating");
  assert.equal(calls[0].$.grantKey, "test-key");
});

test("repeat customer at the same address: reuses account and location", async () => {
  const calls = mockFetch((q) => {
    if (q.organization)
      return { organization: { contacts: { nodes: [{ id: "c", account: { id: "accX", name: "Pat Doe", locations: { nodes: [{ id: "locX", address: "123 Main Street, Lehi" }] } } }] } } };
    if (q.createJob) return { createJob: { createdJob: { id: "job2", number: "487" } } };
    throw new Error("should not create " + Object.keys(q));
  });
  const link = await syncLeadToJobTread(lead, basics, {});
  assert.equal(link.accountId, "accX");
  assert.equal(link.locationId, "locX");
  assert.equal(link.jobId, "job2");
  assert.ok(!calls.some((c) => c.createAccount || c.createLocation));
});

test("already linked: creates nothing", async () => {
  const calls = mockFetch(() => ({}));
  const link = await syncLeadToJobTread(lead, basics, { accountId: "a", locationId: "l", jobId: "j" });
  assert.equal(link.jobId, "j");
  assert.equal(calls.filter((c) => !c.currentGrant).length, 0);
});
