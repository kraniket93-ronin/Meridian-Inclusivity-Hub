-- Meridian Inclusive Access Agent — schema, constraints, RLS, role checks.
-- Apply once Lovable Cloud is enabled. Invariant: a finding becomes 'verified' only
-- with a passing, human-recorded verification_run. AI never changes finding status.

create type public.app_role as enum ('admin', 'reviewer', 'engineer', 'viewer');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.has_any_role(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null, base_url text not null,
  created_at timestamptz not null default now()
);
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_url text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  is_simulated boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create index scans_project_idx on public.scans(project_id, created_at desc);
create table public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','claimed','running','succeeded','failed')),
  attempts int not null default 0 check (attempts >= 0),
  progress int not null default 0 check (progress between 0 and 100),
  error text, locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index scan_jobs_status_idx on public.scan_jobs(status, updated_at);
create table public.policy_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^\d\.\d\.\d+$'),
  title text not null, level text not null check (level in ('A','AA','AAA')), url text not null
);
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  rule_id text not null, wcag text not null, title text not null,
  severity text not null check (severity in ('critical','serious','moderate','minor')),
  status text not null default 'open' check (status in ('open','in_review','accepted','rejected','remediation_in_progress','ready_for_verification','verified','reopened')),
  selector text not null, page_url text not null,
  assignee_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index findings_scan_idx on public.findings(scan_id);
create index findings_status_idx on public.findings(status, severity);
create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  kind text not null check (kind in ('dom_snippet','contrast_sample','screenshot')),
  content text not null,
  storage_path text, -- private 'evidence' bucket, signed URLs only
  created_at timestamptz not null default now()
);
create index evidence_finding_idx on public.evidence(finding_id);
create table public.model_runs (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  provider text not null, model text not null,
  status text not null check (status in ('succeeded','failed_validation','failed')),
  latency_ms int not null check (latency_ms >= 0), prompt_version text not null,
  created_at timestamptz not null default now()
);
create index model_runs_finding_idx on public.model_runs(finding_id);
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  model_run_id uuid not null references public.model_runs(id) on delete cascade,
  summary text not null, proposed_fix text not null, rationale text not null,
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  policy_refs text[] not null check (cardinality(policy_refs) >= 1),
  created_at timestamptz not null default now()
);
create index recommendations_finding_idx on public.recommendations(finding_id);
create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  decision_note text, created_at timestamptz not null default now(), decided_at timestamptz,
  check ((status = 'pending') = (decided_at is null))
);
create index review_tasks_status_idx on public.review_tasks(status);
create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  method text not null check (method in ('manual','automated_rescan','assistive_tech')),
  result text not null check (result in ('pass','fail')),
  verified_by uuid not null references auth.users(id),
  notes text not null check (length(notes) >= 5),
  created_at timestamptz not null default now()
);
create index verification_runs_finding_idx on public.verification_runs(finding_id, created_at desc);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text not null, action text not null, entity text not null, entity_id text not null,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events(entity, entity_id);

-- Safety invariant enforced in the database.
create or replace function public.enforce_verified_requires_evidence()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    if old.status <> 'ready_for_verification' then
      raise exception 'Finding must be ready_for_verification first';
    end if;
    if not exists (select 1 from public.verification_runs v where v.finding_id = new.id and v.result = 'pass') then
      raise exception 'A passing human verification run is required';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger findings_verified_guard before update on public.findings
  for each row execute function public.enforce_verified_requires_evidence();

grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.projects, public.scans, public.findings,
  public.evidence, public.review_tasks, public.verification_runs to authenticated;
grant select on public.scan_jobs, public.policy_sources, public.model_runs,
  public.recommendations, public.audit_events to authenticated;
grant all on all tables in schema public to service_role;

do $$ declare t text; begin
  foreach t in array array['user_roles','projects','scans','scan_jobs','policy_sources','findings','evidence','model_runs','recommendations','review_tasks','verification_runs','audit_events']
  loop execute format('alter table public.%I enable row level security', t);
       if t not in ('user_roles','audit_events') then
         execute format('create policy "members read" on public.%I for select to authenticated using (public.has_any_role(auth.uid()))', t);
       end if;
  end loop; end $$;

create policy "read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "admins read audit" on public.audit_events for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins manage projects" on public.projects for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "engineers create scans" on public.scans for insert to authenticated
  with check (created_by = auth.uid() and (public.has_role(auth.uid(), 'engineer') or public.has_role(auth.uid(), 'admin')));
create policy "workflow updates findings" on public.findings for update to authenticated
  using (public.has_role(auth.uid(), 'reviewer') or public.has_role(auth.uid(), 'engineer') or public.has_role(auth.uid(), 'admin'));
create policy "request review" on public.review_tasks for insert to authenticated
  with check (public.has_any_role(auth.uid()) and not public.has_role(auth.uid(), 'viewer'));
create policy "reviewers decide" on public.review_tasks for update to authenticated
  using (public.has_role(auth.uid(), 'reviewer') or public.has_role(auth.uid(), 'admin'));
create policy "humans record verification" on public.verification_runs for insert to authenticated
  with check (verified_by = auth.uid() and (public.has_role(auth.uid(), 'reviewer') or public.has_role(auth.uid(), 'admin')));
-- scan_jobs, model_runs, recommendations, audit_events: written only by server adapters (service role).
