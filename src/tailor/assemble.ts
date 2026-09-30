// Builds the final resume from Claude's ids + rewritten bullets.
// Every structural fact (company, title, dates, school, degree, contact details) is COPIED
// from profile.json here, so Claude can't change them. Unknown ids are skipped; the
// fact-check reports them separately.
import type { Profile } from "@/schemas/profile";
import type { TailorResult, TailoredResume } from "@/schemas/tailor";

export function assembleResume(profile: Profile, t: TailorResult): TailoredResume {
  const experienceById = new Map(profile.experience.map((e) => [e.id, e]));
  const projectById = new Map(profile.projects.map((p) => [p.id, p]));
  // Skills are matched case-insensitively but always printed with YOUR spelling.
  const skillByLower = new Map(profile.skills.map((s) => [s.toLowerCase(), s]));

  const b = profile.basics;
  return {
    basics: {
      name: b.name,
      email: b.email,
      phone: b.phone,
      location: b.location,
      links: [b.links.linkedin, b.links.github, b.links.website].filter((l): l is string => Boolean(l)),
    },
    summary: t.summary,
    experience: t.experience.flatMap((e) => {
      const src = experienceById.get(e.id);
      if (!src) return [];
      return [{ id: src.id, company: src.company, title: src.title, location: src.location, start: src.start, end: src.end, bullets: e.bullets }];
    }),
    projects: t.projects.flatMap((p) => {
      const src = projectById.get(p.id);
      if (!src) return [];
      return [{ id: src.id, name: src.name, link: src.link, dates: src.dates, tech: src.tech, bullets: p.bullets }];
    }),
    // Keep your profile's order for education; Claude only chooses which to include
    // (if it returns none, include all: education always matters early in a career).
    education: profile.education
      .filter((e) => t.education_ids.includes(e.id) || t.education_ids.length === 0)
      .map((e) => ({
        id: e.id,
        school: e.school,
        degree: e.degree,
        field: e.field,
        start: e.start,
        end: e.end,
        gpa: e.gpa,
        details: e.details.map((d) => d.text),
      })),
    skills: [...new Set(t.skills.map((s) => skillByLower.get(s.toLowerCase())).filter((s): s is string => Boolean(s)))],
    certifications: profile.certifications.map((c) => ({ name: c.name, date: c.date })),
  };
}
