// The ONLY file that reads process.env. Everything else imports `env` from here.
// Validating up front means a missing key fails immediately with a clear message,
// instead of halfway through a run.
import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

const EnvSchema = z.object({
  // secrets
  ANTHROPIC_API_KEY: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // job sources are optional until Phase 2; each source checks its own key
  RAPIDAPI_KEY: z.string().optional(),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),

  // models
  MODEL_SCORING: z.string().min(1),
  MODEL_TAILORING: z.string().min(1),

  // volume & quality
  DAILY_APPLICATION_CAP: z.coerce.number().int().positive().default(25),
  FIT_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
  BATCH_MIN_JOBS: z.coerce.number().int().positive().default(20),
  MAX_JOB_AGE_DAYS: z.coerce.number().int().positive().default(21),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // Free API tiers are small (JSearch free ≈ 200 requests/month), so cap requests per source per run.
  SEARCH_MAX_REQUESTS_PER_SOURCE: z.coerce.number().int().positive().default(25),
  ADZUNA_COUNTRY: z.string().default("us"),

  // runtime
  CLAUDE_CONCURRENCY: z.coerce.number().int().positive().default(4),
  FILL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  HEADLESS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SUBMIT_MODE: z.enum(["assist", "auto"]).default("assist"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  // Treat empty strings in .env ("RAPIDAPI_KEY=") as "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid or missing settings in .env (see .env.example):\n${problems}`);
  }
  return result.data;
}

export const env = loadEnv();
