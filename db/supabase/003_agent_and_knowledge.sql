-- MAE agent: knowledge base, run log and finding provenance.
-- Safe to re-run. Nothing here writes to benchmark_records; the policy loader reads it.

-- ------------------------------------------------------------------ knowledge base
-- The citable corpus, carried over with its provenance. Verification status is the
-- point of this table: the agent may ground a claim only on an approved chunk.
create table if not exists public.app_policy_chunks (
  id                   text primary key,
  title                text not null,
  text                 text not null,
  url                  text,
  source_class         text,
  issuing_authority    text,
  jurisdiction         text,
  binding_status       text,
  verification_status  text not null,
  approved_for_answers boolean not null default false,
  last_verified        date,
  response_constraints text,
  supported_questions  text,
  word_count           int,
  loaded_at            timestamptz not null default now()
);
create index if not exists app_policy_chunks_approved_idx
  on public.app_policy_chunks(approved_for_answers, verification_status);

-- Deterministic lookup: a WCAG criterion or a topic key → the chunks that cover it.
-- With a corpus this small, a lookup table beats vector search: it is reproducible,
-- and a reviewer can see exactly why a chunk was put in front of the model.
create table if not exists public.app_citation_map (
  key      text not null,
  chunk_id text not null references public.app_policy_chunks(id) on delete cascade,
  note     text,
  primary key (key, chunk_id)
);

