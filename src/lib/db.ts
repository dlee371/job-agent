// Supabase client using the service-role key. It bypasses RLS, so it must only run in
// server-side code (pipeline scripts, Next.js server components and server actions).
// If a client component ever imported this, env.ts would throw in the browser because the
// key is not exposed there — so the key cannot leak.
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Supabase returns at most 1000 rows per request. This reads every page.
 * Usage: fetchAll((from, to) => db.from("jobs").select("id").eq("status", "new").order("id").range(from, to), "load jobs")
 * Always include an .order() so pages don't overlap.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`${what} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

/** Throws with a readable message if a Supabase call returned an error. */
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}
