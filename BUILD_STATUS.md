# Build status

Date: 2026-08-15

## TikTok data-import stage completed in code

- Added public `/privacy` and `/terms` pages aligned with the implemented TikTok/Supabase data flow.
- Added always-visible legal/account footer navigation.
- Added `/tiktok-import` as the consent/explanation screen before the Data Portability authorisation flow.
- Added `/review/tiktok-portability` to make the required review screenshots straightforward to capture.
- Added a real `TikTokProvider` that consumes imported activity through the existing `SocialActivityProvider` interface.
- Added `SOCIAL_ACTIVITY_PROVIDER=fake|tiktok` switching without changing the multiplayer game engine.
- Added explicit `import_source` tracking so fake fixture activity cannot be counted as real activity after switching to the TikTok provider.
- Added server-side TikTok Data Portability request, status, download and import services.
- Added the Data Portability OAuth entry route requesting `portability.all.single` for a one-time transfer.
- Added a signed `/api/webhooks/tiktok` endpoint with timestamped HMAC-SHA256 verification against the exact raw body.
- Added handling for `portability.download.ready` and `authorization.removed` webhook events.
- Added ZIP parsing for TikTok's Like List. Favourite Videos and unrelated archive categories are deliberately not interpreted as likes.
- Added server-side TikTok URL validation, stable video-ID derivation and deduplication before database import.
- Added a 100 MB automatic archive safety limit and retry-safe import claiming.
- Added account activity-readiness UI, portability status/progress, import action and useful insufficient-activity messaging.
- Updated the round media card so real imported TikTok video IDs render through TikTok's official web player, while fixture rounds retain the development card and non-embeddable links have a safe fallback.
- Added a manual archive fallback. The browser parses the user's own TikTok ZIP/JSON/TXT file and only extracted Like List records are sent to the server.
- Added real imported-data deletion and disconnect/cancel/revoke behaviour.
- Added migration `0004_tiktok_portability.sql` for portability request tracking, import-source provenance, indexes, RLS, Realtime and privileged import/delete RPCs.
- Rebuilt `supabase/bootstrap.sql` so brand-new databases receive migrations 0001 through 0004 in one run.
- Added `TIKTOK_NEXT_STEPS.md`, `TIKTOK_REVIEW_APPLICATION.md` and `docs/TIKTOK_DATA_FLOW.md`.
- Added unit tests for archive parsing, webhook signatures, status validation, URL-derived IDs/deduplication and provider switching.

## Deployment-critical fixes retained

- Production game state uses `SupabaseGameEngine`, not Vercel function RAM.
- `GameService` keeps local memory and production Supabase runtimes behind the same API surface.
- Production refuses `GAME_STORAGE=memory`.
- Race-sensitive game mutations use PostgreSQL RPCs/locks.
- Supabase anonymous users provide stable internal identities across refresh/reconnect.
- Browser Realtime uses safe room/player rows and refetches sanitised state.
- OAuth tokens are encrypted before storage.
- Current Supabase publishable/secret keys are supported, with legacy fallbacks.
- `/api/health` checks production storage/database connectivity.

## Core multiplayer implementation

- Next.js App Router project structure and mobile-first game UI.
- Create/join/lobby/game/reveal/leaderboard/rematch flow.
- Fair round distribution and owner sequencing.
- Duplicate-owner video exclusion.
- Minimum eligible activity validation.
- Server-side deadline/host/membership/guess validation.
- Automatic reveal, scoring and progression.
- Fake and real TikTok activity providers behind `SocialActivityProvider`.
- RLS, indexes, foreign keys and unique constraints.
- TikTok Login Kit OAuth with CSRF state, token exchange, refresh and revoke handling.
- Unit, integration and four-context Playwright test suites.

## Verification executed in this environment

Passed in this build session:

1. TypeScript parser sweep over all current TS/TSX source and tests: 70 files, zero syntax diagnostics.
2. Strict selective TypeScript validation of the new TikTok archive, portability, OAuth and provider modules using temporary dependency declarations because npm packages are unavailable in this container.
3. Runtime TikTok archive smoke test using a real JSZip installation already present elsewhere in the container. It verified that Like List records are extracted from a combined Likes and Favourites archive while Favourite Videos and Watch History are excluded.
4. Earlier compiled authoritative memory-engine smoke tests covering fair allocation, duplicate-video exclusion, four-player five-round flow, pre-reveal answer hiding, scoring, finish/rematch, capacity, duplicate-guess rejection and deadline enforcement.
5. Basic SQL structural checks on migration 0004 and the rebuilt bootstrap, including balanced function dollar quotes and parentheses.
6. ZIP integrity/package checks will be repeated on the final handoff archive.

## External validation still required

This execution container cannot currently complete `npm install` from the public npm registry. Therefore these package-backed or account-backed checks must not be represented as passed here:

- `npm install`
- `npm run typecheck` against the real dependency typings
- `npm run lint`
- `npm run test`
- `npm run build`
- Playwright browser E2E
- migration 0004 against the user's live Supabase project
- live Data Portability API calls, which require TikTok production approval and cannot be exercised in Sandbox
- live webhook delivery from TikTok

The handoff docs contain the exact migration, environment-variable and portal steps required for those external checks.


## 2026-08-15 hotfix

- Fixed white text on white link-buttons by moving the global anchor colour rule into Tailwind's base layer so explicit utility colours such as `text-black` take precedence.
- Added `TIKTOK_PORTABILITY_ENABLED` (off by default) as a server-side feature flag.
- Official Data Portability controls now show `Awaiting TikTok approval` until the flag is enabled.
- Direct requests to `/api/auth/tiktok/portability` are guarded while approval is pending.
- `/tiktok-import` also disables its Proceed action while approval is pending.
