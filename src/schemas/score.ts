// What Claude returns when scoring one job (ARCHITECTURE.md §9).
import { z } from "zod";

export const ScoreResult = z.object({
  fit_score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(5), // why it fits (or doesn't), citing facts
  missing_requirements: z.array(z.string()), // hard requirements the candidate doesn't meet
  deal_breaker_hit: z.boolean(),
  deal_breaker: z.string().nullable(), // which deal breaker, when hit
});
export type ScoreResult = z.infer<typeof ScoreResult>;
