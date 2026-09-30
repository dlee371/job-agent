// fetch() with a timeout, a couple of retries for flaky networks, and readable errors.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; retries?: number; label?: string } = {},
): Promise<T> {
  const { headers, timeoutMs = 30_000, retries = 2, label = new URL(url).hostname } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        const err = new HttpError(res.status, `${label} returned HTTP ${res.status}: ${body}`);
        // 4xx (bad key, not found, quota used up) won't fix itself on retry; 429/5xx might.
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } else {
        return (await res.json()) as T;
      }
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
