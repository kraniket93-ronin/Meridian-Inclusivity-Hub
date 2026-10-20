# Meridian Inclusive Access Agent (internal MVP prototype)

Internal accessibility-management tool for the HashedIn by Deloitte case *Architecting
Access*. It is the governance surface of the Meridian Access Engine (MAE): findings arrive
from a scan, a human reviews them, a squad remediates, a named person verifies the fix.

**Working prototype, not a mock-up.** Every scan, finding, review decision, model run and
verification record is a row in Supabase Postgres, written through TanStack Start server
functions. Reload the page, or open it on another machine, and the state is still there.

**Not published. Not a compliance certification. It never blocks a release.** All eight
seeded findings are synthetic records from MAE Golden Set v0.1 and no label has been
reviewed by a human.

Setup (SQL files, keys, commands): see [SETUP.md](SETUP.md).

## Pages

Dashboard · Scans · Scan detail · Findings Inbox · Finding detail · Review Queue ·
Verification · Evaluation · Benchmark Dataset · Settings.

The hero screen is **Finding detail**. In order: what is wrong, *is this a WCAG failure?*,
the gate recommendation (with the reminder that a human decides), evidence, who is
affected, confidence and any abstention reason, the suggested fix, the verification steps,
the policy sources with their verification badges, and the activity trail.

## The eight findings, and why they are not all WCAG failures

| Finding | Type | Verdict |
|---|---|---|
| FND-0048 OTP boxes unlabelled, focus jumps | WCAG failure (1.3.1, 4.1.2, 2.4.3) | Recommend block — a human decides |
| FND-0141 Status change not announced | WCAG failure (4.1.3) | Advisory |
| FND-0199 Error message does not explain the problem | WCAG failure (3.3.1, 3.3.3) | Advisory |
| FND-0020 Liveness relies only on blinking | Policy risk | Escalate to Compliance |
| FND-0067 Regulated declaration in English only | Language inclusion | Escalate to Compliance |
| FND-0099 Declaration text too complex | Cognitive load (3.1.5, AAA) | Advisory |
| FND-0223 Touch target 38 dp | Usability, outside the AA baseline | Advisory |
| FND-0297 Contrast 3.4:1 | Needs expert review | Hold for expert review |

Five of the eight are what a WCAG checklist either misses or would wrongly call a
violation. That is the case's central argument, made in data rather than in a slide.

## Safety invariants

- **AI never verifies anything.** A finding reaches `verified` only from
  `ready_for_verification`, and only when a passing verification run recorded against a
  non-AI name exists. Enforced in `src/domain/workflow.ts`, re-checked in the server
  function, and finally in the database (`app_findings_verified_guard`,
  `app_verification_human_guard`) — the last one holds even if the app is bypassed.
- **The model may only suggest.** The LLM output schema is `.strict()` and has no status
  field; suggestions are stored separately and labelled "Suggested — never auto-applied".
- **Low confidence must say why.** A database constraint rejects a low-confidence finding
  with no abstention reason.
- **Policy, language and expert-review findings always require human review**, and so does
  any block recommendation — also database constraints.
- Rejecting a finding needs a reason code; every decision is written under the acting
  identity, never a typed-in name.

## Architecture

- `src/domain/types.ts` · `workflow.ts` — the finding model, the state machine, role rules,
  the deterministic rule picker.
- `src/domain/data.functions.ts` — server functions: the only place that reads or writes
  the database. The secret key is loaded inside the handlers.
- `src/integrations/supabase/mae-app.server.ts` — server-only Supabase client.
- `src/domain/mappers.ts` — row ↔ domain mapping, the only place that knows column names.
- `src/domain/store.ts` — `useDb(selector)` backed by TanStack Query, plus `useService()`
  for the mutations. Pages did not need to know the data moved to Postgres.
- `src/lib/ai/recommendation.functions.ts` — the LLM adapter contract with a deterministic
  mock provider; a real provider is selected only when `LLM_API_KEY` is set.
- `db/supabase/` — schema and the generated seed. `db/mae/` — read-only golden-set RPCs.
- `scripts/gen_seed_sql.mjs` — regenerates the seed from `src/domain/fixtures.ts`.

## Tests

`npx vitest run` — 21 tests. `src/domain/scenario.test.ts` is the build spec's acceptance
checklist as code: the eight records, the three "Yes" verdicts, the 38 dp callout, the
abstention reason, the Compliance routing, and that nothing starts out verified.

## Brand

HashedIn orange `#F47920` accent on a deep navy primary, accessible neutral surfaces,
visible focus rings throughout. The tool's own UI is built to WCAG 2.1 AA.
