import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "data/**", "output/**", "next-env.d.ts", "src/lib/database.types.ts"]),
  // Safety rules for browser automation are added in Phase 5 (see ARCHITECTURE.md §11).
]);
