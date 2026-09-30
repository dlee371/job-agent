// Status values. These must match the CHECK constraints in supabase/migrations.
// See docs/ARCHITECTURE.md §6 for the lifecycle diagrams.

export const JOB_STATUSES = [
  "new",
  "filtered_out",
  "duplicate",
  "to_score",
  "scoring",
  "shortlisted",
  "skipped",
  "score_failed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "drafting",
  "ready_to_fill",
  "awaiting_review",
  "needs_attention",
  "manual_apply",
  "approved", // set ONLY by the review UI (src/app/applications/[id]/actions.ts)
  "rejected", // set ONLY by the review UI
  "submitting",
  "submitted",
  "applied_manually", // set ONLY by the review UI
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const OUTCOMES = ["pending", "no_response", "rejected", "interview", "offer"] as const;
export type Outcome = (typeof OUTCOMES)[number];