-- ------------------------------------------------------------------ agent run log
create table if not exists public.app_agent_runs (
  id             text primary key,
  task           text not null check (task in ('build_scan', 'ticket_batch', 'policy_question')),
  status         text not null default 'running'
                 check (status in ('running', 'succeeded', 'failed', 'halted')),
  scan_id        text references public.app_scans(id) on delete set null,
  requested_by   text not null,
  provider       text not null default 'mock-deterministic',
  model          text not null default 'meridian-remediator-v1',
  prompt_version text not null default 'agent-v1',
  step_cap       int not null default 60,
  steps_used     int not null default 0,
  tool_calls     int not null default 0,
  findings_drafted int not null default 0,
  escalations    int not null default 0,
  guard_rejections int not null default 0,
  halt_reason    text,
  summary        jsonb,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists app_agent_runs_started_idx on public.app_agent_runs(started_at desc);

-- One row per step, so a run replays: plan, each tool call, each model output, each
-- guard verdict, and what a human did next.
create table if not exists public.app_agent_steps (
  id          text primary key,
  run_id      text not null references public.app_agent_runs(id) on delete cascade,
  seq         int not null,
  phase       text not null check (phase in ('plan', 'test', 'diagnose', 'remediate', 'guard', 'write')),
  actor       text not null,
  tool        text,
  summary     text not null,
  input       jsonb,
  output      jsonb,
  verdict     text not null default 'ok' check (verdict in ('ok', 'rejected', 'escalated', 'skipped', 'error')),
  message     text,
  duration_ms int not null default 0,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);
create index if not exists app_agent_steps_run_idx on public.app_agent_steps(run_id, seq);

-- ------------------------------------------------------------------ finding provenance
alter table public.app_findings add column if not exists origin text not null default 'seed';
alter table public.app_findings add column if not exists agent_run_id text;
alter table public.app_findings add column if not exists jira_key text;
alter table public.app_findings add column if not exists jira_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_findings_origin_check') then
    alter table public.app_findings
      add constraint app_findings_origin_check check (origin in ('seed', 'agent', 'manual'));
  end if;
end $$;

-- An agent writes drafts, never live findings: 'agent_draft' is a state before 'open',
-- and only a person moves a record out of it.
do $$
begin
  alter table public.app_findings drop constraint if exists app_findings_status_check;
  alter table public.app_findings add constraint app_findings_status_check check (status in (
    'agent_draft', 'open', 'in_review', 'awaiting_compliance', 'held_for_expert_review',
    'remediation_in_progress', 'ready_for_verification', 'verified', 'rejected'));
end $$;

-- ------------------------------------------------------------------ loader
-- Copies the policy corpus out of the benchmark data, keeping provenance intact.
create or replace function public.app_load_policy_chunks()
returns int language plpgsql set search_path = public as $load$
declare n int;
begin
  insert into public.app_policy_chunks (
    id, title, text, url, source_class, issuing_authority, jurisdiction, binding_status,
    verification_status, approved_for_answers, last_verified, response_constraints,
    supported_questions, word_count)
  select
    b.record->>'chunk_id',
    coalesce(b.record->>'title', b.record->>'chunk_id'),
    coalesce(b.record->>'text', ''),
    nullif(coalesce(b.record->>'primary_url', b.record->>'url'), ''),
    nullif(b.record->>'source_class', ''),
    nullif(b.record->>'issuing_authority', ''),
    nullif(b.record->>'jurisdiction', ''),
    nullif(b.record->>'binding_status', ''),
    coalesce(nullif(b.record->>'verification_status', ''), 'source_unverified'),
    coalesce(b.record->>'approved_for_policy_answer_training', 'N') = 'Y',
    nullif(b.record->>'last_verified', '')::date,
    nullif(b.record->>'response_constraints', ''),
    nullif(b.record->>'supported_question_types', ''),
    nullif(b.record->>'word_count', '')::numeric::int
  from public.benchmark_records b
  where b.table_name = 'policy_corpus'
  on conflict (id) do update set
    title = excluded.title, text = excluded.text, url = excluded.url,
    source_class = excluded.source_class, issuing_authority = excluded.issuing_authority,
    jurisdiction = excluded.jurisdiction, binding_status = excluded.binding_status,
    verification_status = excluded.verification_status,
    approved_for_answers = excluded.approved_for_answers,
    last_verified = excluded.last_verified,
    response_constraints = excluded.response_constraints,
    supported_questions = excluded.supported_questions,
    word_count = excluded.word_count, loaded_at = now();
  get diagnostics n = row_count;

  -- WCAG criteria read straight out of the chunk titles ("WCAG 1.4.3 Contrast …").
  insert into public.app_citation_map (key, chunk_id, note)
  select m.crit, c.id, 'criterion in chunk title'
  from public.app_policy_chunks c,
       lateral (select unnest(regexp_matches(c.title, '(\d\.\d\.\d+)', 'g')) as crit) m
  on conflict do nothing;

  -- Topics that are not a WCAG criterion. The agent is handed these for context; the
  -- unapproved ones can never be the sole support for a claim (checked in the guard).
  insert into public.app_citation_map (key, chunk_id, note) values
    ('topic:liveness', 'P003', 'RBI KYC amendment, verified primary'),
    ('topic:liveness', 'P001', 'Supreme Court order, parties and date verified'),
    ('topic:liveness', 'P002', 'directions summary, secondary source'),
    ('topic:language_coverage', 'P013', 'KFS language obligation, not read at source'),
    ('topic:language_coverage', 'P014', 'DPDP notice language, unverified'),
    ('topic:language_coverage', 'P047', 'proposed internal rule'),
    ('topic:language_coverage', 'P028', 'WCAG 3.1.1/3.1.2: marking language, not translating'),
    ('topic:tap_target', 'P026', 'WCAG 2.2 2.5.8, 24 px minimum'),
    ('topic:tap_target', 'P033', 'WCAG 2.1 2.5.5, AAA'),
    ('topic:tap_target', 'P027', 'Android 48 dp guidance, secondary source'),
    ('topic:reading_level', 'P032', 'WCAG 3.1.5, AAA'),
    ('topic:reading_level', 'P042', 'proposed regulated-content rule'),
    ('topic:authentication', 'P034', 'W3C Understanding 3.3.8, verification codes'),
    ('topic:authentication', 'P030', 'WCAG 3.3.7 and 3.3.8 with exceptions'),
    ('topic:authentication', 'P016', 'RBI authentication directions, secondary source'),
    ('topic:severity', 'P040', 'proposed severity definitions'),
    ('topic:priority', 'P044', 'proposed priority score'),
    ('topic:escalation', 'P046', 'proposed human escalation rule')
  on conflict do nothing;

  return n;
end $load$;

revoke all on function public.app_load_policy_chunks() from public, anon, authenticated;
grant execute on function public.app_load_policy_chunks() to service_role;

-- ------------------------------------------------------------------ lock down
do $$
declare t text;
begin
  foreach t in array array['app_policy_chunks', 'app_citation_map', 'app_agent_runs', 'app_agent_steps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

select public.app_load_policy_chunks();
