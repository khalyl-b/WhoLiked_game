# Who Liked That?

A mobile-first multiplayer party game where friends join a private room and guess which player liked the TikTok shown in each round.

The multiplayer engine is server-authoritative and consumes a `SocialActivityProvider` abstraction. Development can use deterministic fake TikTok activity. Production can switch to user-imported TikTok Like List data without rewriting rooms, rounds, guessing, scoring or timers.

## Current implementation

### Multiplayer

- Next.js App Router, React and TypeScript.
- Tailwind CSS 4 and Motion.
- Six-character private room codes with ambiguous characters excluded.
- 2 to 10 players.
- 5, 10, 15 or 20 rounds.
- 10, 15, 20 or 30 second server-authoritative deadlines.
- Fair per-player round ownership distribution.
- Duplicate-owner TikTok exclusion.
- Unavailable activity filtering and pre-game capacity validation.
- Host kick in lobby, skip, end game and deterministic host transfer on intentional leave.
- Automatic reveal, scoring and next-round progression.
- Final leaderboard and clean rematch state.
- Refresh-stable Supabase anonymous application identities.
- Supabase Realtime invalidation plus recovery polling/deadline refreshes.

### Production persistence and security

- Supabase PostgreSQL for deployed rooms/game state.
- Atomic PostgreSQL RPCs for concurrency-sensitive game operations.
- RLS and server-only answer-sensitive rows.
- Production refuses `GAME_STORAGE=memory`.
- `/api/health` verifies the deployed database/schema connection.
- Correct round owner is never included in ACTIVE-round public state.

### TikTok

- Official Login Kit OAuth flow with state/CSRF protection.
- Server-side token exchange and refresh.
- AES-256-GCM encrypted token persistence.
- Revocation/disconnect handling.
- TikTok Data Portability request/status/download architecture.
- Signed TikTok webhook verification.
- One-time `portability.all.single` design for the Full Archive because TikTok currently places Like List entries there.
- ZIP/JSON Like List parser that ignores unrelated archive categories and Favourite Videos.
- Real imported-activity persistence in `social_activity`.
- Database-backed `TikTokProvider` behind the same `SocialActivityProvider` interface as fixtures.
- Manual browser-local TikTok archive fallback while official Data Portability approval is pending.
- Account readiness state, minimum-like feedback, data deletion and disconnect controls.
- Privacy Policy, Terms of Service, visible legal footer and review UX route.

## Important TikTok status

TikTok Login Kit can be tested in Sandbox. TikTok's Data Portability API cannot be used in Sandbox and requires a Production/Staging app plus TikTok approval for the requested portability scope.

TikTok's current Data Types documentation lists **Likes and Favourites -> Like List -> Date / Video landing page link** under the **Full Archive**. The narrower Activity category lists other activity such as watch history, searches and share history, but not the Like List. This implementation therefore requests `portability.all.single` only when the user explicitly chooses a one-time likes import, extracts the Like List, and does not intentionally persist the raw full archive.

No scraping, private endpoint reverse engineering, TikTok passwords or browser-cookie theft is used.

Official TikTok references:

- Data Portability Get Started: https://developers.tiktok.com/doc/data-portability-api-get-started
- Add Data Request: https://developers.tiktok.com/doc/data-portability-api-add-data-request/
- Download: https://developers.tiktok.com/doc/data-portability-api-download/
- Data Types: https://developers.tiktok.com/doc/data-portability-data-types
- Webhook Events: https://developers.tiktok.com/doc/webhooks-events
- Webhook Verification: https://developers.tiktok.com/doc/webhooks-verification
- App Review Guidelines: https://developers.tiktok.com/doc/app-review-guidelines/

## Architecture

```text
Browser
  | player intents
  v
Next.js route handlers on Vercel
  |
  v
GameService
  |-- GameEngine           -> local memory development
  |-- SupabaseGameEngine   -> deployed persistent game
  |
  +-- SocialActivityProvider
       |-- FakeTikTokProvider
       +-- TikTokProvider -> imported public.social_activity rows

TikTok production data path
  Login Kit / Data Portability OAuth
        |
        v
  TikTok portability request
        |
        v
  signed webhook or status poll
        |
        v
  ZIP download -> Like List parser
        |
        v
  public.social_activity
        |
        v
  existing game engine
```

See:

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/TIKTOK_DATA_FLOW.md](./docs/TIKTOK_DATA_FLOW.md)
- [TIKTOK_NEXT_STEPS.md](./TIKTOK_NEXT_STEPS.md)
- [TIKTOK_REVIEW_APPLICATION.md](./TIKTOK_REVIEW_APPLICATION.md)

## Project structure

```text
src/
  app/
    account/
    create/
    join/
    privacy/
    review/tiktok-portability/
    room/[code]/
    terms/
    tiktok-import/
    api/
      account/
      auth/tiktok/
      health/
      rooms/
      tiktok/
      webhooks/tiktok/
  components/
  features/
  lib/supabase/
  providers/social/
  server/
    game/
    session/
    tiktok/

supabase/
  bootstrap.sql
  migrations/
  seed.sql

tests/
  unit/
  integration/
  e2e/
```

