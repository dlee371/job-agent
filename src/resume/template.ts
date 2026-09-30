// One-page resume as HTML: plain, single column, standard headings (Summary, Experience,
// Projects, Education, Skills) so applicant tracking systems parse it correctly.
import type { TailoredResume } from "@/schemas/tailor";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const e = escapeHtml;
const dates = (start: string | null, end: string | null) => [start, end].filter(Boolean).map((d) => e(d!)).join(" – ");
const shortLink = (url: string) => e(url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));

function bullets(items: { text: string }[]): string {
  return items.length ? `<ul>${items.map((b) => `<li>${e(b.text)}</li>`).join("")}</ul>` : "";
}

export function resumeHtml(r: TailoredResume): string {
  const contact = [r.basics.email, r.basics.phone, r.basics.location].filter(Boolean).map((x) => e(x!));
  contact.push(...r.basics.links.map(shortLink));

  const sections: string[] = [];

  if (r.summary) sections.push(`<h2>Summary</h2><p>${e(r.summary.text)}</p>`);

  if (r.experience.length) {
    sections.push(
      `<h2>Experience</h2>` +
        r.experience
          .map(
            (x) => `<div class="entry">
  <div class="row"><span><b>${e(x.title)}</b>, ${e(x.company)}${x.location ? ` — ${e(x.location)}` : ""}</span><span>${dates(x.start, x.end)}</span></div>
  ${bullets(x.bullets)}
</div>`,
          )
          .join(""),
    );
  }

  if (r.projects.length) {
    sections.push(
      `<h2>Projects</h2>` +
        r.projects
          .map(
            (p) => `<div class="entry">
  <div class="row"><span><b>${e(p.name)}</b>${p.tech.length ? ` | ${p.tech.map(e).join(", ")}` : ""}${p.link ? ` | ${shortLink(p.link)}` : ""}</span><span>${p.dates ? e(p.dates) : ""}</span></div>
  ${bullets(p.bullets)}
</div>`,
          )
          .join(""),
    );
  }

  if (r.education.length) {
    sections.push(
      `<h2>Education</h2>` +
        r.education
          .map(
            (x) => `<div class="entry">
  <div class="row"><span><b>${e(x.school)}</b> — ${e(x.degree)}${x.field ? `, ${e(x.field)}` : ""}${x.gpa ? ` (GPA ${e(x.gpa)})` : ""}</span><span>${dates(x.start, x.end)}</span></div>
  ${bullets(x.details.map((text) => ({ text })))}
</div>`,
          )
          .join(""),
    );
  }

  if (r.skills.length) sections.push(`<h2>Skills</h2><p>${r.skills.map(e).join(", ")}</p>`);

  if (r.certifications.length) {
    sections.push(`<h2>Certifications</h2><p>${r.certifications.map((c) => `${e(c.name)}${c.date ? ` (${e(c.date)})` : ""}`).join("; ")}</p>`);
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${e(r.basics.name)} — Resume</title>
<style>
  @page { size: Letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.3; color: #111; }
  h1 { font-size: 18pt; margin: 0; text-align: center; }
  .contact { text-align: center; font-size: 9.5pt; margin: 2pt 0 6pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.5pt; border-bottom: 1px solid #444; margin: 8pt 0 3pt; padding-bottom: 1pt; }
  p { margin: 0 0 2pt; }
  .entry { margin-bottom: 4pt; }
  .row { display: flex; justify-content: space-between; gap: 12pt; }
  .row span:last-child { white-space: nowrap; }
  ul { margin: 1pt 0 0 0; padding-left: 14pt; }
  li { margin: 0 0 1pt; }
</style></head>
<body>
  <h1>${e(r.basics.name)}</h1>
  <div class="contact">${contact.join(" | ")}</div>
  ${sections.join("\n  ")}
</body></html>`;
}
