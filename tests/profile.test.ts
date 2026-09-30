import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProfileDraft, checkPreferences, checkProfile, factIndex } from "@/lib/profile";
import { Profile, type ProfileExtraction } from "@/schemas/profile";

const example = () => JSON.parse(fs.readFileSync("templates/profile.example.json", "utf8"));

const extraction: ProfileExtraction = {
  basics: {
    name: "Alex Sample",
    email: "alex@example.com",
    phone: null,
    location: "Austin, TX",
    links: { linkedin: null, github: "github.com/alex", website: null },
  },
  summary: "  Builds web apps.  ",
  education: [
    { school: "UT Austin", degree: "B.S.", field: "CS", start: null, end: "2025", gpa: null, details: ["Dean's list"] },
  ],
  experience: [
    { company: "A", title: "Intern", location: null, start: "Jun 2024", end: "Aug 2024", bullets: ["Did X", " ", "Did Y"] },
    { company: "B", title: "TA", location: null, start: "2023", end: "Present", bullets: ["Taught Z"] },
  ],
  projects: [{ name: "P", link: null, dates: null, tech: ["React"], bullets: ["Built P"] }],
  skills: ["React", "React", " Git "],
  certifications: [{ name: "AWS CCP", date: "2024" }],
};

describe("buildProfileDraft", () => {
  const draft = buildProfileDraft(extraction);

  it("assigns ids in resume order", () => {
    expect(draft.experience.map((e) => e.id)).toEqual(["exp1", "exp2"]);
    expect(draft.experience[0]!.bullets).toEqual([
      { id: "exp1-b1", text: "Did X" },
      { id: "exp1-b2", text: "Did Y" }, // blank bullet dropped
    ]);
    expect(draft.education[0]!.details[0]!.id).toBe("edu1-d1");
    expect(draft.projects[0]!.bullets[0]!.id).toBe("proj1-b1");
    expect(draft.certifications[0]!.id).toBe("cert1");
    expect(draft.summary).toEqual({ id: "summary", text: "Builds web apps." });
  });

  it("de-duplicates skills without changing their spelling", () => {
    expect(draft.skills).toEqual(["React", "Git"]);
  });

  it("leaves every standard answer empty for the user to fill in", () => {
    expect(draft.standard_answers.needs_sponsorship).toBeNull();
    expect(draft.standard_answers.eeo.gender).toBeNull();
  });

  it("produces a draft that is a valid profile once required fields exist", () => {
    expect(Profile.safeParse(draft).success).toBe(true);
  });
});

describe("checkProfile", () => {
  it("accepts the example profile with no errors", () => {
    const result = checkProfile(example());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["standard_answers.salary_expectation is empty"]);
  });

  it("reports duplicate ids", () => {
    const p = example();
    p.experience[0].bullets[1].id = "exp1-b1";
    expect(checkProfile(p).errors).toContain('Duplicate id "exp1-b1" — every id must be unique');
  });

  it("reports a missing email with its path", () => {
    const p = example();
    p.basics.email = null;
    expect(checkProfile(p).errors.join()).toMatch(/basics\.email/);
  });

  it("warns about links without https://", () => {
    const p = example();
    p.basics.links.github = "github.com/alex";
    expect(checkProfile(p).warnings.join()).toMatch(/links\.github should start with https/);
  });
});

describe("factIndex", () => {
  it("maps every id to its text", () => {
    const index = factIndex(Profile.parse(example()));
    expect(index.get("exp1-b2")).toBe("Wrote PostgreSQL queries that cut the report page load time from 8s to 2s");
    expect(index.get("exp1")).toBe("Software Engineering Intern at Example Health");
    expect(index.get("summary")).toMatch(/^Computer Science graduate/);
  });
});

describe("checkPreferences", () => {
  it("accepts the template", () => {
    const prefs = JSON.parse(fs.readFileSync("templates/preferences.example.json", "utf8"));
    expect(checkPreferences(prefs).errors).toEqual([]);
  });

  it("rejects an unknown work mode", () => {
    const prefs = JSON.parse(fs.readFileSync("templates/preferences.example.json", "utf8"));
    prefs.work_modes = ["remote", "on-site"];
    expect(checkPreferences(prefs).errors.join()).toMatch(/work_modes/);
  });
});
