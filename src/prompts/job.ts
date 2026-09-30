// The <job> block shared by the scoring and tailoring prompts.

export type PromptJob = {
  source: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean | null;
  work_mode: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  description: string | null;
};

/**
 * The job-specific part of a prompt (never cached). Scoring trims the description to ~6,000
 * chars (~1,500 tokens; the requirements are almost always in there). Tailoring passes a larger
 * limit so it sees more of the job's vocabulary.
 */
export function jobBlock(job: PromptJob, today = new Date(), maxChars = 6000): string {
  const desc = job.description ?? "(no description)";
  const trimmed = desc.length > maxChars ? `${desc.slice(0, maxChars)}\n[…truncated]` : desc;
  const salary =
    job.salary_min || job.salary_max ? `$${job.salary_min ?? "?"} – $${job.salary_max ?? "?"} per year` : "not listed";
  const mode = job.work_mode ?? (job.remote === true ? "remote" : job.remote === false ? "not remote" : "unknown");

  const lines = [
    // The date lives here (not in the system prompt) so the cached prefix stays identical.
    `Today's date: ${today.toISOString().slice(0, 10)}`,
    "",
    "<job>",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? "unknown"} (work mode: ${mode})`,
    `Salary: ${salary}`,
    `Posted: ${job.posted_at ? job.posted_at.slice(0, 10) : "unknown"}`,
    "Description:",
    trimmed,
    "</job>",
  ];
  if (job.source === "adzuna") {
    lines.push("", "Note: only a short snippet of this job's description is available.");
  }
  return lines.join("\n");
}
