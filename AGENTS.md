<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- External MAE dataset is read only via server functions + service_role-only SQL RPCs; never query its tables from the browser (tables have no anon/authenticated access).
- **Superseded on 20 Oct 2026, by the project owner's instruction.** The app's own data now
  lives in the same Supabase project as the benchmark data (`vpehdvjftwxyfkuuvbfs`), in
  tables prefixed `app_`, applied from `db/supabase/`. The earlier rule — Lovable Cloud owns
  the app's audit data, the benchmark project is read-only — no longer holds. `benchmark_records`
  and `dataset_import_runs` are still never written to, and the `app_` prefix keeps the two
  apart. If the app's data is ever moved back to a Lovable Cloud project, restore the old rule.
- Everything still goes through server functions with the project's secret key: no browser
  reaches these tables (RLS on, no anon or authenticated policies), and no secret is ever
  exposed to the client bundle.
