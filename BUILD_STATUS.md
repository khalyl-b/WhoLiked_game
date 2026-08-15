# Build status

Date: 2026-08-15

## Deployment-critical fixes completed

- Replaced process-local production game state with `SupabaseGameEngine` persistence.
- Added a storage-independent `GameService` boundary so local memory mode and deployed Supabase mode share the same API routes.
- Production now refuses `GAME_STORAGE=memory`, preventing accidental deployment with volatile Vercel function RAM.
- Added atomic PostgreSQL RPCs with row locks for join capacity, game start, guesses, reveal/scoring, clock advancement, rematch, leave, kick, skip and end-game operations.
- Added Supabase Auth anonymous identities for deployed players so refresh/reconnect is tied to a persistent internal user.
- Browser now creates the anonymous identity before create/join actions, avoiding unnecessary concentration of anonymous signup traffic through the Vercel server path.
- Added persistent encrypted TikTok social-account/token storage instead of a production global `Map`.
- Added current Supabase publishable/secret key support with legacy key fallbacks.
- Reduced continuous room polling from roughly once per second to Supabase Realtime plus deadline-specific refreshes and a 10-second recovery poll.
- Added `/api/health` to verify that production is using Supabase and can see the game schema.
- Added `supabase/bootstrap.sql` for one-paste setup of a new Supabase project.
- Added a dedicated optional `TIKTOK_TOKEN_ENCRYPTION_KEY`, with `SESSION_SECRET` retained as a fallback.
- Added `DEPLOY_FREE.md` with the £0 Vercel Hobby + Supabase Free deployment path.

## Core implementation already present

- Next.js App Router project structure and mobile-first game UI.
- Create/join/lobby/game/reveal/leaderboard/rematch flow.
- Fair round distribution and owner sequencing.
- Duplicate-owner video exclusion.
- Minimum eligible activity validation.
- Server-side deadline/host/membership/guess validation.
- Automatic reveal, scoring and progression.
- Fake TikTok provider behind `SocialActivityProvider`.
- RLS, indexes, foreign keys and unique constraints.
- TikTok Login Kit OAuth structure with CSRF state, token exchange, refresh and revoke handling.
- Unit, integration and four-context Playwright test suites.

## Verification actually executed in this environment

Passed earlier in this build session:

1. Pure TypeScript game-logic compilation.
2. Fair round-allocation smoke check.
3. Duplicate-video exclusion smoke check.
4. Compiled four-player, five-round authoritative memory-engine smoke test.
5. Pre-reveal answer-hiding smoke check.
6. Score/reveal/final/rematch smoke check.
7. Room-capacity smoke check.
8. Duplicate-guess rejection smoke check.
9. Deadline-rejection/deadline-triggered reveal smoke check.
10. Temporary dependency-stub project TypeScript validation for the modified server/API surface.
11. Syntax checks over non-TSX TypeScript files.

After the Supabase/serverless refactor, source-level/static checks were repeated where package-independent. See the final handoff response for the exact commands/results.

## Environment limitation

This execution container cannot currently complete `npm install` from the public npm registry, so real package-backed checks cannot honestly be reported as passed here.

The following still must be run in a normal connected development machine or by Vercel's build environment:

- `npm install`
- `npm run typecheck` against the real dependency typings
- `npm run lint`
- `npm run test`
- `npm run build`
- Playwright browser E2E
- the SQL migrations against a real Supabase Free project
- live Supabase Realtime testing across independent clients

`DEPLOY_FREE.md` includes a `/api/health` test and a four-player manual verification sequence specifically so these remaining external-environment checks are explicit rather than assumed.
