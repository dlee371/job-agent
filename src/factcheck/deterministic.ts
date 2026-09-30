// The free fact-checks that run in code (ARCHITECTURE.md §2 row 4, §11).
// Each returns issues; an empty list means the tailored resume passed.
import type { Profile } from "@/schemas/profile";
import type { FactCheckIssue, TailorResult } from "@/schemas/tailor";
import { factIndex } from "@/lib/profile";
import { TECH_TERMS } from "./tech-terms";

export const MAX_WORDS = 475; // ~one page of bullets and summary

/** Numbers like 12, 3.5, 40,000 (commas removed so "40,000" == "40000"). */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-term match that also works for terms like "C++" or ".NET". */
export function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(term)}(?![A-Za-z0-9+#])`, "i").test(text);
}

/** Everything true about you, as one string, for "does the profile mention X?" checks. */
export function profileText(profile: Profile): string {
  return [
    profile.summary?.text,
    ...profile.skills,
    ...profile.experience.flatMap((e) => [e.title, e.company, ...e.bullets.map((b) => b.text)]),
    ...profile.projects.flatMap((p) => [p.name, ...p.tech, ...p.bullets.map((b) => b.text)]),
    ...profile.education.flatMap((e) => [e.degree, e.field, e.school, ...e.details.map((d) => d.text)]),
    ...profile.certifications.map((c) => c.name),
  ]
    .filter(Boolean)
    .join("\n");
}

type LabeledBullet = { text: string; source_ids: string[]; entryId: string | null };

function allBullets(t: TailorResult): LabeledBullet[] {
  return [
    ...(t.summary ? [{ ...t.summary, entryId: null }] : []),
    ...t.experience.flatMap((e) => e.bullets.map((b) => ({ ...b, entryId: e.id }))),
    ...t.projects.flatMap((p) => p.bullets.map((b) => ({ ...b, entryId: p.id }))),
  ];
}

export function deterministicChecks(profile: Profile, t: TailorResult, jobDescription: string | null): FactCheckIssue[] {
  const issues: FactCheckIssue[] = [];
  const facts = factIndex(profile);
  const entryIds = new Set([...profile.experience.map((e) => e.id), ...profile.projects.map((p) => p.id)]);
  const educationIds = new Set(profile.education.map((e) => e.id));

  // 1. Every id must exist, and bullets may only cite their own entry.
  for (const id of [...t.experience.map((e) => e.id), ...t.projects.map((p) => p.id)]) {
    if (!entryIds.has(id)) issues.push({ check: "unknown_id", detail: `Entry "${id}" is not in your profile`, bullet_text: null });
  }
  for (const id of t.education_ids) {
    if (!educationIds.has(id)) issues.push({ check: "unknown_id", detail: `Education "${id}" is not in your profile`, bullet_text: null });
  }
  for (const b of allBullets(t)) {
    for (const id of b.source_ids) {
      if (!facts.has(id)) {
        issues.push({ check: "unknown_id", detail: `Cites "${id}", which is not in your profile`, bullet_text: b.text });
      } else if (b.entryId && !id.startsWith(`${b.entryId}-`)) {
        issues.push({ check: "wrong_source", detail: `Bullet in ${b.entryId} cites ${id} from a different entry`, bullet_text: b.text });
      }
    }
  }

  // 2. Skills must be copied from your skills list.
  const skills = new Set(profile.skills.map((s) => s.toLowerCase()));
  for (const s of t.skills) {
    if (!skills.has(s.toLowerCase())) issues.push({ check: "skill_not_in_profile", detail: `Skill "${s}" is not in your profile`, bullet_text: null });
  }

  // 3. Every number in a bullet must appear in the bullets it cites.
  for (const b of allBullets(t)) {
    const sourceNumbers = new Set(b.source_ids.flatMap((id) => extractNumbers(facts.get(id) ?? "")));
    for (const n of extractNumbers(b.text)) {
      if (!sourceNumbers.has(n)) issues.push({ check: "number_not_in_source", detail: `"${n}" does not appear in the cited source`, bullet_text: b.text });
    }
  }

  // 4. Tech named in the job but nowhere in your profile must not appear in the resume text.
  if (jobDescription) {
    const truth = profileText(profile);
    const jobOnly = TECH_TERMS.filter((term) => containsTerm(jobDescription, term) && !containsTerm(truth, term));
    for (const b of allBullets(t)) {
      for (const term of jobOnly) {
        if (containsTerm(b.text, term)) {
          issues.push({ check: "job_only_term", detail: `"${term}" is in the job post but not in your profile`, bullet_text: b.text });
        }
      }
    }
  }

  // 5. Length.
  const words = allBullets(t)
    .map((b) => b.text)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  if (words > MAX_WORDS) issues.push({ check: "too_long", detail: `${words} words of bullets and summary (max ${MAX_WORDS})`, bullet_text: null });

  return issues;
}

/**
 * Bullets whose text changed from their sources, for the Claude check. Unchanged copies are skipped.
 * The SOURCE side also includes true context the bullet may draw on: your skills list for the
 * summary, and the project's tech list for project bullets. Without it, a true fact that just
 * wasn't cited (e.g. a skill) would be flagged, and false alarms teach you to ignore the flag.
 */
export function pairsToCheck(profile: Profile, t: TailorResult): { source: string; rewritten: string }[] {
  const facts = factIndex(profile);
  const techByProject = new Map(profile.projects.map((p) => [p.id, p.tech]));
  return allBullets(t)
    .map((b) => {
      const cited = b.source_ids.map((id) => facts.get(id) ?? "").filter(Boolean).join(" / ");
      let context = "";
      if (b.entryId === null) context = `Skills: ${profile.skills.join(", ")}`;
      else if (techByProject.get(b.entryId)?.length) context = `Technologies used: ${techByProject.get(b.entryId)!.join(", ")}`;
      return { cited, source: context ? `${cited} (${context})` : cited, rewritten: b.text };
    })
    .filter((p) => p.cited && p.cited.trim() !== p.rewritten.trim())
    .map(({ source, rewritten }) => ({ source, rewritten }));
}
