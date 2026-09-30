// Recognizes errors that should STOP a whole run instead of counting as one item's failure.
//
// When you hit a spend limit, every request fails until next month (or until you raise it).
// Without this check the pipeline would keep going and mark every job as failed.

export class FatalRunError extends Error {}

export function isSpendLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; error?: { error?: { details?: { error_code?: string } } } };
  // Your own limit (Billing page): HTTP 400, "You have reached your specified ... API usage limits"
  if (/reached your specified (workspace )?API usage limits/i.test(e.message)) return true;
  // Your tier's monthly cap: HTTP 429 with error_code enforced_spend_limit_reached
  if (e.error?.error?.details?.error_code === "enforced_spend_limit_reached") return true;
  return /enforced_spend_limit_reached|crossed its monthly API usage threshold/i.test(e.message);
}

/** Errors that no retry or next item can fix: a bad API key, or a spend limit. */
export function isFatalApiError(err: unknown): boolean {
  if (isSpendLimitError(err)) return true;
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}
