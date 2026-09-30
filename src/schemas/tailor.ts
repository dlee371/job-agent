// Schemas for tailoring and fact-checking (ARCHITECTURE.md §9).
import { z } from "zod";

// ---------------------------------------------------------------------------
// What Claude returns: ids + rewritten text ONLY. Companies, titles, dates and
// education are copied from profile.json by code (src/tailor/assemble.ts).
// ---------------------------------------------------------------------------
const TailoredBullet = z.object({
  text: z.string().min(1),
  source_ids: z.array(z.string()).min(1), // profile bullet ids this bullet is based on
});

export const TailorResult = z.object({
  summary: TailoredBullet.nullable(),
  experience: z.array(z.object({ id: z.string(), bullets: z.array(TailoredBullet) })),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(TailoredBullet) })),
  skills: z.array(z.string()), // must be copied exactly from profile.skills
  education_ids: z.array(z.string()),
  changes: z.array(z.object({ what: z.string(), why: z.string() })),
  gaps: z.array(z.string()), // job requirements the profile can't honestly cover
});
export type TailorResult = z.infer<typeof TailorResult>;

// ---------------------------------------------------------------------------
// The assembled resume: what gets rendered to PDF and stored in applications.resume_json.
// ---------------------------------------------------------------------------
export const ResumeBullet = z.object({ text: z.string(), source_ids: z.array(z.string()) });

export const TailoredResume = z.object({
  basics: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()),
  }),
  summary: ResumeBullet.nullable(),
  experience: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      bullets: z.array(ResumeBullet),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      link: z.string().nullable(),
      dates: z.string().nullable(),
      tech: z.array(z.string()),
      bullets: z.array(ResumeBullet),
    }),
  ),
  education: z.array(
    z.object({
      id: z.string(),
      school: z.string(),
      degree: z.string(),
      field: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      gpa: z.string().nullable(),
      details: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
  certifications: z.array(z.object({ name: z.string(), date: z.string().nullable() })),
});
export type TailoredResume = z.infer<typeof TailoredResume>;

// ---------------------------------------------------------------------------
// Fact-check
// ---------------------------------------------------------------------------
export const FactCheckLLM = z.object({
  unsupported: z.array(
    z.object({
      pair: z.number().int(), // the pair number from the prompt (1-based)
      claim: z.string(), // the unsupported part of the rewritten text
      reason: z.string(),
    }),
  ),
});
export type FactCheckLLM = z.infer<typeof FactCheckLLM>;

export const FACTCHECK_CHECKS = [
  "unknown_id",
  "wrong_source",
  "skill_not_in_profile",
  "number_not_in_source",
  "job_only_term",
  "llm_unsupported",
  "too_long",
] as const;

export const FactCheckIssue = z.object({
  check: z.enum(FACTCHECK_CHECKS),
  detail: z.string(),
  bullet_text: z.string().nullable(),
});
export type FactCheckIssue = z.infer<typeof FactCheckIssue>;

export const FactCheckReport = z.object({ passed: z.boolean(), issues: z.array(FactCheckIssue) });
export type FactCheckReport = z.infer<typeof FactCheckReport>;
