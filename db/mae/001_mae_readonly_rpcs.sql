-- MAE Golden Set v0.1 — additive, read-only RPCs for the Meridian app.
-- Run MANUALLY in the external project (vpehdvjftwxyfkuuvbfs) SQL editor. Not auto-deployed.
-- Creates functions only; no table, policy, grant-on-table or data changes.
-- Exposes aggregates and schema metadata ONLY. No record payloads (`record` JSONB),
-- no record_id/group_id lists, and no sample retrieval — sample access stays disabled until
-- the source payload and ground-truth fields are reliably identified.
-- Executable only by service_role (called server-side). anon/authenticated: no access.

-- Aggregate status. Uses physical columns of benchmark_records; split info for the
-- manifest comes from record->>'split' on rows where table_name = 'split_manifest'.
create or replace function public.mae_dataset_status(p_version text default 'MAE_Golden_Set_v0.1')
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (select * from public.benchmark_records where dataset_version = p_version)
  select jsonb_build_object(
    'version', p_version,
    'total', (select count(*) from b),
    'by_table', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
      (select coalesce(table_name, 'unspecified') k, count(*) n from b group by 1) x),
    'by_split_name', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
      (select coalesce(split_name, 'unspecified') k, count(*) n from b group by 1) x),
    'manifest_by_split', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
      (select coalesce(record->>'split', 'unspecified') k, count(*) n
         from b where table_name = 'split_manifest' group by 1) x),
    'by_review_status', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
      (select coalesce(review_status, 'unspecified') k, count(*) n from b group by 1) x),
    'by_label_provenance', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from
      (select coalesce(label_provenance, 'unspecified') k, count(*) n from b group by 1) x),
    'human_validated', (select count(*) from b where human_validated is true),
    'last_imported_at', (select max(imported_at) from b),
    -- Schema-agnostic: only a row count for dataset_import_runs, no row contents.
    'import_runs', (select count(*) from public.dataset_import_runs)
  )
$$;

-- Column inventory (metadata only, no data).
create or replace function public.mae_table_inventory()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type)
    order by table_name, ordinal_position), '[]'::jsonb)
  from information_schema.columns
  where table_schema = 'public' and table_name in ('benchmark_records', 'dataset_import_runs')
$$;

revoke all on function public.mae_dataset_status(text) from public, anon, authenticated;
revoke all on function public.mae_table_inventory() from public, anon, authenticated;
grant execute on function public.mae_dataset_status(text), public.mae_table_inventory() to service_role;

-- Rollback:
-- drop function if exists public.mae_dataset_status(text);
-- drop function if exists public.mae_table_inventory();
