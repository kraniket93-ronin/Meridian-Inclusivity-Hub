-- Meridian Inclusive Access Agent — application schema (prototype, real persistence).
-- Target: the project that already holds MAE Golden Set v0.1 (benchmark_records).
-- Safe to re-run: every object is created with "if not exists" / "or replace".
-- Nothing here touches benchmark_records or dataset_import_runs.
--
-- Safety invariant, enforced in the database, not only in the UI:
--   a finding reaches 'verified' only from 'ready_for_verification' AND only when a
--   passing verification run recorded by a named human exists. No AI actor can do it.
--
-- Access model: these tables are read and written by the app's server functions using
-- the project's secret (service_role) key. RLS is enabled with no anon/authenticated
-- policies, so the browser cannot reach them directly.

-- ---------------------------------------------------------------- projects / scans
create table if not exists public.app_projects (
  id          text primary key,
  name        text not null,
  base_url    text not null,
  owner       text not null default '',
  journeys    jsonb not null default '[]'::jsonb,
  platforms   text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.app_scans (
  id           text primary key,
  project_id   text not null references public.app_projects(id) on delete cascade,
  target_url   text not null,
  scope        text not null default '',
  status       text not null default 'queued' check (status in ('queued','running','completed','failed')),
  engines      text[] not null default '{}',
  is_simulated boolean not null default true,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists app_scans_project_idx on public.app_scans(project_id, created_at desc);

create table if not exists public.app_scan_jobs (
  id         text primary key,
  scan_id    text not null references public.app_scans(id) on delete cascade,
  status     text not null default 'queued' check (status in ('queued','claimed','running','succeeded','failed')),
  attempts   int not null default 0 check (attempts >= 0),
  progress   int not null default 0 check (progress between 0 and 100),
  error      text,
  updated_at timestamptz not null default now()
);
create index if not exists app_scan_jobs_scan_idx on public.app_scan_jobs(scan_id);

-- ---------------------------------------------------------------- policy sources
create table if not exists public.app_policy_sources (
  id     text primary key,
  title  text not null,
  status text not null check (status in ('verified','partially_verified','unverified','proposed_internal'))
);

-- ---------------------------------------------------------------- findings
create table if not exists public.app_findings (
  id                     text primary key,
  scan_id                text not null references public.app_scans(id) on delete cascade,
  golden_set_id          text not null,
  rule_id                text not null,
  title                  text not null,
  description            text,
  callout                text,
  extra_note             text,
  journey                text not null check (journey in ('onboarding','dispute_filing')),
  step_no                int not null,
  step_name              text not null,
  platform               text not null check (platform in ('android','ios','web')),
  screen_id              text not null,
  finding_type           text not null check (finding_type in (
                           'wcag_failure','accessibility_usability_issue','cognitive_load_issue',
                           'language_inclusion_issue','banking_policy_violation','needs_expert_review')),
  wcag                   text not null default '',
  wcag_criteria          text[],
  wcag_version           text,
  conformance_level      text check (conformance_level in ('A','AA','AAA','A/AA')),
  baseline_status        text not null check (baseline_status in (
                           'in_baseline_2.1_AA','supplemental_2.2','aaa_best_practice',
                           'outside_AA_baseline','outside_wcag')),
  severity               text not null check (severity in ('critical','high','medium','low')),
  confidence             text not null check (confidence in ('high','medium','low')),
  abstention_reason      text,
  evidence               text not null,
  node_ids               text[],
  simulation_trace       text,
  affected_user_need     text not null,
  user_impact            text not null check (user_impact in ('task_blocked','task_slowed')),
  affected_groups        text[] not null default '{}',
  recommended_fix        text not null,
  fix_rationale          text not null default '',
  verification_steps     text not null,
  gate_recommendation    text not null check (gate_recommendation in (
                           'advisory','hold_for_expert_review','escalate_to_compliance',
                           'recommend_block_pending_human')),
  requires_human_review  boolean not null default true,
  escalate_to            text not null check (escalate_to in ('Owning squad','Accessibility specialist','Compliance')),
  priority_score         numeric(6,2) not null default 0,
  priority_band          text not null check (priority_band in ('P1','P2','P3')),
  status                 text not null default 'open' check (status in (
                           'open','in_review','awaiting_compliance','held_for_expert_review',
                           'remediation_in_progress','ready_for_verification','verified','rejected')),
  assignee               text,
  selector               text not null default '',
  page_url               text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- an abstention reason is required whenever the evidence is weak
  constraint app_findings_low_confidence_needs_reason
    check (confidence <> 'low' or (abstention_reason is not null and length(btrim(abstention_reason)) > 0)),
  -- the types a human must decide can never be auto-closed by the agent
  constraint app_findings_human_review_required
    check (requires_human_review
           or finding_type not in ('needs_expert_review','banking_policy_violation','language_inclusion_issue')),
  constraint app_findings_block_needs_review
    check (requires_human_review or gate_recommendation <> 'recommend_block_pending_human')
);
create index if not exists app_findings_scan_idx on public.app_findings(scan_id);
create index if not exists app_findings_status_idx on public.app_findings(status, severity);

create table if not exists public.app_finding_policy_sources (
  finding_id       text not null references public.app_findings(id) on delete cascade,
  policy_source_id text not null references public.app_policy_sources(id) on delete restrict,
  position         int not null default 0,
  primary key (finding_id, policy_source_id)
);

create table if not exists public.app_evidence (
  id         text primary key,
  finding_id text not null references public.app_findings(id) on delete cascade,
  kind       text not null check (kind in ('dom_snippet','contrast_sample','screenshot')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists app_evidence_finding_idx on public.app_evidence(finding_id);

-- ---------------------------------------------------------------- model output (advisory only)
create table if not exists public.app_model_runs (
  id             text primary key,
  finding_id     text not null references public.app_findings(id) on delete cascade,
  provider       text not null,
  model          text not null,
  status         text not null check (status in ('succeeded','failed_validation','failed')),
  latency_ms     int not null check (latency_ms >= 0),
  prompt_version text not null,
  created_at     timestamptz not null default now()
);
create index if not exists app_model_runs_finding_idx on public.app_model_runs(finding_id);

create table if not exists public.app_recommendations (
  id           text primary key,
  finding_id   text not null references public.app_findings(id) on delete cascade,
  model_run_id text not null,
  summary      text not null,
  proposed_fix text not null,
  rationale    text not null,
  confidence   numeric(3,2) not null check (confidence between 0 and 1),
  policy_refs  text[] not null check (cardinality(policy_refs) >= 1),
  created_at   timestamptz not null default now()
);
create index if not exists app_recommendations_finding_idx on public.app_recommendations(finding_id);

-- ---------------------------------------------------------------- human decisions
create table if not exists public.app_review_tasks (
  id            text primary key,
  finding_id    text not null references public.app_findings(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer      text,
  decision_note text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  check ((status = 'pending') = (decided_at is null))
);
create index if not exists app_review_tasks_status_idx on public.app_review_tasks(status);

create table if not exists public.app_verification_runs (
  id          text primary key,
  finding_id  text not null references public.app_findings(id) on delete cascade,
  method      text not null check (method in ('manual','automated_rescan','assistive_tech')),
  result      text not null check (result in ('pass','fail')),
  verified_by text not null,
  notes       text not null check (length(btrim(notes)) >= 5),
  created_at  timestamptz not null default now()
);
create index if not exists app_verification_runs_finding_idx
  on public.app_verification_runs(finding_id, created_at desc);

create table if not exists public.app_audit_events (
  id         text primary key,
  actor      text not null,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  created_at timestamptz not null default now()
);
create index if not exists app_audit_events_entity_idx on public.app_audit_events(entity, entity_id);

-- ---------------------------------------------------------------- safety invariants
create or replace function public.app_is_ai_actor(_actor text)
returns boolean language sql immutable set search_path = public as $$
  select btrim(lower(coalesce(_actor, ''))) = any (array['ai','llm','model','agent','system','mae','mae agent'])
$$;

-- A verification run must name a human.
create or replace function public.app_enforce_human_verifier()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.app_is_ai_actor(new.verified_by) then
    raise exception 'A human verifier is required; AI actors cannot verify a fix';
  end if;
  return new;
end $$;

drop trigger if exists app_verification_human_guard on public.app_verification_runs;
create trigger app_verification_human_guard before insert or update on public.app_verification_runs
  for each row execute function public.app_enforce_human_verifier();

-- 'verified' requires a passing human verification run, from the right previous status.
create or replace function public.app_enforce_verified_requires_evidence()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    if old.status <> 'ready_for_verification' then
      raise exception 'Finding must be ready_for_verification first (was %)', old.status;
    end if;
    if not exists (
      select 1 from public.app_verification_runs v
      where v.finding_id = new.id and v.result = 'pass' and not public.app_is_ai_actor(v.verified_by)
    ) then
      raise exception 'A passing human verification run is required';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists app_findings_verified_guard on public.app_findings;
create trigger app_findings_verified_guard before update on public.app_findings
  for each row execute function public.app_enforce_verified_requires_evidence();

-- ---------------------------------------------------------------- lock the tables down
do $$
declare t text;
begin
  foreach t in array array[
    'app_projects','app_scans','app_scan_jobs','app_policy_sources','app_findings',
    'app_finding_policy_sources','app_evidence','app_model_runs','app_recommendations',
    'app_review_tasks','app_verification_runs','app_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
