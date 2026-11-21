# Ridgeline Home Exteriors: estimating rules

This is the single source of truth for how RHX estimates jobs. The Lead Hammer
estimator follows it in code, and Claude's draft review reads this file
word for word. Rates live in `pricing.json`, and JobTread IDs and Proposal
defaults live in `jobtread.json`. To change a price, edit `pricing.json`, not code.

## Workflow

1. A lead becomes a JobTread customer **only when Sean taps Start Estimate**,
   never when the lead is logged.
2. **Duplicate guard:** before creating a customer, look for an existing
   JobTread customer. A match on phone or email is reused automatically. A
   match on only the name or only the street address is shown to Sean, who
   picks "use this customer" or "create new". The agent never guesses.
3. The Estimate Basics (customer type, work needed, stories, existing
   exterior, measurements, timeline, address) are answered on the lead and fed
   to the estimate. Don't ask for them again.
4. The estimate is built from these rules plus past pricing from JobTread
   history (shown next to the draft for comparison).
5. **Proposals are created as drafts.** Nothing is emailed or sent to a
   customer until Sean approves that specific proposal: recipient, message and
   attachments. If any of those change after he approves, he has to approve
   again.
6. After an approved send, the Proposal is set to **pending** so the customer
   can sign. (The API send leaves it "draft" otherwise.)
7. **Sean picks the siding product on every estimate.** There is no default.

## Options and upgrades

Use good/better/best options and optional upgrades to capture more revenue.

- **Retail:** gutter guards on gutter jobs; gutter guards and permanent holiday
  lighting on full remodels; insulated reflective house wrap on siding jobs, at
  a premium.
- **GC bids:** only upgrades related to the work already being done: upgraded
  paint, upgraded house wrap, gutter guards if there are trees on a gutter job,
  in-ground drains. Never unrelated add-ons such as holiday lighting.
- **Structure in JobTread:** a parent cost group with min 0 / max 1 selection,
  each option as a child group. The recommended option is pre-selected.
- **Option descriptions** give the reason for the recommendation (what was
  found on site). Keep customer-private information (e.g. "planning to sell")
  out unless Sean approves it.

## Proposal format

- **Material and labor are never shown separately** on any proposal (retail,
  GC or insurance). Each item is one "installed" line carrying both cost and
  price, e.g. `5" Bulldog gutter guards, Dark Bronze - installed` per LF.
  Customers should never feel they need to look up material costs.
- **Insurance** jobs are priced off the adjuster's estimate; the line items
  follow the claim's structure (still combined installed lines).
- **Sales tax:** insurance proposals only (7.45%). Retail and GC proposals use
  taxRate 0.
- **Clean numbers:** per-LF/SF prices land on quarters ($9.50/ft, not $9.54);
  each/lump-sum prices land on $5.
- No "haul away debris" or similar filler in line descriptions unless Sean
  asks.
- Branded as Ridgeline Home Exteriors only.

## Cover email

- Short and first person ("Thanks for having me out").
- One or two sentences on why the options exist.
- Point them to review and sign in the proposal.
- Don't restate the whole bid. Write the body only; JobTread supplies the subject.

## Warranty (every line description)

- **Lifetime non-transferable workmanship warranty ONLY on full installs:**
  full gutter installs, full gutter guard installs, full siding remodels, full
  soffit/fascia, full stucco/stone, permanent lighting, in-ground drain
  installs.
- **Never lifetime on:** repairs; unconventional fixes (outlet patches,
  downspout relocations, re-sloping, sealant work); gutter cleaning; tear-off;
  stucco patch/repair; foundation plaster; detach & reset; gutter cut-backs;
  anything potentially repeatable.
- **Paint:** no lifetime. Paint workmanship covers only missed coverage found
  within the first year. Standard is one coat applied in two passes unless the
  customer asks for more and it's noted before signing.
- **Manufacturer warranty:** link registration/claims on the line and state
  that registering it is the customer's responsibility. RHX doesn't cover
  manufacturer defects and charges labor on manufacturer-defect repairs.
