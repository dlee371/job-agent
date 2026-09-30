// The cheap Claude fact-check (Haiku): compares each rewritten bullet with the profile
// bullets it cites. Catches what code can't, like "helped with" becoming "led".
import { env } from "@/lib/env";
import { askStructured, type LinkIds } from "@/lib/claude";
import type { Profile } from "@/schemas/profile";
import { FactCheckLLM, type FactCheckIssue, type TailorResult } from "@/schemas/tailor";
import { FACTCHECK_SYSTEM, factCheckUserBlock } from "@/prompts/tailor";
import { pairsToCheck } from "./deterministic";

export async function llmFactCheck(profile: Profile, t: TailorResult, ids: LinkIds): Promise<FactCheckIssue[]> {
  const pairs = pairsToCheck(profile, t);
  if (pairs.length === 0) return []; // nothing was reworded

  const result = await askStructured({
    purpose: "factcheck",
    model: env.MODEL_SCORING,
    system: FACTCHECK_SYSTEM,
    userBlock: factCheckUserBlock(pairs),
    schema: FactCheckLLM,
    maxTokens: 4000,
    ids,
  });
  return result.unsupported.map((u) => ({
    check: "llm_unsupported" as const,
    detail: `${u.claim} (${u.reason})`,
    bullet_text: pairs[u.pair - 1]?.rewritten ?? null,
  }));
}