## Environment variables

Copy `.env.example` to `.env.local` for local development.

### Core

```env
GAME_STORAGE=memory
SESSION_SECRET=<strong random secret>
SOCIAL_ACTIVITY_PROVIDER=fake
```

`SOCIAL_ACTIVITY_PROVIDER` accepts:

- `fake` - deterministic fixture activity.
- `tiktok` - real imported TikTok activity only. Fixture rows are excluded/removed from the real game pool.

Production must use:

```env
GAME_STORAGE=supabase
```

### Supabase

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

Legacy anon/service-role names remain accepted as fallbacks.

### TikTok

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://your-domain.example/api/auth/tiktok/callback
TIKTOK_TOKEN_ENCRYPTION_KEY=<separate strong random secret>
```

### Public legal details

```env
NEXT_PUBLIC_OPERATOR_NAME=
NEXT_PUBLIC_SUPPORT_EMAIL=
```

These values appear on the Privacy/Terms pages and should contain genuine public operator/contact details before TikTok production review.

## Database setup

For a brand-new Supabase project, run:

```text
supabase/bootstrap.sql
```

For the existing deployed project that already has migrations 0001 to 0003, apply only:

```text
supabase/migrations/0004_tiktok_portability.sql
```

Migration 0004 adds:

- activity origin tracking so fixtures cannot masquerade as imported likes
- `tiktok_portability_requests`
- request RLS/indexes
- server-only idempotent TikTok activity import RPC
- server-only TikTok data deletion RPC

Enable Supabase Anonymous Sign-Ins for the application's stable internal identities.

## Local development without Supabase

Requirements:

- Node.js 22+
- npm

Install/run:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use:

```env
GAME_STORAGE=memory
SOCIAL_ACTIVITY_PROVIDER=fake
SESSION_SECRET=<strong development secret>
```

Open `http://localhost:3000`.

Memory mode is deliberately blocked in production.

## Production deployment

The personal/non-commercial test deployment is designed for Vercel + Supabase. See [DEPLOY_FREE.md](./DEPLOY_FREE.md).

For the already-deployed site, follow [TIKTOK_NEXT_STEPS.md](./TIKTOK_NEXT_STEPS.md) for the portability migration, Vercel environment variables and TikTok production portal configuration.

## TikTok manual archive fallback

Until Data Portability is approved, users can test with genuine Like List data:

1. Obtain their own TikTok data archive.
2. Open `/account`.
3. Choose ZIP/JSON/TXT under Manual archive fallback.
4. JSZip parses the archive in the browser.
5. Only extracted Like List records are submitted to the server.
6. The server validates TikTok URLs again and derives stable IDs itself.
7. Imported activity is written idempotently into Supabase.

The raw manual archive is not uploaded by this implementation.

## Official Data Portability flow

Once TikTok approves the required production scope:

1. User connects TikTok.
2. User opens `/tiktok-import`.
3. The app clearly explains the one-time full-archive transfer and retained data.
4. User authorises `portability.all.single`.
5. Server creates an `all_data` request.
6. Status polling and/or a verified `portability.download.ready` webhook marks it ready.
7. Server downloads the ZIP.
8. Parser extracts Like List entries only.
9. Normalised likes are stored in `social_activity`.
10. `TikTokProvider` exposes them to the unchanged game engine.

Automatic server import currently places a 100 MB safety cap on the archive buffer. Larger archives are directed to the browser-local manual fallback instead of risking excessive server memory.

## Privacy controls

`/account` provides:

- Disconnect TikTok - revoke/remove the connection while retaining already imported activity.
- Delete my TikTok data - revoke where possible and remove the TikTok connection, encrypted token row, imported activity and portability request records.

A valid TikTok `authorization.removed` webhook also triggers TikTok-derived data cleanup.

## Tests

When dependencies are installed:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Coverage includes:

- fair ownership allocation
- duplicate-video exclusion
- insufficient activity
- room/game/scoring/rematch behaviour
- TikTok Like List parsing and exclusion of unrelated/favourite data
- webhook signature validation and replay-window rejection
- portability status mapping
- server re-derivation of TikTok video IDs instead of trusting client IDs
- provider switching without changing the game-service interface
- multi-context Playwright multiplayer flow

See [BUILD_STATUS.md](./BUILD_STATUS.md) for what was actually executable in the current build environment and what still requires Vercel/a normal networked machine.


### Data Portability feature flag

Keep `TIKTOK_PORTABILITY_ENABLED=false` (or leave it unset) until TikTok approves the app for the required Data Portability scope. After approval, set it to `true` in Vercel and redeploy. This prevents users from being sent to a TikTok OAuth request for a scope the app cannot yet request.
