// `npm run profile` — converts data/resume.md into data/profile.draft.json.
//
// It NEVER writes data/profile.json. You review the draft, fix anything wrong,
// fill in standard_answers, and save it as profile.json yourself. The guide calls this
// "the most important 10 minutes of the project": a mistake here is copied into every
// application.
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { askStructured } from "@/lib/claude";
import { startRun, finishRun } from "@/lib/run";
import { PATHS, buildProfileDraft } from "@/lib/profile";
import { ProfileExtraction } from "@/schemas/profile";
import { PROFILE_EXTRACTION_SYSTEM, profileExtractionUserBlock } from "@/prompts/profile";

const rel = (file: string) => path.relative(process.cwd(), file);

async function main() {
  if (!fs.existsSync(PATHS.resume)) {
    console.error(`${rel(PATHS.resume)} not found. Save your resume there as Markdown first.`);
    process.exit(1);
  }
  const resume = fs.readFileSync(PATHS.resume, "utf8").trim();
  if (resume.length < 200) {
    console.error(`${rel(PATHS.resume)} looks too short (${resume.length} characters). Paste your full resume.`);
    process.exit(1);
  }

  console.log(`Converting ${rel(PATHS.resume)} with ${env.MODEL_TAILORING}…`);
  const runId = await startRun("profile");
  try {
    const extraction = await askStructured({
      purpose: "profile",
      model: env.MODEL_TAILORING,
      system: PROFILE_EXTRACTION_SYSTEM,
      userBlock: profileExtractionUserBlock(resume),
      schema: ProfileExtraction,
      effort: "medium",
      ids: { runId },
    });

    const draft = buildProfileDraft(extraction);
    fs.writeFileSync(PATHS.profileDraft, JSON.stringify(draft, null, 2) + "\n");
    await finishRun(runId, { processed: 1, succeeded: 1, failed: 0 });

    console.log(`\n✓ Wrote ${rel(PATHS.profileDraft)}`);
    console.log(
      `  ${draft.experience.length} experience, ${draft.projects.length} projects, ` +
        `${draft.education.length} education, ${draft.skills.length} skills`,
    );
    if (fs.existsSync(PATHS.profile)) {
      console.log(`\n! ${rel(PATHS.profile)} already exists and was NOT changed. Compare the two by hand.`);
    }
    console.log(`
Next:
  1. Read ${rel(PATHS.profileDraft)} line by line and fix anything wrong.
  2. Fill in standard_answers (see templates/profile.example.json for examples).
  3. Save it as ${rel(PATHS.profile)}.
  4. Run: npm run profile:check`);
  } catch (err) {
    await finishRun(runId, { processed: 1, succeeded: 0, failed: 1 }, err);
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
