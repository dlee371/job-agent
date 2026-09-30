// Supabase client using the service-role key. It bypasses RLS, so it must only run in
// server-side code (pipeline scripts, Next.js server components and server actions).
// If a client component ever imported this, env.ts would throw in the browser because the
// key is not exposed there — so the key cannot leak.
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Throws with a readable message if a Supabase call returned an error. */
export function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}
