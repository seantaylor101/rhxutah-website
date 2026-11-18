import { test } from "node:test";
import assert from "node:assert/strict";
import { proposalMessage, greetingName, cityOf } from "./proposalMessage.js";

test("names and cities", () => {
  assert.equal(greetingName("Sam Willis"), "Sam");
  assert.equal(greetingName("Cindy and Layne Bell"), "Cindy and Layne");
  assert.equal(cityOf("765 W 1725 N, Orem, UT 84057, USA"), "Orem");
  assert.equal(cityOf("1841 E Hubbard Ave, SLC"), "SLC");
  assert.equal(cityOf("123 Main"), "");
});

test("retail gutter job with guards + drains", () => {
  const m = proposalMessage({
    lead: { name: "Matt Maddox", address: "45 N 100 E, Provo, UT" },
    basics: { customerType: "retail", trades: ["gutters"] },
    offered: { guards: true, drains: true },
  });
  assert.match(m, /^Hey Matt,\n\nHere is the quote for new gutters and downspouts on your home in Provo\./);
  assert.match(m, /I also added gutter guards as an option to cut down on maintenance with the trees on the property, as well as in-ground drains to carry the downspout water away from the foundation\./);
  assert.match(m, /lifetime workmanship warranty/);
  assert.match(m, /Thanks so much,\n\nSean Taylor\nRidgeline Home Exteriors\n801-800-0831$/);
  console.log("\n--- retail ---\n" + m);
});

test("GC job is short, names the homeowner, lists options plainly", () => {
  const m = proposalMessage({
    lead: { name: "Erick Funn", address: "1841 E Hubbard Ave, SLC" },
    basics: { customerType: "gc", trades: ["gutters"], homeownerName: "Beckie Price" },
    offered: { drains: true },
  });
  assert.match(m, /Here is the estimate for the new gutters and downspouts for Beckie Price\. I added in-ground drains as an option\./);
  assert.ok(!/warranty/.test(m));
  assert.match(m, /Thanks so much,\n\nSean$/);
  console.log("\n--- gc ---\n" + m);
});

test("no upgrades → no upgrade sentence", () => {
  const m = proposalMessage({ lead: { name: "Pat", address: "" }, basics: { customerType: "gc", trades: ["gutters"] }, offered: {} });
  assert.ok(!/option/.test(m));
});
