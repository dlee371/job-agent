// Mapping tests use trimmed copies of real API responses (checked 2026-09-30).
import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/text";
import { mapGreenhouseJob } from "@/sources/greenhouse";
import { mapLeverPosting } from "@/sources/lever";
import { mapAshbyJob } from "@/sources/ashby";
import { mapJSearchJob } from "@/sources/jsearch";
import { mapAdzunaJob } from "@/sources/adzuna";
import { buildQueries } from "@/sources/queries";

describe("htmlToText", () => {
  it("decodes Greenhouse's double-encoded HTML", () => {
    const html = "&lt;h2&gt;About &amp;amp; us&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Build APIs&lt;/li&gt;&lt;li&gt;Ship&lt;/li&gt;&lt;/ul&gt;";
    expect(htmlToText(html)).toBe("About & us\n- Build APIs\n- Ship");
  });
});

describe("mapGreenhouseJob", () => {
  const board = { name: "Stripe", ats: "greenhouse" as const, boardToken: "stripe" };
  it("maps a job and uses the canonical Greenhouse form URL", () => {
    const j = mapGreenhouseJob(
      {
        id: 8172510,
        title: "Software Engineer",
        location: { name: "Remote in US" },
        absolute_url: "https://stripe.com/jobs/search?gh_jid=8172510",
        first_published: "2026-09-09T10:50:29-04:00",
        content: "&lt;p&gt;Hi&lt;/p&gt;",
        company_name: "Stripe",
      },
      board,
    )!;
    expect(j).toMatchObject({
      source: "greenhouse",
      externalId: "stripe:8172510",
      company: "Stripe",
      remote: true,
      workMode: "remote",
      description: "Hi",
      applyUrl: "https://job-boards.greenhouse.io/stripe/jobs/8172510",
      ats: "greenhouse",
      atsJobId: "8172510",
    });
  });
  it("returns null for malformed data instead of crashing", () => {
    expect(mapGreenhouseJob({ title: "No id" }, board)).toBeNull();
  });
});

describe("mapLeverPosting", () => {
  it("maps work mode, locations, the full description and yearly USD salary", () => {
    const j = mapLeverPosting(
      {
        id: "6ed76ce8",
        text: "Frontend Engineer",
        categories: { location: "Austin, TX", allLocations: ["Austin, TX", "Remote"] },
        workplaceType: "hybrid",
        descriptionPlain: "About the role",
        lists: [{ text: "Requirements", content: "<li>React</li>" }],
        additionalPlain: "Benefits",
        createdAt: 1786469891368,
        salaryRange: { min: 90000, max: 120000, interval: "per-year-salary", currency: "USD" },
      },
      { name: "Acme", ats: "lever", boardToken: "acme" },
    )!;
    expect(j.location).toBe("Austin, TX; Remote");
    expect(j.workMode).toBe("hybrid");
    expect(j.description).toBe("About the role\n\nRequirements\n- React\n\nBenefits");
    expect(j.salaryMin).toBe(90000);
    expect(j.applyUrl).toBe("https://jobs.lever.co/acme/6ed76ce8/apply");
  });
});

describe("mapAshbyJob", () => {
  const board = { name: "Ramp", ats: "ashby" as const, boardToken: "ramp" };
  it("trusts workplaceType over isRemote", () => {
    const j = mapAshbyJob(
      { id: "344", title: " Security Engineer ", location: "New York, NY", isListed: true, isRemote: true, workplaceType: "Hybrid" },
      board,
    )!;
    expect(j.title).toBe("Security Engineer");
    expect(j.workMode).toBe("hybrid");
    expect(j.remote).toBe(false);
  });
  it("skips unlisted jobs", () => {
    expect(mapAshbyJob({ id: "1", title: "x", isListed: false }, board)).toBeNull();
  });
});

describe("mapJSearchJob", () => {
  it("picks the Greenhouse link and reports the board for discovery", () => {
    const r = mapJSearchJob({
      job_id: "abc",
      job_title: "Junior Software Engineer",
      employer_name: "Acme",
      job_city: "Austin",
      job_state: "TX",
      job_is_remote: false,
      job_description: "Build.",
      job_apply_link: "https://www.linkedin.com/jobs/view/1",
      apply_options: [
        { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/1", is_direct: false },
        { publisher: "Acme", apply_link: "https://boards.greenhouse.io/acme/jobs/42", is_direct: true },
      ],
      job_min_salary: 80000,
      job_max_salary: 100000,
      job_salary_period: "YEAR",
    })!;
    expect(r.listing.applyUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/42");
    expect(r.listing.location).toBe("Austin, TX");
    expect(r.listing.salaryMax).toBe(100000);
    expect(r.boards).toEqual([{ name: "Acme", ats: "greenhouse", boardToken: "acme" }]);
  });
  it("ignores hourly salaries", () => {
    const r = mapJSearchJob({ job_id: "x", job_title: "T", employer_name: "E", job_min_salary: 25, job_salary_period: "HOUR" })!;
    expect(r.listing.salaryMin).toBeNull();
  });
});

describe("mapAdzunaJob", () => {
  it("strips highlight tags and ignores Adzuna's predicted salaries", () => {
    const j = mapAdzunaJob({
      id: 123,
      title: "<strong>Data</strong> Analyst",
      company: { display_name: "Acme" },
      location: { display_name: "Austin, Travis County" },
      description: "Analyze&hellip;",
      redirect_url: "https://www.adzuna.com/land/ad/123",
      salary_min: 70000,
      salary_is_predicted: "1",
    })!;
    expect(j.title).toBe("Data Analyst");
    expect(j.externalId).toBe("123");
    expect(j.salaryMin).toBeNull();
    expect(j.ats).toBe("other");
  });
});

describe("buildQueries", () => {
  it("makes one query per title × location, with remote as location null", () => {
    const qs = buildQueries({
      target_titles: ["Data Analyst", "Frontend Engineer"],
      locations: ["Austin, TX", "Remote (US)"],
      interests: [],
      max_commute_miles: null,
      work_modes: ["remote"],
      min_salary_usd: null,
      deal_breakers: [],
      max_years_required: 2,
    });
    expect(qs).toEqual([
      { title: "Data Analyst", location: "Austin, TX" },
      { title: "Data Analyst", location: null },
      { title: "Frontend Engineer", location: "Austin, TX" },
      { title: "Frontend Engineer", location: null },
    ]);
  });
});
