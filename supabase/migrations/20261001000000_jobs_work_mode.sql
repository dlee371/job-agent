-- Phase 2: Lever and Ashby say whether a job is remote, hybrid or onsite.
-- Keeping it lets the filter drop onsite-only jobs when preferences.work_modes excludes onsite.
alter table jobs
  add column work_mode text check (work_mode in ('remote', 'hybrid', 'onsite'));
