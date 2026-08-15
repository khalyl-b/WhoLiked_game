# Architecture decisions

## 1. Two runtime modes

The game supports two explicit storage modes:

- `GAME_STORAGE=memory` for zero-setup local development and deterministic tests.
- `GAME_STORAGE=supabase` for deployed/serverless use.

Production deliberately refuses to start with memory storage. This prevents a Vercel deployment from silently losing rooms whenever a function instance is replaced or routing different players to different processes.

`GameService` is the storage-independent authoritative interface. `GameEngine` implements the local memory runtime and `SupabaseGameEngine` implements the persistent runtime.

## 2. Serverless-safe authority and concurrency

The browser only sends player intents. It never submits scores, correctness, source ownership or host authority.

For the Supabase runtime, race-sensitive mutations execute through PostgreSQL RPCs that lock the relevant room/round rows. This protects against:

- simultaneous room joins beyond capacity
- duplicate game starts
- duplicate guesses
- double scoring/reveal
- two clients advancing the same round
- duplicate rematches
- host-only actions from non-hosts

The Next.js process therefore does not need sticky sessions or shared RAM.

## 3. Persistent anonymous application identity

The production runtime uses Supabase Auth anonymous users as stable internal application identities. The browser creates the anonymous session before create/join actions, then the Next.js server validates it with `auth.getUser()`.

This also allows browser Realtime subscriptions to run as an authenticated Supabase user while RLS controls which room rows are visible.

Local memory mode retains a signed HTTP-only development cookie and requires no Supabase account.

## 4. Server-authoritative timing

Each active round stores `started_at` and `answer_deadline` in PostgreSQL. The browser countdown is display-only and is derived from server time.

`advance_room_clock` performs the legal ACTIVE -> REVEAL -> next round transition under a database lock. Realtime updates normally trigger refetches. Clients also schedule one refresh at the authoritative deadline/reveal end plus a 10-second recovery poll, rather than polling every second indefinitely.

## 5. Answer privacy

`PublicRound` omits answer fields while a round is ACTIVE. It only gains `sourceUserId`, `sourceDisplayName` and guess correctness after REVEAL.

Direct browser SELECT access to `rounds` and `guesses` is deliberately absent because those rows contain answer-sensitive information. Browser Realtime watches only safe `rooms` and `room_players` rows and then refetches sanitised state from the Next.js server.

## 6. Fair activity selection

Round generation first assigns each player a quota. Quotas differ by at most one round and extra rounds are randomly distributed.

Activities are deduplicated by stable `videoId` across active players. Any video owned by multiple players is excluded. The owner sequence avoids adjacent repeats where possible, and one non-reused eligible activity is selected for each owner.

The database revalidates the selected player set, activity ownership, availability, selected activity types, unique videos and duplicate ownership before committing a game start.

## 7. TikTok integration boundary

`SocialActivityProvider` is the only activity-acquisition interface consumed by the game domain. `FakeTikTokProvider` is fully functional now. `TikTokProvider` remains disabled until legitimate TikTok API access can return the required activity type.

TikTok Login Kit is a separate account connection. Tokens are encrypted before persistence and stored behind a private-schema table accessed only through server-authorised RPCs. A dedicated `TIKTOK_TOKEN_ENCRYPTION_KEY` can be used; `SESSION_SECRET` is only a fallback.

Login success must never be interpreted as access to likes or reposts when TikTok has not granted such an API capability.
