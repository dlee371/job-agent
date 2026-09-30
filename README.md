# Job Agent

A local job application agent: finds jobs, scores fit with Claude, tailors your resume, pre-fills
applications, and submits **only** what you approve in a local review UI.

- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Rules for Claude Code: [CLAUDE.md](CLAUDE.md)

## Setup (once)

1. Install a Docker runtime (needed by local Supabase): [OrbStack](https://orbstack.dev) or
   [Docker Desktop](https://www.docker.com/products/docker-desktop/). Start it.
2. `npm install`
3. `npx playwright install chromium`
4. `npm run db:start`. This starts local Supabase and applies `supabase/migrations/`.
5. `cp .env.example .env`, then fill in:
   - `ANTHROPIC_API_KEY` from console.anthropic.com (set a monthly spend limit there too)
   - `SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status -o env` (the `SERVICE_ROLE_KEY` value)

## Everyday commands

| Command | What it does |
|---|---|
| `npm run db:start` / `db:stop` | Start / stop local Supabase (Studio: http://127.0.0.1:54323) |
| `npm run db:reset` | Wipe the local DB and re-apply migrations |
| `npm run check` | Validate `.env` and check every table is reachable (no Claude calls) |
| `npm run smoke` | Call both Claude models once and log the cost (< $0.01) |
| `npm run dev` | Review UI at http://127.0.0.1:3000 |
| `npm test` | Unit tests (DB tests are skipped when Supabase isn't running) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
