# Lead Hammer → JobTread estimator plan

Goal: from a lead in Lead Hammer, tap **Start Estimate**, answer a short
questionnaire, and get a drafted JobTread estimate priced the way Ridgeline
Home Exteriors prices work. **Nothing is ever sent to a customer without
Sean's explicit OK.**

## Pieces

1. **Estimate basics** (done, PR #132) — owner-only questions on every lead:
   address, customer type, work needed, stories, existing exterior,
   measurements, timeline (+ optional HOA, year built, budget, notes).
   `shared/estimateBasics.js`.
2. **Customer sync** (this PR) — Start Estimate creates the JobTread
   customer (or reuses one matching phone/email), location and job
   (Status: Estimating, basics in the description). `server/src/jobtread.js`,
   `POST /api/leads/:id/start-estimate`. Safe to tap again; partial failures
   resume instead of duplicating.
3. **Trade questionnaire** (next) — only the questions for the trades picked
   in the basics, mapped to the JobTread catalog assemblies' parameters
   (e.g. Seamless Gutter System: Gutter LF, downspouts by story, offsets,
   miters, tear-off LF; LP/Hardie/vinyl/Ascend siding: wall SF, trim, corners,
   tear-off type, cut-up walls, wrap). Prefilled from Lead Hammer Measure
   reports when available.
4. **Draft estimate** (next) — server copies the matching catalog assemblies
   onto the job's estimate with the answers as parameters, adds good/better/
   best upgrades as optional selections, and uses Claude
   (ANTHROPIC_API_KEY) for scope wording and sanity checks. Enforces rules
   JobTread formulas can't: $350 gutter minimum, $3,000 stucco repair
   minimum, Emerald only on retail, contractor-grade paint on GC jobs.
5. **Review & send** — Lead Hammer shows the draft summary and a link to it in
   JobTread. Sending stays a manual step for Sean.

## Product rules the estimator must follow

- Push LP SmartSide over Hardie; Hardie trim only on Hardie jobs; never
  MiraTEC, CemPlank, ColorPlus, Diamond Kote or LP ExpertFinish.
- Insulated reflective house wrap offered as a premium upgrade.
- Paint: one full coat applied in two passes unless the customer asks for more
  and it's noted before signing.
- Lifetime workmanship warranty (non-transferable); paint covers missed
  coverage reported within 1 year; manufacturer defects not covered.

## Config

- `JOBTREAD_GRANT_KEY` — grant scoped to Ridgeline Home Exteriors only.
- `ANTHROPIC_API_KEY` — already set.
