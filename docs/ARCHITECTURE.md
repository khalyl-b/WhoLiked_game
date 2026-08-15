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

`SocialActivityProvider` is the only activity-acquisition interface consumed by the game domain. Provider selection is controlled by `SOCIAL_ACTIVITY_PROVIDER`:

- `fake` uses `FakeTikTokProvider` for fixture gameplay.
- `tiktok` uses `TikTokProvider`, which reads imported TikTok activity from `social_activity`.

The game engine does not know how activity was acquired. This keeps rooms, rounds, guessing, scoring and timers unchanged when the activity source changes.

Fixture rows are marked with `import_source = 'fixture'`. In real TikTok mode they are excluded from readiness counts and gameplay, preventing fake fixture likes from being mixed with imported user data.

## 8. TikTok Login Kit and Data Portability

Login Kit establishes the connected TikTok identity. It is not treated as permission to read likes.

For liked-video import, the production path uses TikTok Data Portability when the app receives the required scope. A one-time portability authorisation requests `portability.all.single`, creates an `all_data` export request and tracks the request in `tiktok_portability_requests`.

The server:

1. creates the portability request;
2. checks the request status;
3. accepts a signed `portability.download.ready` webhook;
4. downloads the resulting ZIP only after TikTok reports it ready;
5. extracts the Like List;
6. normalises TikTok video URLs into stable internal activity rows;
7. stores only the activity required by the game.

The complete downloaded archive is processed transiently and is not intentionally persisted by the application.

## 9. TikTok webhook security

`/api/webhooks/tiktok` verifies TikTok's HMAC-SHA256 signature against the exact raw request body and timestamp using `TIKTOK_CLIENT_SECRET`. Old signatures outside the configured tolerance are rejected.

The webhook does not perform the potentially long archive download inline. It records the ready state so the authenticated account flow can claim and import the archive safely.

The `authorization.removed` event removes the associated stored TikTok connection/data through the server-side deletion path.

## 10. Token storage and data deletion

TikTok OAuth tokens are encrypted with AES-GCM before persistence. `TIKTOK_TOKEN_ENCRYPTION_KEY` is preferred; `SESSION_SECRET` is retained only as a fallback for development/backwards compatibility.

Disconnecting TikTok revokes the token and removes the connected-account record but deliberately keeps already imported activity so a user does not unexpectedly lose a current game. The separate Delete TikTok Data action removes imported TikTok activity, portability request records and the connected account.

## 11. Manual archive fallback

While Data Portability production approval is pending, a user can import their own TikTok archive through `/account`.

The ZIP/JSON/text parsing happens in the browser. Only extracted Like List records are sent to the server. The server independently validates each TikTok URL, derives its own stable video identifier, deduplicates records and writes them using the same `social_activity` model consumed by `TikTokProvider`.

This fallback is intentionally not scraping. It operates only on a file the user obtained from TikTok and explicitly chose to upload.
