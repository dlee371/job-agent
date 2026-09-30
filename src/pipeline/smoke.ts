// `npm run smoke` — Phase 0 end-to-end check (the guide's "tell me a joke" test):
// calls both models through askStructured, then reads the cost rows back from llm_calls.
// Costs a fraction of a cent.
import { z } from "zod";
import { env } from "@/lib/env";
import { db, check } from "@/lib/db";
import { askStructured } from "@/lib/claude";
import { startRun, finishRun, forEachItem } from "@/lib/run";

const Joke = z.object({
  topic: z.string(),
  joke: z.string().min(1),
  rating: z.number().int().min(1).max(10), // Zod re-checks this range after the API returns
});

async function main() {
  const runId = await startRun("smoke");
  const models = [
    { label: "scoring", model: env.MODEL_SCORING, effort: undefined },
    { label: "tailoring", model: env.MODEL_TAILORING, effort: "low" as const },
  ];

  const stats = await forEachItem(
    models,
    async ({ label, model, effort }) => {
      const result = await askStructured({
        purpose: "smoke",
        model,
        system: "You are a friendly assistant for a software developer.",
        userBlock: "Tell me one short, clean programming joke and rate it from 1 to 10.",
        schema: Joke,
        effort,
        maxTokens: 2000,
        ids: { runId },
      });
      console.log(`✓ ${label} (${model}):`, JSON.stringify(result));
    },
    { label: (m) => `${m.label} model ${m.model}` },
  );

  const calls = check(
    await db.from("llm_calls").select("model, input_tokens, output_tokens, cost_usd").eq("run_id", runId),
    "read llm_calls",
  );
  console.log("\nllm_calls rows for this run:");
  console.table(calls);

  await finishRun(runId, stats);
  if (stats.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
