// Renders real PDFs with Playwright (takes a few seconds).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { Profile } from "@/schemas/profile";
import type { TailoredResume } from "@/schemas/tailor";
import { resumeHtml } from "@/resume/template";
import { dropLeastRelevantBullet, pdfPageCount, renderResumePdf, resumeFileName } from "@/resume/render";
import { assembleResume } from "@/tailor/assemble";

const profile = Profile.parse(JSON.parse(fs.readFileSync("templates/profile.example.json", "utf8")));
const resume: TailoredResume = assembleResume(profile, {
  summary: null,
  experience: [{ id: "exp1", bullets: profile.experience[0]!.bullets.map((b) => ({ text: b.text, source_ids: [b.id] })) }],
  projects: [{ id: "proj1", bullets: profile.projects[0]!.bullets.map((b) => ({ text: b.text, source_ids: [b.id] })) }],
  skills: profile.skills,
  education_ids: [],
  changes: [],
  gaps: [],
});

describe("resumeHtml", () => {
  it("uses standard section headings", () => {
    const html = resumeHtml(resume);
    for (const h of ["Experience", "Projects", "Education", "Skills"]) expect(html).toContain(`<h2>${h}</h2>`);
  });
  it("escapes HTML in your text", () => {
    const html = resumeHtml({ ...resume, skills: ["<script>alert(1)</script>"] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("dropLeastRelevantBullet", () => {
  it("drops the last bullet of the entry with the most bullets", () => {
    const next = dropLeastRelevantBullet(resume)!;
    expect(next.dropped).toBe(profile.experience[0]!.bullets[2]!.text);
    expect(next.resume.experience[0]!.bullets).toHaveLength(2);
  });
});

describe("resumeFileName", () => {
  it("makes a clean file name", () => expect(resumeFileName(" José O'Neil ")).toBe("Jos_O_Neil_Resume.pdf"));
});

describe("renderResumePdf", () => {
  let browser: Browser;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-test-"));
  const cwd = process.cwd();

  beforeAll(async () => {
    browser = await chromium.launch();
    process.chdir(outDir); // write PDFs to a temp folder, not your output/
  });
  afterAll(async () => {
    process.chdir(cwd);
    await browser.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("renders a one-page PDF", async () => {
    const r = await renderResumePdf(resume, "test-app", browser);
    expect(r.fitsOnePage).toBe(true);
    expect(r.droppedBullets).toEqual([]);
    expect(pdfPageCount(fs.readFileSync(r.pdfPath))).toBe(1);
  });

  it("drops bullets until an overlong resume fits on one page", async () => {
    const long = "Improved the reliability of an internal service by adding tests, fixing bugs and documenting how it works for the team";
    const big: TailoredResume = {
      ...resume,
      experience: Array.from({ length: 6 }, (_, i) => ({
        ...resume.experience[0]!,
        id: `exp${i + 1}`,
        bullets: Array.from({ length: 6 }, () => ({ text: long, source_ids: [] })),
      })),
    };
    const r = await renderResumePdf(big, "test-long", browser);
    expect(r.fitsOnePage).toBe(true);
    expect(r.droppedBullets.length).toBeGreaterThan(0);
    expect(pdfPageCount(fs.readFileSync(r.pdfPath))).toBe(1);
  });
});
