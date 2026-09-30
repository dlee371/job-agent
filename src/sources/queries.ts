import type { Preferences } from "@/schemas/profile";
import type { SearchQuery } from "./jsearch";

/** One query per target title × location. "Remote (US)" becomes one remote query per title. */
export function buildQueries(prefs: Preferences): SearchQuery[] {
  const queries: SearchQuery[] = [];
  for (const title of prefs.target_titles) {
    for (const location of prefs.locations) {
      queries.push({ title, location: /remote/i.test(location) ? null : location });
    }
  }
  return queries;
}
