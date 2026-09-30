// Loading, id assignment and checks for data/profile.json and data/preferences.json.
// Pure functions (no database, no Claude) so they are easy to unit test.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  Preferences,
  Profile,
  type Bullet,
  type ProfileExtraction,
  type StandardAnswers,
} from "@/schemas/profile";

// Scripts are run from the project root via npm, so paths are relative to it.
export const DATA_DIR = path.resolve(process.cwd(), "data");
export const PATHS = {
  resume: path.join(DATA_DIR, "resume.md"),
  profileDraft: path.join(DATA_DIR, "profile.draft.json"),
  profile: path.join(DATA_DIR, "profile.json"),
  preferences: path.join(DATA_DIR, "preferences.json"),
};

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

function bullets(parentId: string, texts: string[], prefix = "b"): Bullet[] {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((text, i) => ({ id: `${parentId}-${prefix}${i + 1}`, text }));
}

const EMPTY_STANDARD_ANSWERS: StandardAnswers = {
  work_authorization: null,
  needs_sponsorship: null,
  earliest_start_date: null,
  willing_to_relocate: null,
  salary_expectation: null,
  years_of_experience: null,
  how_did_you_hear: null,
  why_interested_template: null,
  eeo: { gender: null, race: null, veteran: null, disability: null },
};

/**
 * Turns Claude's extraction into a profile draft. Ids are assigned here, by code,
 * in resume order: exp1, exp1-b1, proj1, proj1-b1, edu1, edu1-d1, cert1, summary.
 * standard_answers start empty: only you can answer those.
 *
 * Returns a plain object (not validated as Profile) because the draft may still have
 * gaps, like a missing email, that you fix by hand.
 */
export function buildProfileDraft(x: ProfileExtraction) {
  return {
    basics: x.basics,
    summary: x.summary?.trim() ? { id: "summary", text: x.summary.trim() } : null,
    education: x.education.map((e, i) => {
      const id = `edu${i + 1}`;
      return { id, ...e, details: bullets(id, e.details, "d") };
    }),
    experience: x.experience.map((e, i) => {
      const id = `exp${i + 1}`;
      return { id, ...e, bullets: bullets(id, e.bullets) };
    }),
    projects: x.projects.map((p, i) => {
      const id = `proj${i + 1}`;
      return { id, ...p, bullets: bullets(id, p.bullets) };
    }),
    skills: [...new Set(x.skills.map((s) => s.trim()).filter(Boolean))],
    certifications: x.certifications.map((c, i) => ({ id: `cert${i + 1}`, ...c })),
    standard_answers: EMPTY_STANDARD_ANSWERS,
  };
}

/** Every id in the profile, mapped to its text. Used by the fact-check in Phase 4. */
export function factIndex(profile: Profile): Map<string, string> {
  const index = new Map<string, string>();
  if (profile.summary) index.set(profile.summary.id, profile.summary.text);
  for (const e of profile.education) {
    index.set(e.id, `${e.degree}${e.field ? `, ${e.field}` : ""} at ${e.school}`);
    for (const d of e.details) index.set(d.id, d.text);
  }
  for (const e of profile.experience) {
    index.set(e.id, `${e.title} at ${e.company}`);
    for (const b of e.bullets) index.set(b.id, b.text);
  }
  for (const p of profile.projects) {
    index.set(p.id, p.name);
    for (const b of p.bullets) index.set(b.id, b.text);
  }
  for (const c of profile.certifications) index.set(c.id, c.name);
  return index;
}

// ---------------------------------------------------------------------------
// Checks (used by `npm run profile:check`)
// ---------------------------------------------------------------------------

export type CheckResult = { errors: string[]; warnings: string[] };

function zodProblems(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Validates a parsed profile.json. Errors block the pipeline; warnings are things to review. */
export function checkProfile(raw: unknown): CheckResult {
  const parsed = Profile.safeParse(raw);
  if (!parsed.success) return { errors: zodProblems(parsed.error), warnings: [] };
  const p = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Ids must be unique, or a tailored bullet could cite the wrong fact.
  const seen = new Set<string>();
  const allIds = [
    p.summary?.id,
    ...p.education.flatMap((e) => [e.id, ...e.details.map((d) => d.id)]),
    ...p.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...p.projects.flatMap((x) => [x.id, ...x.bullets.map((b) => b.id)]),
    ...p.certifications.map((c) => c.id),
  ].filter((id): id is string => Boolean(id));
  for (const id of allIds) {
    if (seen.has(id)) errors.push(`Duplicate id "${id}" — every id must be unique`);
    seen.add(id);
  }

  if (p.experience.length === 0 && p.projects.length === 0) {
    errors.push("Add at least one experience or project entry");
  }
  if (p.skills.length === 0) errors.push("skills is empty — list your skills exactly as you want them spelled");

  for (const e of p.experience) {
    if (!e.start) warnings.push(`experience ${e.id} (${e.company}): start date is empty`);
    if (e.bullets.length === 0) warnings.push(`experience ${e.id} (${e.company}): has no bullets`);
  }

  for (const [name, url] of Object.entries(p.basics.links)) {
    if (url && !/^https?:\/\//.test(url)) {
      warnings.push(`basics.links.${name} should start with https:// (forms often reject it otherwise)`);
    }
  }
  if (!p.basics.phone) warnings.push("basics.phone is empty — most forms require a phone number");

  // Empty standard answers are allowed (they're left blank on forms and flagged for you),
  // but you'll get fewer flagged forms if you fill them in.
  const sa = p.standard_answers;
  const { eeo, ...rest } = sa;
  for (const [key, value] of Object.entries(rest)) {
    if (value === null) warnings.push(`standard_answers.${key} is empty`);
  }
  for (const [key, value] of Object.entries(eeo)) {
    if (value === null) warnings.push(`standard_answers.eeo.${key} is empty ("Decline to self-identify" is fine)`);
  }

  return { errors, warnings };
}

export function checkPreferences(raw: unknown): CheckResult {
  const parsed = Preferences.safeParse(raw);
  if (!parsed.success) return { errors: zodProblems(parsed.error), warnings: [] };
  const warnings: string[] = [];
  if (parsed.data.deal_breakers.length === 0) warnings.push("deal_breakers is empty");
  return { errors: [], warnings };
}

// ---------------------------------------------------------------------------
// Loading (throws with a clear message; used by every later phase)
// ---------------------------------------------------------------------------

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} not found`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${path.relative(process.cwd(), file)} is not valid JSON: ${(err as Error).message}`);
  }
}

export function loadProfile(file = PATHS.profile): Profile {
  const raw = readJson(file);
  const { errors } = checkProfile(raw);
  if (errors.length) throw new Error(`profile.json has problems (run npm run profile:check):\n  ${errors.join("\n  ")}`);
  return Profile.parse(raw);
}

export function loadPreferences(file = PATHS.preferences): Preferences {
  const raw = readJson(file);
  const { errors } = checkPreferences(raw);
  if (errors.length) throw new Error(`preferences.json has problems (run npm run profile:check):\n  ${errors.join("\n  ")}`);
  return Preferences.parse(raw);
}

export { readJson };
