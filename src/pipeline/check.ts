// `npm run check` — confirms .env is valid and the database is reachable with the schema applied.
// Makes no Claude calls (free to run).
import { env } from "@/lib/env";
import { db } from "@/lib/db";

async function main() {
  console.log("✓ .env is valid");
  console.log(`  scoring model:   ${env.MODEL_SCORING}`);
  console.log(`  tailoring model: ${env.MODEL_TAILORING}`);
  console.log(`  daily cap: ${env.DAILY_APPLICATION_CAP}, fit threshold: ${env.FIT_SCORE_THRESHOLD}, submit mode: ${env.SUBMIT_MODE}`);

  const tables = ["companies", "jobs", "applications", "application_events", "runs", "llm_batches", "llm_calls"];
  for (const table of tables) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.error(`✗ table "${table}": ${error.message}`);
      console.error("  Is Supabase running (npm run db:start) and the migration applied (npm run db:reset)?");
      process.exit(1);
    }
    console.log(`✓ ${table.padEnd(18)} ${count} rows`);
  }
  console.log("All good.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
