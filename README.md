# Who Liked That?

A mobile-first multiplayer party game where friends join a private room and guess which player owns the social activity shown in each round.

The MVP deliberately uses fake TikTok activity first. TikTok is a connected social account, not the application's identity system, and gameplay consumes a `SocialActivityProvider` abstraction rather than TikTok-specific API responses.

## Current implementation

- Next.js App Router, React and TypeScript.
- Tailwind CSS 4 styling and Motion game transitions.
- Six-character private room codes that exclude ambiguous characters.
- 2 to 10 players.
- 5, 10, 15 or 20 rounds.
- 10, 15, 20 or 30 second server-authoritative deadlines.
- Likes supported by the fake provider. Reposts represented in the domain model but disabled in the UI.
- Fair round ownership distribution rather than pooling all player activity.
- Duplicate-video exclusion when several players own the same video.
- Unavailable-activity filtering and pre-game capacity validation.
- Host kick in lobby, skip, end game and deterministic host transfer on intentional leave.
- Automatic answer reveal and next-round progression.
- Final leaderboard and rematch using a new `gameNumber` so old guesses/rounds cannot mix with the rematch.
- Production-safe Supabase PostgreSQL game persistence.
- Atomic PostgreSQL RPCs for capacity, start, guess, reveal, timer progression, rematch and host actions.
- Supabase Auth anonymous internal identities for deployed games.
- Supabase Realtime invalidation with deadline-triggered refresh and low-frequency recovery polling.
- Production guard that refuses `GAME_STORAGE=memory`.
- `/api/health` endpoint that verifies production storage/schema connectivity.
- TikTok Login Kit OAuth structure with CSRF state, server-side token handling, encrypted persistence, refresh and revoke/disconnect handling.
- Delete-imported-data control.
- Vitest unit/integration tests and Playwright multi-context E2E tests.

## Deployment recommendation

For personal/non-commercial testing, the simplest deployment is:

```text
Vercel Hobby
    |
    v
Supabase Free (Auth + Postgres + Realtime)
```

No VPS, Oracle Cloud, DuckDNS or paid domain is required.

See **[DEPLOY_FREE.md](./DEPLOY_FREE.md)** for the exact setup from an empty Supabase/Vercel account through four-player testing.

## Important TikTok limitation

TikTok Login Kit can connect a user's TikTok identity/profile. The ordinary Display API does not provide a normal consumer application's full liked-video/repost history.

TikTok currently documents **User Liked Videos** and **User Reposted Videos** under its Research API. That is a separately controlled product and must not be treated as a normal Login Kit permission. This repository therefore does not scrape TikTok, steal browser cookies, request passwords, or pretend that `video.list` represents the user's likes.

Production gameplay remains on `FakeTikTokProvider` until a legitimate supported activity source is available.

Official references:

- Login Kit for Web: https://developers.tiktok.com/doc/login-kit-web/
- OAuth user access tokens: https://developers.tiktok.com/doc/oauth-user-access-token-management
- Display API: https://developers.tiktok.com/doc/display-api-overview
- Research API liked videos: https://developers.tiktok.com/doc/research-api-specs-query-user-liked-videos

## Architecture

```text
Browser
  |  player intents
  v
Next.js route handlers on Vercel
  |
  v
GameService
  |-- GameEngine           -> local memory mode only
  |-- SupabaseGameEngine   -> deployed persistent mode
  |
  +-- SocialActivityProvider
       |-- FakeTikTokProvider
       +-- TikTokProvider boundary

Production persistence
  |
  +-- Supabase Auth anonymous identity
  +-- PostgreSQL rooms / players / rounds / guesses
  +-- atomic server-only RPCs
  +-- Realtime on safe room/player rows
```

The correct owner is never included in the ACTIVE-round public response. `sourceUserId`, correctness and result details appear only after the database has legally moved the round to REVEAL.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for design details.

## Project structure

