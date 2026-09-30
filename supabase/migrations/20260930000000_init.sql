-- Initial schema for job-agent. See docs/ARCHITECTURE.md §5 and §6.
-- Apply with `npm run db:reset` (wipes local data) or it runs automatically on `npm run db:start`.

-- ============================================================
-- Companies whose public ATS boards we poll
-- ============================================================
create table companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  ats           text not null check (ats in ('greenhouse','lever','ashby')),
  board_token   text not null,                 -- e.g. 'stripe' in boards.greenhouse.io/stripe
  origin        text not null default 'manual' check (origin in ('manual','discovered')),
  active        boolean not null default true,
  last_fetched_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (ats, board_token)
);

-- ============================================================
-- Jobs: discovery + scoring lifecycle
-- ============================================================
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,               -- 'jsearch' | 'adzuna' | 'greenhouse' | 'lever' | 'ashby'
  external_id     text not null,
  dedupe_key      text not null,               -- normalized company|title|location
  title           text not null,
  company         text not null,
  location        text,
  remote          boolean,
  description     text,
  apply_url       text,
  ats             text not null default 'other' check (ats in ('greenhouse','lever','ashby','other')),
  ats_board_token text,
  ats_job_id      text,
  salary_min      integer,
  salary_max      integer,
  posted_at       timestamptz,

  status          text not null default 'new' check (status in
                    ('new','filtered_out','duplicate','to_score','scoring','shortlisted','skipped','score_failed')),
  filter_reason   text,                        -- why code filtered it out
  score_batch_id  text,                        -- Anthropic batch id while status = 'scoring'
  fit_score       integer check (fit_score between 0 and 100),
  fit_reasons     jsonb,
  missing_requirements jsonb,
  deal_breaker_hit boolean,
  scored_at       timestamptz,

  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, external_id)
);
create index jobs_status_idx on jobs (status);
create index jobs_dedupe_idx on jobs (dedupe_key);

