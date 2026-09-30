// Turns a ScoreResult into the database update for a job. Shared by direct and batch scoring.
import type { ScoreResult } from "@/schemas/score";

export function scoreToUpdate(result: ScoreResult, threshold: number) {
  const shortlisted = result.fit_score >= threshold && !result.deal_breaker_hit;
  const reasons = result.deal_breaker_hit && result.deal_breaker ? [`Deal breaker: ${result.deal_breaker}`, ...result.reasons] : result.reasons;
  return {
    status: shortlisted ? ("shortlisted" as const) : ("skipped" as const),
    fit_score: result.fit_score,
    fit_reasons: reasons,
    missing_requirements: result.missing_requirements,
    deal_breaker_hit: result.deal_breaker_hit,
    scored_at: new Date().toISOString(),
    score_batch_id: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
}
