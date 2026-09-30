import { describe, expect, it } from "vitest";
import { canonicalApplyUrl, detectAts, isBlockedUrl } from "@/sources/detect-ats";
import { pickApplyUrl } from "@/sources/jsearch";

describe("detectAts", () => {
  it.each([
    ["https://boards.greenhouse.io/Stripe/jobs/8172510", { ats: "greenhouse", boardToken: "stripe", jobId: "8172510" }],
    ["https://job-boards.greenhouse.io/figma/jobs/123?gh_src=x", { ats: "greenhouse", boardToken: "figma", jobId: "123" }],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/9", { ats: "greenhouse", boardToken: "acme", jobId: "9" }],
    ["https://boards.greenhouse.io/embed/job_app?for=gitlab&token=555", { ats: "greenhouse", boardToken: "gitlab", jobId: "555" }],
    ["https://jobs.lever.co/palantir/6ed76ce8-4156/apply", { ats: "lever", boardToken: "palantir", jobId: "6ed76ce8-4156" }],
    ["https://jobs.ashbyhq.com/Ramp/34413f8d/application", { ats: "ashby", boardToken: "Ramp", jobId: "34413f8d" }],
  ])("detects %s", (url, expected) => {
    expect(detectAts(url)).toEqual(expected);
  });

  it.each([
    "https://stripe.com/jobs/search?gh_jid=8172510", // company site wrapping Greenhouse: token unknown
    "https://boards.greenhouse.io/stripe", // board page, not a job
    "https://acme.wd5.myworkdayjobs.com/careers/job/123",
    "not a url",
    null,
  ])("returns other for %s", (url) => {
    expect(detectAts(url).ats).toBe("other");
  });
});

describe("isBlockedUrl", () => {
  it("blocks LinkedIn and Indeed, including subdomains", () => {
    expect(isBlockedUrl("https://www.linkedin.com/jobs/view/1")).toBe(true);
    expect(isBlockedUrl("https://indeed.com/viewjob?jk=1")).toBe(true);
    expect(isBlockedUrl("https://www.indeed.com/viewjob?jk=1")).toBe(true);
  });
  it("does not block look-alike hosts", () => {
    expect(isBlockedUrl("https://notlinkedin.com/x")).toBe(false);
    expect(isBlockedUrl("https://jobs.lever.co/acme/1")).toBe(false);
  });
});

describe("canonicalApplyUrl", () => {
  it("builds the ATS's own form URL", () => {
    expect(canonicalApplyUrl("greenhouse", "stripe", "1")).toBe("https://job-boards.greenhouse.io/stripe/jobs/1");
    expect(canonicalApplyUrl("lever", "acme", "abc")).toBe("https://jobs.lever.co/acme/abc/apply");
    expect(canonicalApplyUrl("ashby", "Ramp", "x")).toBe("https://jobs.ashbyhq.com/Ramp/x/application");
    expect(canonicalApplyUrl("other", "a", "b")).toBeNull();
  });
});

describe("pickApplyUrl (JSearch)", () => {
  it("prefers an ATS link over direct and LinkedIn links", () => {
    const pick = pickApplyUrl([
      { url: "https://www.linkedin.com/jobs/view/1", isDirect: false },
      { url: "https://careers.acme.com/job/1", isDirect: true },
      { url: "https://boards.greenhouse.io/acme/jobs/42", isDirect: false },
    ]);
    expect(pick).toEqual({
      ats: "greenhouse",
      boardToken: "acme",
      jobId: "42",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/42",
    });
  });

  it("falls back to a direct link, never to LinkedIn/Indeed", () => {
    const pick = pickApplyUrl([
      { url: "https://www.indeed.com/viewjob?jk=1", isDirect: false },
      { url: "https://jobs.example.org/apply/7", isDirect: true },
    ]);
    expect(pick.applyUrl).toBe("https://jobs.example.org/apply/7");
    expect(pick.ats).toBe("other");
  });

  it("returns no link when only blocked links exist", () => {
    expect(pickApplyUrl([{ url: "https://www.linkedin.com/jobs/view/1", isDirect: true }]).applyUrl).toBeNull();
  });
});
