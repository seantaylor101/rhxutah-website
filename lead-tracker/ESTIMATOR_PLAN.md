# Lead Hammer → JobTread estimator

From a lead in Lead Hammer: tap **Start Estimate**, answer the trade
questions, and get a draft JobTread Proposal priced the way Ridgeline Home
Exteriors prices work. **Nothing is ever sent to a customer without Sean
approving that specific proposal.**

## Single source of truth: `estimating/`

| File | What's in it |
|---|---|
| `rules.md` | The estimating rules in plain English: workflow, options, proposal format, cover email, warranty, pricing rules. Claude's draft review reads it word for word. |
| `pricing.json` | Every rate as data (gutters, guards, repairs, drains, siding, soffit/fascia, stucco, painting, lighting, tax, rounding). **Change prices here, not in code.** |
| `jobtread.json` | JobTread org, cost type, unit, cost code, assembly and template IDs, and the Proposal defaults. |
| `wording.json` | Line wording, warranty sentences, manufacturer notes. |
| `index.js` | Loads and validates all of it. A missing rate fails at startup (and in tests). |

Costs still come live from the JobTread catalog assemblies, so supplier price
changes flow into new drafts.

## Flow

1. **Estimate basics** (`shared/estimateBasics.js`): customer type, work,
   stories, existing exterior, measurements, timeline, address. Required
   before Start Estimate.
2. **Start Estimate** (`server/src/jobtread.js`): creates the JobTread
   customer, contact, location and job only now, not when the lead is logged.
   - Duplicate guard: a phone/email match is reused automatically.
   - A same-name or same-street customer stops and shows Sean the matches
     ("Use this customer" or "Create new customer").
   - Safe to tap again.
3. **Trade questions** (`shared/tradeQuestions.js`): per trade, including
   gutter color, repair/odd-job lines from presets, and good/better/best gutter
   guard options (footage, difficult access, reason, recommended).
4. **Draft** (`server/src/estimateDraft.js`): one **installed** line per item
   (material + labor combined, cost type Other) on every proposal.
   - Prices come from `pricing.json`, rounded to $0.25 per unit or $5 lump.
   - Lifetime warranty appears only on full installs.
   - Option sets use a min 0 / max 1 parent with the recommended option
     pre-selected.
   - Tax is 7.45% on insurance proposals only, 0 on retail and GC.
5. **Review** (`server/src/estimateReview.js`): past pricing for the same
   lines from JobTread history, plus Claude checking the draft and email
   against `rules.md`. It only flags problems and never changes prices.
6. **Approve & send** (`server/src/proposalSend.js`):
   - Lead Hammer shows the exact recipient, message, attachments and total.
   - Sean can edit the message, then approves.
   - The server refuses the send if anything changed since he approved.
   - After sending, it sets the Proposal to **pending** (the API send leaves
     it draft, so the customer couldn't sign) and reads back the email
     delivery status.

Reference job for testing: Scott Peterson, JobTread #492. The tests rebuild it
exactly ($1,060 base; Option A $2,464; Option B $1,820; no tax).

## Config

- `JOBTREAD_GRANT_KEY`: grant scoped to Ridgeline Home Exteriors only.
- `ANTHROPIC_API_KEY`: the rule review. Without it the review is skipped and
  drafting still works.
