// The fact-check is the main defense against a fabricated resume, so every check has a test
// with a planted fabrication.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Profile } from "@/schemas/profile";
import type { TailorResult } from "@/schemas/tailor";
import { containsTerm, deterministicChecks, extractNumbers, pairsToCheck } from "@/factcheck/deterministic";
import { assembleResume } from "@/tailor/assemble";

const profile = Profile.parse(JSON.parse(fs.readFileSync("templates/profile.example.json", "utf8")));
const JOB = "We use TypeScript, React, Kubernetes and GraphQL. PostgreSQL is a plus.";

// An honest tailored resume based on templates/profile.example.json
const honest = (): TailorResult => ({
  summary: { text: "CS graduate who builds full-stack apps with TypeScript and React.", source_ids: ["summary"] },
  experience: [
    {
      id: "exp1",
      bullets: [
        { text: "Built a React dashboard showing appointment wait times for 12 clinics", source_ids: ["exp1-b1"] },
        { text: "Cut report page load time from 8s to 2s with PostgreSQL query tuning", source_ids: ["exp1-b2"] },
      ],
    },
  ],
  projects: [{ id: "proj1", bullets: [{ text: "Built a study-group scheduler used by 150 students", source_ids: ["proj1-b1"] }] }],
  skills: ["TypeScript", "react", "PostgreSQL"],
  education_ids: ["edu1"],
  changes: [{ what: "Led with the React dashboard", why: "job uses React" }],
  gaps: ["Kubernetes"],
});

describe("deterministicChecks", () => {
  it("passes an honest tailored resume", () => {
    expect(deterministicChecks(profile, honest(), JOB)).toEqual([]);
  });

  it("catches a planted fake skill", () => {
    const t = honest();
    t.skills.push("Kubernetes");
    expect(deterministicChecks(profile, t, JOB)).toContainEqual({
      check: "skill_not_in_profile",
      detail: 'Skill "Kubernetes" is not in your profile',
      bullet_text: null,
    });
  });

  it("catches a changed number", () => {
    const t = honest();
    t.experience[0]!.bullets[1]!.text = "Cut report page load time by 75% with PostgreSQL query tuning";
    const issues = deterministicChecks(profile, t, JOB);
    expect(issues.map((i) => i.check)).toContain("number_not_in_source");
    expect(issues[0]!.detail).toBe('"75" does not appear in the cited source');
  });

  it("catches tech copied from the job post", () => {
    const t = honest();
    t.experience[0]!.bullets[0]!.text = "Built a React dashboard deployed on Kubernetes for 12 clinics";
    expect(deterministicChecks(profile, t, JOB)).toContainEqual({
      check: "job_only_term",
      detail: '"Kubernetes" is in the job post but not in your profile',
      bullet_text: "Built a React dashboard deployed on Kubernetes for 12 clinics",
    });
  });

  it("catches made-up and misattributed ids", () => {
    const t = honest();
    t.experience[0]!.bullets[0]!.source_ids = ["exp9-b1"];
    t.projects[0]!.bullets[0]!.source_ids = ["exp1-b1"]; // project bullet citing an experience bullet
    t.education_ids.push("edu7");
    const checks = deterministicChecks(profile, t, JOB).map((i) => i.check);
    expect(checks).toEqual(expect.arrayContaining(["unknown_id", "wrong_source"]));
    expect(checks.filter((c) => c === "unknown_id")).toHaveLength(2);
  });

  it("flags a resume that is too long", () => {
    const t = honest();
    t.projects[0]!.bullets[0]!.text = "word ".repeat(500).trim();
    expect(deterministicChecks(profile, t, JOB).map((i) => i.check)).toContain("too_long");
  });
});

describe("helpers", () => {
  it("extracts numbers and ignores thousands separators", () => {
    expect(extractNumbers("Served 40,000 users in 3.5 days, 12 clinics")).toEqual(["40000", "3.5", "12"]);
  });
  it("matches terms with symbols as whole terms", () => {
    expect(containsTerm("Wrote C++ services", "C++")).toBe(true);
    expect(containsTerm("Knows Reactive programming", "React")).toBe(false);
    expect(containsTerm("Built with Node.js.", "Node.js")).toBe(true);
    expect(containsTerm("javascript expert", "Java")).toBe(false);
  });
  it("only sends reworded bullets to the Claude check", () => {
    const t = honest();
    t.projects[0]!.bullets[0]!.text = "Built a study-group scheduling app used by 150 students in two semesters"; // exact copy
    const pairs = pairsToCheck(profile, t);
    expect(pairs.map((p) => p.rewritten)).not.toContain(t.projects[0]!.bullets[0]!.text);
    expect(pairs[0]!.source).toBe(`${profile.summary!.text} (Skills: ${profile.skills.join(", ")})`);
  });
  it("gives project bullets their project's tech list as context", () => {
    const t = honest();
    t.projects[0]!.bullets[0]!.text = "Built a Next.js study-group scheduler used by 150 students";
    const pair = pairsToCheck(profile, t).find((p) => p.rewritten.startsWith("Built a Next.js"))!;
    expect(pair.source).toContain("(Technologies used: Next.js, Supabase, Tailwind CSS)");
  });
});

describe("assembleResume", () => {
  it("copies companies, titles and dates from the profile, not from Claude", () => {
    const r = assembleResume(profile, honest());
    expect(r.experience[0]).toMatchObject({ company: "Example Health", title: "Software Engineering Intern", start: "Jun 2024", end: "Aug 2024" });
    expect(r.basics.email).toBe("alex.sample@example.com");
    expect(r.education[0]!.school).toBe("University of Texas at Austin");
  });
  it("prints skills with your spelling and drops ones not in your profile", () => {
    const t = honest();
    t.skills.push("Kubernetes");
    expect(assembleResume(profile, t).skills).toEqual(["TypeScript", "React", "PostgreSQL"]);
  });
  it("skips entries whose id doesn't exist", () => {
    const t = honest();
    t.experience.push({ id: "exp9", bullets: [{ text: "Invented job", source_ids: ["exp9-b1"] }] });
    expect(assembleResume(profile, t).experience.map((e) => e.id)).toEqual(["exp1"]);
  });
});