-- ============================================================
-- Applications: one per shortlisted job
-- ============================================================
create table applications (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null unique references jobs(id) on delete cascade,
  status          text not null default 'drafting' check (status in
                    ('drafting','ready_to_fill','awaiting_review','needs_attention','manual_apply',
                     'approved','rejected','submitting','submitted','applied_manually')),

  -- tailoring
  resume_json     jsonb,                       -- assembled tailored resume (TailoredResume, §9)
  changes         jsonb,                       -- [{what, why}]
  gaps            jsonb,                       -- [string]
  factcheck       jsonb,                       -- {passed, issues:[{check, detail, bullet_id?}]}
  resume_pdf_path text,
  cover_letter    text,

  -- form filling
  form_fields     jsonb,                       -- FormField[] read from the page
  form_answers    jsonb,                       -- FormAnswer[] (what gets typed)
  screenshot_path text,
  manual_reason   text,                        -- 'captcha' | 'login' | 'account' | 'unsupported_ats' | ...
  attention_reason text,                       -- why it needs you

  -- review + submit
  approved_at     timestamptz,
  approved_hash   text,                        -- md5 of content at approval time (set by trigger)
  rejected_reason text,
  submitted_at    timestamptz,
  final_screenshot_path text,
  confirmation    text,                        -- confirmation text/URL we detected

  -- outcome tracking
  outcome         text not null default 'pending' check (outcome in
                    ('pending','no_response','rejected','interview','offer')),
  outcome_updated_at timestamptz,
  followed_up_at  timestamptz,

  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index applications_status_idx on applications (status);

-- Audit log: every status change, written by the trigger below
create table application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  note           text,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- Runs + Claude usage (cost tracking)
-- ============================================================
create table runs (
  id          uuid primary key default gen_random_uuid(),
  step        text not null,                   -- 'search' | 'score' | 'tailor' | ...
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb,                           -- {processed, succeeded, failed, skipped}
  error       text
);

create table llm_batches (
  id            text primary key,              -- Anthropic batch id
  purpose       text not null,                 -- 'score'
  status        text not null,                 -- 'in_progress' | 'ended' | 'collected'
  request_count integer not null,
  created_at    timestamptz not null default now(),
  collected_at  timestamptz
);

create table llm_calls (
  id                    bigint generated always as identity primary key,
  run_id                uuid references runs(id),
  job_id                uuid references jobs(id) on delete set null,
  application_id        uuid references applications(id) on delete set null,
  purpose               text not null,         -- 'profile'|'score'|'tailor'|'factcheck'|'form_answers'|'cover_letter'
  model                 text not null,
  is_batch              boolean not null default false,
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cache_read_tokens     integer not null default 0,
  cost_usd              numeric(10,6),
  stop_reason           text,
  created_at            timestamptz not null default now()
);
create index llm_calls_job_idx on llm_calls (job_id);

-- Cost per application = everything spent on its job (scoring included)
create view application_costs as
select a.id as application_id,
       a.job_id,
       coalesce(sum(c.cost_usd), 0)      as cost_usd,
       coalesce(sum(c.input_tokens), 0)  as input_tokens,
       coalesce(sum(c.output_tokens), 0) as output_tokens,
       coalesce(sum(c.cache_read_tokens), 0) as cache_read_tokens
from applications a
left join llm_calls c on c.job_id = a.job_id
group by a.id, a.job_id;

-- ============================================================
-- Status rules for applications (the safety net)
-- ============================================================
create or replace function applications_guard() returns trigger
language plpgsql as $$
declare
  content_hash text;
  allowed      text[];
begin
  content_hash := md5(coalesce(new.resume_json::text, '') ||
                      coalesce(new.form_answers::text, '') ||
                      coalesce(new.cover_letter, ''));

  if tg_op = 'INSERT' then
    if new.status <> 'drafting' then
      raise exception 'New applications must start as drafting';
    end if;
    return new;
  end if;

  -- Editing an approved application sends it back to review.
  if old.status = 'approved' and new.status = 'approved'
     and content_hash is distinct from old.approved_hash then
    new.status := 'awaiting_review';
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'drafting'        then array['ready_to_fill','manual_apply','needs_attention','rejected']
      when 'ready_to_fill'   then array['awaiting_review','manual_apply','needs_attention','rejected']
      when 'needs_attention' then array['drafting','ready_to_fill','awaiting_review','manual_apply','rejected']
      when 'awaiting_review' then array['approved','rejected','needs_attention','drafting']
      when 'approved'        then array['submitting','awaiting_review','rejected']
      when 'submitting'      then array['submitted','needs_attention']
      when 'manual_apply'    then array['applied_manually','rejected','drafting']
      when 'rejected'        then array['awaiting_review']
      else array[]::text[]   -- submitted, applied_manually: final
    end;

    if not (new.status = any(allowed)) then
      raise exception 'Illegal application status change: % -> %', old.status, new.status;
    end if;

    if new.status = 'approved' then
      new.approved_at   := now();
      new.approved_hash := content_hash;
    elsif new.status = 'submitting' then
      -- Only an approved record whose content is unchanged since approval may be submitted.
      if old.approved_hash is distinct from content_hash then
        raise exception 'Content changed since approval; re-review required';
      end if;
    elsif new.status in ('awaiting_review','rejected','drafting') then
      new.approved_at   := null;
      new.approved_hash := null;
    end if;

    insert into application_events (application_id, from_status, to_status, note)
    values (new.id, old.status, new.status,
            coalesce(new.attention_reason, new.manual_reason, new.rejected_reason));
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger applications_guard
before insert or update on applications
for each row execute function applications_guard();

-- ============================================================
-- RLS on, no policies: only the service role (server code) can access.
-- ============================================================
alter table companies          enable row level security;
alter table jobs               enable row level security;
alter table applications       enable row level security;
alter table application_events enable row level security;
alter table runs               enable row level security;
alter table llm_batches        enable row level security;
alter table llm_calls          enable row level security;
