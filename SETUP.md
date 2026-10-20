# Running the Meridian prototype against your Supabase project

The prototype no longer keeps anything in memory. Every scan, finding, review decision and
verification run is a row in Postgres, read and written through server functions. Two things
have to be in place: the tables, and the server-side key.

Project used throughout: `https://vpehdvjftwxyfkuuvbfs.supabase.co` (the one that already
holds MAE Golden Set v0.1 in `benchmark_records`). Nothing here touches that table.

**Already applied on 20 Oct 2026** to `vpehdvjftwxyfkuuvbfs`: the schema, the seed and the
read-only golden-set RPCs. `.env` holds the key and the connection string. Steps 1 and 2 are
here for a rebuild, or for a second environment.

## 1. Create the tables and seed the MVP scenario

Either run them from the command line:

```
node scripts/apply_sql.mjs db/supabase/001_app_schema.sql db/supabase/002_seed_mvp_scenario.sql db/mae/001_mae_readonly_rpcs.sql
```

(`DATABASE_URL` comes from `.env`; it is used only for DDL and never by the running app.)

Or, in the Supabase dashboard → **SQL Editor**, run these two files in order:

1. `db/supabase/001_app_schema.sql` — twelve `app_*` tables, the check constraints, the
   verified-only-by-a-human triggers, RLS on with no anon or authenticated access.
2. `db/supabase/002_seed_mvp_scenario.sql` — `app_seed_demo()` and `app_reset_demo()`,
   then seeds scan `scn-2001` with the eight MAE Golden Set v0.1 findings.

Both are safe to re-run. `002` is generated from `src/domain/fixtures.ts`; if the scenario
changes, run `node scripts/gen_seed_sql.mjs` and apply it again. It also defines
`app_reset_demo()`, which the Settings page calls — its deletes carry `where true` because
Supabase runs API statements with `sql_safe_updates` on.

Optional, for the Benchmark Dataset page: `db/mae/001_mae_readonly_rpcs.sql` (counts and
column names only, no record contents).

## 2. Add the server-side key

In `.env` (already gitignored, never shipped to the browser):

```
MAE_SUPABASE_URL="https://vpehdvjftwxyfkuuvbfs.supabase.co"
MAE_SUPABASE_SECRET_KEY="<Project Settings → API keys → secret / service_role>"
```

Restart the dev server after changing `.env`.

## 3. Run it

```
npm install
npx vite dev        # http://localhost:8080
npx vitest run      # unit tests
```

If the key is missing or the tables are not there yet, every page says so at the top
instead of failing silently.

## What is real and what is simulated

Real: the database, the workflow state machine, role rules, the review and verification
audit trail, the deterministic scan worker (it writes new finding rows), the reset.

Simulated and labelled as such in the UI: the detection engines (no live accessibility
scanner runs). Every finding is a synthetic MAE Golden Set v0.1 record and no label has
been reviewed by a human.

The agent's Diagnoser and Remediator call Gemini when `GEMINI_API_KEY` is set, and fall
back to rule-backed text when it is not. Each run records its `provider` and `model`, and
each step records why it fell back, so model output is never mistaken for rule output.
The model writes the narrative and the fix; it never sets the finding type, the criteria,
the severity, the confidence or the gate — those come from the deterministic rule engine,
which is what keeps the over-claim rate meaningful.

## Prototype boundary worth knowing before anyone demos it

There is no sign-in. The acting identity and role are chosen on the Settings page and sent
to the server with each action, where the same role rules are re-checked. That is enough to
demonstrate "humans decide", but it is not authorization: a real deployment needs Supabase
Auth plus a `user_roles` table, and the RLS policies to match. The `verified` guard does not
depend on it — the database refuses to mark a finding verified without a passing run
recorded against a non-AI name, whatever the caller claims.
