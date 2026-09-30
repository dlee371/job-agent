// Renders a TailoredResume to a one-page Letter PDF with Playwright (headless Chromium).
// If it spills onto a second page, the least relevant bullet is dropped and it's rendered
// again. Claude lists bullets most-relevant-first, so "least relevant" = the last bullet of
// the entry that has the most bullets.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { TailoredResume } from "@/schemas/tailor";
import { resumeHtml } from "./template";

export const OUTPUT_DIR = path.resolve(process.cwd(), "output");

/** Counts pages in a PDF by its page objects ("/Type /Page", not "/Type /Pages"). */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
}

/** Removes the last bullet of the entry with the most bullets (keeps at least 1 per entry). */
export function dropLeastRelevantBullet(r: TailoredResume): { resume: TailoredResume; dropped: string } | null {
  const entries = [...r.experience, ...r.projects].filter((x) => x.bullets.length > 1);
  if (entries.length === 0) return null;
  const target = entries.reduce((a, b) => (b.bullets.length >= a.bullets.length ? b : a));
  const dropped = target.bullets[target.bullets.length - 1]!.text;
  const trim = <T extends { id: string; bullets: unknown[] }>(x: T) => (x.id === target.id ? { ...x, bullets: x.bullets.slice(0, -1) } : x);
  return { resume: { ...r, experience: r.experience.map(trim), projects: r.projects.map(trim) }, dropped };
}

/** "Alex Sample" -> "Alex_Sample_Resume.pdf": the file name recruiters see. */
export function resumeFileName(name: string): string {
  return `${name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_Resume.pdf`;
}

export type RenderResult = { resume: TailoredResume; pdfPath: string; droppedBullets: string[]; fitsOnePage: boolean };

/**
 * Writes output/resumes/<applicationId>/<Name>_Resume.pdf. Pass a shared `browser` when
 * rendering many resumes (launching Chromium each time is slow).
 */
export async function renderResumePdf(resume: TailoredResume, applicationId: string, browser?: Browser): Promise<RenderResult> {
  const ownBrowser = browser ? null : await chromium.launch();
  const page = await (browser ?? ownBrowser!).newPage();
  try {
    let current = resume;
    const droppedBullets: string[] = [];
    let pdf: Buffer;

    for (;;) {
      await page.setContent(resumeHtml(current), { waitUntil: "load" });
      pdf = await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
      if (pdfPageCount(pdf) <= 1) break;
      const next = dropLeastRelevantBullet(current);
      if (!next) break; // can't shrink further; reported as not fitting
      current = next.resume;
      droppedBullets.push(next.dropped);
    }

    const dir = path.join(OUTPUT_DIR, "resumes", applicationId);
    fs.mkdirSync(dir, { recursive: true });
    const pdfPath = path.join(dir, resumeFileName(current.basics.name));
    fs.writeFileSync(pdfPath, pdf);
    return { resume: current, pdfPath, droppedBullets, fitsOnePage: pdfPageCount(pdf) <= 1 };
  } finally {
    await page.close();
    await ownBrowser?.close();
  }
}