```text
src/
  app/
    api/
      account/
      auth/tiktok/
      health/
      rooms/
    account/
    create/
    join/
    room/[code]/
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

## Local setup without Supabase

### Requirements

- Node.js 22 or later.
- npm.

### Install

```bash
npm install
```

### Environment

```bash
cp .env.example .env.local
```

For a zero-credential local game:

```env
GAME_STORAGE=memory
SESSION_SECRET=replace-with-a-long-random-secret
```

Do not commit `.env.local` or real secrets.

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

Memory mode is for local development only. Production deliberately throws an error if it is selected.

## Local/deployed Supabase mode

Create a Supabase project and run `supabase/bootstrap.sql` in a **new project's** SQL editor, or apply these migrations in order using your normal migration tooling:

```text
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_server_guards.sql
supabase/migrations/0003_serverless_runtime.sql
```

Enable Supabase **Anonymous Sign-Ins**.

Configure:

```env
GAME_STORAGE=supabase
SESSION_SECRET=<strong random secret>
NEXT_PUBLIC_SUPABASE_URL=<project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SECRET_KEY=<sb_secret_...>
```

Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` values are accepted as fallbacks, but the current publishable/secret key format is preferred.

The secret/server key must never be exposed to browser code or prefixed with `NEXT_PUBLIC_`.

### Health check

With the app running in Supabase mode, open:

```text
/api/health
```

A healthy deployed runtime returns:

```json
{
  "ok": true,
  "storage": "supabase",
  "database": true
}
```

## Database security

The schema contains:

- `users`
- `social_accounts`
- private encrypted token storage
- `social_activity`
- `rooms`
- `room_players`
- `rounds`
- `guesses`

`rounds` and `guesses` intentionally have no direct browser SELECT policy because they contain answer-sensitive data.

Browser Realtime watches only `rooms` and `room_players`. Realtime changes trigger a sanitised server refetch rather than broadcasting the correct answer.

Critical state transitions are PostgreSQL RPCs protected with row locking and database constraints. Serverless instances do not need to share process memory.

## Fake provider

`src/providers/social/fake-tiktok-provider.ts` returns deterministic fixture activity and includes:

- unique likes
- a duplicate video owned by every fixture user
- unavailable activity
- varying creators/titles

The shared duplicate is expected to be removed before round generation.

The provider interface is:

```ts
interface SocialActivityProvider {
  getLikes(userId: string): Promise<SocialActivity[]>;
  getReposts(userId: string): Promise<SocialActivity[]>;
}
```

The game engine does not call TikTok endpoints directly.

## TikTok Login Kit setup

TikTok is optional for the current playable fake-data MVP.

When approved credentials exist, configure:

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://your-exact-registered-domain.example/api/auth/tiktok/callback
TIKTOK_TOKEN_ENCRYPTION_KEY=<independent strong random secret>
```

If `TIKTOK_TOKEN_ENCRYPTION_KEY` is omitted, `SESSION_SECRET` is used as a backwards-compatible encryption-key fallback.

The OAuth flow:

1. Creates a cryptographically random state value.
2. Stores the state in an HTTP-only cookie tied to the internal user.
3. Redirects to TikTok's official authorisation endpoint.
4. Validates state on callback.
5. Exchanges the code server-side.
6. Fetches basic profile data.
7. Encrypts tokens with AES-256-GCM before persistence.
8. Refreshes access tokens server-side.
9. Revokes and removes the local connection on disconnect where possible.

## Tests

Run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Unit coverage includes fair allocation, owner scheduling, duplicate exclusion, insufficient activity and no activity reuse.

Integration coverage exercises room creation/joining, answer hiding, duplicate-guess rejection, deadline enforcement, scoring, progression, completion, rematch and host transfer.

Playwright exercises independent browser contexts for multiplayer behaviour.

## Manual four-player test

Use four independent browser profiles/devices so each gets a different application identity.

1. James creates a five-round room.
2. Ahmed, Sam and Ryan join with the room code.
3. Verify everyone appears without refreshing.
4. Start the game.
5. Submit guesses from all four players.
6. Verify the same answer reveal and scores everywhere.
7. Continue to the final leaderboard.
8. Play again and verify scores reset without re-entering the code.
9. Refresh one participant during lobby/round/reveal and verify they rejoin as the same user.