- Standard sentence: "Covered by the Ridgeline Home Exteriors Lifetime
  Workmanship Warranty (see warranty terms)."

## Pricing rules (rates in pricing.json)

### Gutters
- Full gutter jobs per LF of gutter + downspout footage (taller downspouts
  charged for the extra footage). Retail 5" $12, 6" $15; Erick / Big West
  Roofing $7.50; other GCs $8.50; insurance about $10–10.50 for 5".
- Small-job minimum: never below $500 retail/insurance or $350 GC (Erick
  included); otherwise prorated by the customer's per-foot rate.
- Takeoff: each box miter counts as 3 ft of gutter (no miter line).
  Downspouts = 10 ft per story + 3 ft for elbows, +2 ft per offset (more for
  brick/wainscot): 1x13 one story, 1x23 two, 1x33 three.
- Gutter guards: 5" Bulldog $9.50/ft installed. Add a difficult-access charge
  (~$3/ft) for tree cover, steep grade drops or 2nd story.
- Gutter cleaning: priced per job. No warranty.

### Drainage
- In-ground drain $500 each (9x9 basin); 12x12 basin $630 offered as a choice.
- Past 8 ft from the house: +$35 per extra pipe section + $15/ft.
- Drain materials from Home Depot only. Concrete is always quoted by a sub
  first. No fixed drain price when concrete, long runs, roots or landscaping
  are involved; flag it.
- Above-ground corrugated extension: Home Depot parts + $50, rounded.

### Siding
- Per sq ft with 10% waste on material and labor; no opening deductions.
  Vinyl $9 retail / $8 GC; Ascend $12.50 / $11 (includes Ascend trim); GC
  siding generally about $12.
- Vinyl shake (Foundry 7" staggered) is much pricier; same install labor as
  vinyl.
- Board & batten / shake (LP and Hardie only): same margin as lap.
- Labor always at Alex Romero's (higher) rates, which include trim and wrap.
- Dumpster on every siding job: $500 retail/GC, $650 insurance.
- Push LP SmartSide over Hardie. Hardie jobs use genuine HardieTrim only (no
  MiraTEC, no CemPlank). Never offer ColorPlus, Diamond Kote or LP
  ExpertFinish. Make clear we use genuine premium products.
- Paint: retail = Sherwin-Williams Emerald Rain Refresh only (all Hardie jobs
  too). GC = contractor-grade, with Emerald as an upgrade. Painting is
  absorbed into the siding price; eave painting is its own line.
- Insurance: priced off the adjuster's estimate (adjusters pay about
  $6.75–7/sq ft total for vinyl). In supplements, don't include items that
  could reduce what the insurer already offered unless negligible and
  trust-building.

### Soffit & fascia (aluminum only)
- Together $25/ft retail, $22/ft GC; half for only one. Porch caps $9/sq ft.
- Fascia 6" standard; 8" and 10" white stock; 10" non-white and all 12"
  custom-bent from gutter coil (~$18/ft). Flag oversized/custom trim.

### Stucco & stone
- $10/SF retail, $8/SF GC. Small repair minimum ~$2,700. Popout cut-back $750
  per window. Repairs: no lifetime warranty, and note that stucco repairs can't
  be perfectly color-matched.

### Other
- Permanent lighting $30/ft + $500 controller, every customer type.
- Column wrap ~$250 each; beam wrap ~$250 per ~10 ft; 4x4 post wrap $200 each
  (+paint unless aluminum). Window glass: glass + $200 labor + profit, $750
  minimum. Fascia board: HD 2x6 pine $10/ft + $3/ft tear-off & install. Vinyl
  belly band ~$80 per 16 ft.
- Repairs and odd jobs are priced per job with judgment. Flag access difficulty.

### Material costs
- Primary source: LansingNow (Lansing Building Products) pricing, kept in the
  "RHX Cost Catalog Draft" sheet and the JobTread catalog.
- Ascend only from Alside; OSB and drain materials from Home Depot; paint from
  Sherwin-Williams; aluminum soffit from Alside or Mastic.
- Supplier price increases get applied to JobTread costs immediately,
  including on jobs still being estimated.
