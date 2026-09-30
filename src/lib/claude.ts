// The one place that talks to Claude. Every call:
//   1. builds the prompt in a fixed order so prompt caching works
//      (system rules -> profile block [cached] -> job-specific block [not cached]),
//   2. uses structured outputs, so the API itself guarantees JSON matching our Zod schema,
//   3. re-validates with Zod (for rules like 0-100 ranges that JSON Schema can't fully express),
//   4. logs tokens + cost to `llm_calls`.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "./env";
import { db, check } from "./db";
import { costUsd, supportsServerFallback } from "./pricing";

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  maxRetries: 4, // the SDK retries 429 / 5xx / network errors with backoff
});

export type Purpose = "smoke" | "profile" | "score" | "tailor" | "factcheck" | "form_answers" | "cover_letter";

export type LinkIds = { runId?: string; jobId?: string; applicationId?: string };

export type AskOptions<S extends z.ZodType> = {
  purpose: Purpose;
  model: string;
  /** Static instructions. Must be identical across calls (no dates, ids, etc.) or caching breaks. */
  system: string;
  /** Profile + preferences text. Identical across calls, so it gets a cache breakpoint. */
  profileBlock?: string;
  /** Job-specific content (changes every call, never cached). */
  userBlock: string;
  schema: S;
  /** Thinking effort for models that support it (Sonnet 5.5). Leave unset for Haiku. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  ids?: LinkIds;
};

/** Profile block (cached) then job block (not cached). Same order everywhere so caching works. */
function buildContent(profileBlock: string | undefined, userBlock: string): Anthropic.TextBlockParam[] {
  const content: Anthropic.TextBlockParam[] = [];
  if (profileBlock) {
    // The cache breakpoint covers everything before it too (system + profile).
    content.push({ type: "text", text: profileBlock, cache_control: { type: "ephemeral" } });
  }
  content.push({ type: "text", text: userBlock });
  return content;
}

export async function askStructured<S extends z.ZodType>(opts: AskOptions<S>): Promise<z.infer<S>> {
  const content = buildContent(opts.profileBlock, opts.userBlock);

  const useFallback = supportsServerFallback(opts.model);

  const res = await anthropic.beta.messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content }],
    output_config: {
      format: betaZodOutputFormat(opts.schema),
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
    // If a safety classifier declines the request, retry it on a fallback model
    // instead of failing (supported on Sonnet 5.5 / Opus 5.5 only).
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  // Log cost before checking the result: a failed call still costs money.
  await logLlmCall({
    purpose: opts.purpose,
    model: res.model, // the model that actually answered (may be a fallback)
    usage: res.usage,
    stopReason: res.stop_reason,
    ids: opts.ids,
  });

  if (res.stop_reason === "refusal") throw new Error("Claude declined this request (stop_reason: refusal)");
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens); raise maxTokens");
  if (res.parsed_output == null) throw new Error("Claude's answer did not match the expected schema");

  // Second check with the full Zod schema (ranges, formats, etc.).
  return opts.schema.parse(res.parsed_output);
}

// ---------------------------------------------------------------------------
// Message Batches (50% cheaper, results within ~1 hour, max 24 hours).
// The batch API has no parse() helper, so we send the same JSON schema ourselves
// and validate each result with Zod when we collect it.
// ---------------------------------------------------------------------------

export type BatchRequestOptions<S extends z.ZodType> = Omit<AskOptions<S>, "purpose" | "ids"> & { customId: string };

export function batchRequest<S extends z.ZodType>(opts: BatchRequestOptions<S>): Anthropic.Messages.BatchCreateParams.Request {
  const { type, schema } = zodOutputFormat(opts.schema); // drop the parse() function
  return {
    custom_id: opts.customId,
    params: {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: buildContent(opts.profileBlock, opts.userBlock) }],
      output_config: { format: { type, schema }, ...(opts.effort ? { effort: opts.effort } : {}) },
    },
  };
}

/** Validates one succeeded batch message. Throws with a clear reason if it can't be used. */
export function parseBatchMessage<S extends z.ZodType>(message: Anthropic.Message, schema: S): z.infer<S> {
  if (message.stop_reason === "refusal") throw new Error("Claude declined this request (stop_reason: refusal)");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens)");
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return schema.parse(JSON.parse(text));
}

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
};

/** Writes one row to llm_calls. Also used by the batch scorer in Phase 3. */
export async function logLlmCall(args: {
  purpose: Purpose;
  model: string;
  usage: UsageLike;
  stopReason: string | null;
  ids?: LinkIds;
  isBatch?: boolean;
}): Promise<void> {
  const tokens = {
    inputTokens: args.usage.input_tokens,
    outputTokens: args.usage.output_tokens,
    cacheCreationTokens: args.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: args.usage.cache_read_input_tokens ?? 0,
  };
  const cost = costUsd(args.model, tokens, args.isBatch);
  if (cost === null) console.warn(`  ! No price for model "${args.model}" — add it to src/lib/pricing.ts`);

  check(
    await db.from("llm_calls").insert({
      run_id: args.ids?.runId ?? null,
      job_id: args.ids?.jobId ?? null,
      application_id: args.ids?.applicationId ?? null,
      purpose: args.purpose,
      model: args.model,
      is_batch: args.isBatch ?? false,
      input_tokens: tokens.inputTokens,
      output_tokens: tokens.outputTokens,
      cache_creation_tokens: tokens.cacheCreationTokens,
      cache_read_tokens: tokens.cacheReadTokens,
      cost_usd: cost,
      stop_reason: args.stopReason,
    }),
    "logLlmCall",
  );
}
