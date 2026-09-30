// Works out which applicant tracking system (ATS) a URL belongs to.
// Phase 5 can only pre-fill Greenhouse / Lever / Ashby forms; everything else is 'other'
// (materials are still prepared, and you apply by hand).

export type Ats = "greenhouse" | "lever" | "ashby" | "other";
export type AtsInfo = { ats: Ats; boardToken: string | null; jobId: string | null };

const OTHER: AtsInfo = { ats: "other", boardToken: null, jobId: null };

// We never open or scrape these (their terms forbid bots). See CLAUDE.md.
const BLOCKED_HOSTS = ["linkedin.com", "indeed.com"];

function parse(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isBlockedUrl(url: string | null | undefined): boolean {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
}

export function detectAts(url: string | null | undefined): AtsInfo {
  const u = parse(url);
  if (!u) return OTHER;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // boards.greenhouse.io/{token}/jobs/{id}, job-boards.greenhouse.io/{token}/jobs/{id} (+ .eu. variants)
  if (/^(job-)?boards(\.eu)?\.greenhouse\.io$/.test(host)) {
    // Embedded form: boards.greenhouse.io/embed/job_app?for={token}&token={id}
    if (parts[0] === "embed") {
      const token = u.searchParams.get("for");
      const id = u.searchParams.get("token");
      return token && id ? { ats: "greenhouse", boardToken: token.toLowerCase(), jobId: id } : OTHER;
    }
    if (parts.length >= 3 && parts[1] === "jobs" && /^\d+$/.test(parts[2]!)) {
      return { ats: "greenhouse", boardToken: parts[0]!.toLowerCase(), jobId: parts[2]! };
    }
    return OTHER;
  }

  // jobs.lever.co/{company}/{uuid}[/apply] (+ jobs.eu.lever.co)
  if (/^jobs(\.eu)?\.lever\.co$/.test(host) && parts.length >= 2) {
    return { ats: "lever", boardToken: parts[0]!.toLowerCase(), jobId: parts[1]! };
  }

  // jobs.ashbyhq.com/{board}/{uuid}[/application]  (board names are case-sensitive)
  if (host === "jobs.ashbyhq.com" && parts.length >= 2) {
    return { ats: "ashby", boardToken: parts[0]!, jobId: parts[1]! };
  }

  return OTHER;
}

/**
 * The ATS's own application page for a job. We always use this instead of a company's
 * careers page, which often wraps the form in an iframe (e.g. stripe.com/jobs/...?gh_jid=).
 */
export function canonicalApplyUrl(ats: Ats, boardToken: string | null, jobId: string | null): string | null {
  if (!boardToken || !jobId) return null;
  switch (ats) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;
    case "lever":
      return `https://jobs.lever.co/${boardToken}/${jobId}/apply`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${boardToken}/${jobId}/application`;
    default:
      return null;
  }
}
