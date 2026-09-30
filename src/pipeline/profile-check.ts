// `npm run profile:check` — validates data/profile.json and data/preferences.json.
// Free to run (no Claude calls, no database). Exits with code 1 if there are errors.
import fs from "node:fs";
import path from "node:path";
import { PATHS, checkPreferences, checkProfile, readJson, type CheckResult } from "@/lib/profile";

const rel = (file: string) => path.relative(process.cwd(), file);

function report(label: string, file: string, check: (raw: unknown) => CheckResult): boolean {
  console.log(`\n${label} (${rel(file)})`);
  let result: CheckResult;
  try {
    result = check(readJson(file));
  } catch (err) {
    result = { errors: [(err as Error).message], warnings: [] };
  }
  for (const e of result.errors) console.log(`  ✗ ${e}`);
  for (const w of result.warnings) console.log(`  ! ${w}`);
  if (result.errors.length === 0) {
    console.log(result.warnings.length ? `  ✓ valid, with ${result.warnings.length} things to review` : "  ✓ valid");
  }
  return result.errors.length === 0;
}

function main() {
  if (!fs.existsSync(PATHS.profile) && fs.existsSync(PATHS.profileDraft)) {
    console.log(`Found ${rel(PATHS.profileDraft)} but no ${rel(PATHS.profile)}.`);
    console.log("Review the draft, then save it as profile.json.");
  }
  if (!fs.existsSync(PATHS.preferences)) {
    console.log(`No ${rel(PATHS.preferences)} yet. Start from the template:`);
    console.log("  cp templates/preferences.example.json data/preferences.json");
  }

  const profileOk = report("Profile", PATHS.profile, checkProfile);
  const prefsOk = report("Preferences", PATHS.preferences, checkPreferences);

  if (profileOk && prefsOk) {
    console.log("\n✅ Profile and preferences are valid.");
    console.log("   '!' lines are optional, but each empty standard answer means more flagged form fields later.");
  } else {
    console.log("\n❌ Fix the ✗ lines above and run this again.");
    process.exit(1);
  }
}

main();
