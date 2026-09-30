// Schemas for your profile (the ONLY source of facts about you) and your job preferences.
// See docs/ARCHITECTURE.md §9.
import { z } from "zod";

// ---------------------------------------------------------------------------
// What Claude returns when converting resume.md (no ids, no standard answers).
// Kept deliberately loose (plain strings): it must copy the resume as written,
// not reformat it to satisfy a strict schema.
// ---------------------------------------------------------------------------
const maybe = z.string().nullable();

export const ProfileExtraction = z.object({
  basics: z.object({
    name: z.string(),
    email: maybe,
    phone: maybe,
    location: maybe,
    links: z.object({ linkedin: maybe, github: maybe, website: maybe }),
  }),
  summary: maybe,
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      field: maybe,
      start: maybe,
      end: maybe,
      gpa: maybe,
      details: z.array(z.string()),
    }),
  ),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: maybe,
      start: maybe,
      end: maybe, // copied as written, e.g. "Present"
      bullets: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      link: maybe,
      dates: maybe,
      tech: z.array(z.string()),
      bullets: z.array(z.string()),
    }),
  ),
  skills: z.array(z.string()),
  certifications: z.array(z.object({ name: z.string(), date: maybe })),
});
export type ProfileExtraction = z.infer<typeof ProfileExtraction>;

// ---------------------------------------------------------------------------
// data/profile.json — what you review, edit and own.
// Every fact has a stable id (assigned by code) so tailored resumes can cite
// exactly which facts they are based on.
// ---------------------------------------------------------------------------
export const Bullet = z.object({ id: z.string().min(1), text: z.string().min(1) });
export type Bullet = z.infer<typeof Bullet>;

// Answers most application forms ask for. null = "I haven't decided" → the form
// field is left empty and flagged for you. Nothing here is ever guessed.
export const StandardAnswers = z.object({
  work_authorization: maybe, // e.g. "Authorized to work in the US for any employer"
  needs_sponsorship: z.boolean().nullable(), // now or in the future
  earliest_start_date: maybe, // e.g. "Immediately" or "2026-11-01"
  willing_to_relocate: z.boolean().nullable(),
  salary_expectation: maybe, // null → left empty on forms and flagged
  years_of_experience: maybe, // e.g. "1"
  how_did_you_hear: maybe, // e.g. "Company careers page"
  why_interested_template: maybe, // 2-3 honest sentences Claude adapts per job
  eeo: z.object({
    // Voluntary questions. "Decline to self-identify" is always a valid answer.
    gender: maybe,
    race: maybe,
    veteran: maybe,
    disability: maybe,
  }),
});
export type StandardAnswers = z.infer<typeof StandardAnswers>;

export const Profile = z.object({
  basics: z.object({
    name: z.string().min(1),
    email: z.email(),
    phone: maybe,
    location: maybe,
    links: z.object({ linkedin: maybe, github: maybe, website: maybe }),
  }),
  summary: Bullet.nullable(),
  education: z.array(
    z.object({
      id: z.string(),
      school: z.string(),
      degree: z.string(),
      field: maybe,
      start: maybe,
      end: maybe,
      gpa: maybe,
      details: z.array(Bullet),
    }),
  ),
  experience: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      title: z.string(),
      location: maybe,
      start: maybe,
      end: maybe,
      bullets: z.array(Bullet),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      link: maybe,
      dates: maybe,
      tech: z.array(z.string()),
      bullets: z.array(Bullet),
    }),
  ),
  skills: z.array(z.string()),
  certifications: z.array(z.object({ id: z.string(), name: z.string(), date: maybe })),
  standard_answers: StandardAnswers,
});
export type Profile = z.infer<typeof Profile>;

// ---------------------------------------------------------------------------
// data/preferences.json — written by hand (template: templates/preferences.example.json)
// ---------------------------------------------------------------------------
export const Preferences = z.object({
  target_titles: z.array(z.string().min(1)).min(1),
  interests: z.array(z.string()),
  locations: z.array(z.string().min(1)).min(1), // e.g. "Austin, TX", "Remote (US)"
  max_commute_miles: z.number().positive().nullable(),
  work_modes: z.array(z.enum(["remote", "hybrid", "onsite"])).min(1),
  min_salary_usd: z.number().positive().nullable(),
  deal_breakers: z.array(z.string()),
  max_years_required: z.number().int().min(0).default(2), // used by the code filter in Phase 2
});
export type Preferences = z.infer<typeof Preferences>;
