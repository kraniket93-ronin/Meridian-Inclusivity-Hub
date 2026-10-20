-- Aggregation for the agent's tools, done in Postgres rather than in the app.
-- Pulling 12,000 session rows over the API to count them would be slow and would put
-- per-customer rows in front of the agent; these functions return aggregates only.
-- Safe to re-run.

-- Journeys and platforms available to plan against (MVP journeys only).
create or replace function public.app_journey_catalog()
returns jsonb language sql stable set search_path = public as $$
  with s as (
    select distinct
      record->>'journey'  as journey,
      record->>'platform' as platform,
      record->>'step_no'  as step_no,
      record->>'build_id' as build_id
    from public.benchmark_records
    where table_name = 'screens' and record->>'mvp_journey' = 'Y'
  )
  select jsonb_build_object(
    'journeys', (select coalesce(jsonb_agg(j), '[]'::jsonb) from (
        select jsonb_build_object('journey', journey, 'steps', count(distinct step_no)) j
        from s group by journey order by journey) x),
    'platforms', (select coalesce(jsonb_agg(distinct platform), '[]'::jsonb) from s),
    'builds',    (select coalesce(jsonb_agg(distinct build_id), '[]'::jsonb) from s)
  )
$$;

-- Aggregate ticket and session signals for one journey step.
-- Minimum group size 30: below it, shares are withheld rather than reported.
create or replace function public.app_signal_summary(p_journey text, p_step int default null)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select record from public.benchmark_records
    where table_name = 'tickets'
      and record->>'mapped_journey' = p_journey
      -- step numbers arrive as '7.0', so they are read as numeric, not as an integer string
      and (p_step is null or ((record->>'mapped_step_no') ~ '^\d+(\.\d+)?$'
           and (record->>'mapped_step_no')::numeric::int = p_step))
  ),
  s as (
    select record from public.benchmark_records
    where table_name = 'sessions' and record->>'journey' = p_journey
  ),
  sr as (
    select
      count(*) filter (where coalesce(record->>'assistive_tech', 'none') <> 'none') as sr_n,
      count(*) filter (where coalesce(record->>'assistive_tech', 'none') <> 'none'
                         and record->>'abandoned' = 'Y')                            as sr_abandon,
      count(*) filter (where coalesce(record->>'assistive_tech', 'none') =  'none') as other_n,
      count(*) filter (where coalesce(record->>'assistive_tech', 'none') =  'none'
                         and record->>'abandoned' = 'Y')                            as other_abandon,
      count(*)                                                                      as total_n,
      count(*) filter (where (record->>'abandon_step') ~ '^\d+(\.\d+)?$'
                         and (record->>'abandon_step')::numeric::int = p_step)      as abandoned_here
    from s
  ),
  tk as (
    select
      count(*)                                                                  as n,
      count(*) filter (where record->>'is_accessibility_related' = 'Y')         as a11y,
      count(*) filter (where record->>'unable_unassisted' = 'Y')                as unable,
      count(*) filter (where record->>'is_60_plus' = 'Y')                       as seniors
    from t
  ),
  barriers as (
    select jsonb_agg(jsonb_build_object('barrier', barrier, 'count', n) order by n desc) b
    from (
      select record->>'barrier_type' barrier, count(*) n
      from t
      where coalesce(record->>'barrier_type', '') not in ('', 'none')
      group by 1 order by 2 desc limit 3
    ) x
  )
  select jsonb_build_object(
    'journey', p_journey,
    'stepNo', p_step,
    'tickets', tk.n,
    'accessibilityRelated', tk.a11y,
    'unableUnassisted', tk.unable,
    'seniorShare', case when tk.n >= 30 then round((tk.seniors::numeric / tk.n) * 1000) / 10 end,
    'topBarriers', coalesce(barriers.b, '[]'::jsonb),
    'sessions', sr.total_n,
    'abandonedAtStep', sr.abandoned_here,
    'screenReaderAbandonRate',
      case when sr.sr_n >= 30 then round((sr.sr_abandon::numeric / sr.sr_n) * 1000) / 10 end,
    'otherAbandonRate',
      case when sr.other_n >= 30 then round((sr.other_abandon::numeric / sr.other_n) * 1000) / 10 end,
    'suppressed', tk.n < 30
  )
  from tk, sr, barriers
$$;

revoke all on function public.app_journey_catalog(), public.app_signal_summary(text, int)
  from public, anon, authenticated;
grant execute on function public.app_journey_catalog(), public.app_signal_summary(text, int) to service_role;
