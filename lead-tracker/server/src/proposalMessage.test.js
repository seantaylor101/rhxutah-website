import { test } from "node:test";
import assert from "node:assert/strict";
import { proposalMessage, greetingName, cityOf } from "./proposalMessage.js";

test("names and cities", () => {
  assert.equal(greetingName("Sam Willis"), "Sam");
  assert.equal(greetingName("Cindy and Layne Bell"), "Cindy and Layne");
  assert.equal(cityOf("765 W 1725 N, Orem, UT 84057, USA"), "Orem");
  assert.equal(cityOf("123 Main"), "");
});

const sentences = (m) => m.split("\n\n")[1].split(/(?<=\.)\s/).length;

test("retail: short, first person, why the options exist, sign in the proposal", () => {
  const m = proposalMessage({
    lead: { name: "Scott Peterson", address: "360 W 920 N, Orem, UT" },
    basics: { customerType: "retail", trades: ["gutters"] },
    answers: { gutters: { repairs: [{ preset: "reslope" }], guardOptions: [{ label: "West & North", lf: 132, recommended: true }, { label: "East", lf: 80 }] } },
    offered: {},
  });
  assert.match(m, /^Hey Scott,\n\nThanks for having me out\. Here's my proposal for the gutter repairs and gutter guards\./);
  assert.match(m, /2 gutter guard options .* Option A is the one I'd recommend\./);
  assert.match(m, /You can choose an option and sign right in the proposal\./);
  assert.ok(!/\$|warranty|Subject/i.test(m), "doesn't restate the bid");
  assert.ok(sentences(m) <= 4);
  assert.match(m, /Thanks,\nSean\nRidgeline Home Exteriors\n801-800-0831 \| sean@rhxutah\.com$/);
  console.log("\n--- retail ---\n" + m);
});

test("GC: short, names the homeowner, related options only", () => {
  const m = proposalMessage({
    lead: { name: "Erick Funn", address: "1841 E Hubbard Ave, SLC" },
    basics: { customerType: "gc", trades: ["gutters"], homeownerName: "Beckie Price" },
    offered: { drains: true },
  });
  assert.match(m, /^Hey Erick,\n\nHere's my bid for new gutters and downspouts for Beckie Price\. I included in-ground drains as an option\./);
  assert.ok(!/having me out/.test(m));
  console.log("\n--- gc ---\n" + m);
});

test("no options → no options sentence", () => {
  const m = proposalMessage({ lead: { name: "Pat", address: "" }, basics: { customerType: "retail", trades: ["gutters"] }, offered: {} });
  assert.ok(!/option/i.test(m));
});
