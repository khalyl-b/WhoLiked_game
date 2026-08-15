# TikTok data flow

## Purpose

The production TikTok integration is deliberately separated into two concerns:

1. Login Kit connects a TikTok identity to an internal application user.
2. Data Portability, when approved, supplies a user-authorised one-time export from which the app extracts only the TikTok Like List required for gameplay.

The multiplayer game engine continues to depend on `SocialActivityProvider`. It does not parse TikTok API responses and does not receive OAuth tokens.

## Official portability flow

```text
/account
  |
  | user chooses likes import
  v
/tiktok-import
  |
  | explains full-archive transfer and retained fields
  v
/api/auth/tiktok/portability
  |
  | OAuth: user.info.basic + portability.all.single
  v
TikTok authorisation
  |
  v
/api/auth/tiktok/callback
  |
  | store encrypted OAuth tokens
  | POST /v2/user/data/add/ with all_data
  v
public.tiktok_portability_requests
  |
  | status polling and/or signed webhook
  v
portability.download.ready
  |
  v
POST /v2/user/data/download/
  |
  | streamed ZIP, bounded to 100 MB for automatic server import
  v
TikTok archive parser
  |
  | ONLY Likes and Favourites -> Like List
  | retain video URL/derived ID/date
  | ignore Favourite Videos and unrelated archive sections
  v
public.social_activity
  |
  v
TikTokProvider
  |
  v
existing game engine
```

The official downloaded ZIP is processed in application memory and is not intentionally written to permanent storage. If it exceeds the automatic import limit, the UI directs the user to the manual browser-local fallback.

## Manual archive fallback

```text
User selects their TikTok ZIP/JSON/TXT
        |
        v
Browser JSZip parser
        |
        | only extracted Like List records
        v
/api/tiktok/manual-import
        |
        | server validates TikTok host again
        | derives video ID from URL again
        v
import_tiktok_activity RPC
        |
        v
public.social_activity
```

The raw manual archive is never uploaded to the application server by this implementation.

## Data minimisation

Persisted activity contains only the game-relevant values available from a Like List entry:

- TikTok video URL
- stable video identifier derived from the URL
- like/activity date when present
- import timestamp and source
- availability flag

The implementation does not intentionally persist unrelated profile settings, watch history, searches, direct messages, shopping data or other categories that can exist in a full archive.

## Answer privacy

Imported activity remains private to the owner except when one item is selected for the current round. The complete imported Like List is not sent to room members. The correct owner remains server-side until the round enters REVEAL.

## Token security

- OAuth code exchange is server-side.
- State is bound to the internal user in an HTTP-only cookie.
- Access and refresh tokens are encrypted with AES-256-GCM before database persistence.
- Token rows are stored in the private Supabase schema and are not directly browser-readable.
- `TIKTOK_TOKEN_ENCRYPTION_KEY` should be independent from `SESSION_SECRET` in production.

## Webhook security

`/api/webhooks/tiktok`:

- reads the raw body before parsing JSON
- validates `TikTok-Signature`
- computes HMAC-SHA256 over `timestamp.rawBody` using the TikTok client secret
- rejects timestamps more than five minutes from server time
- validates the webhook `client_key`
- treats `portability.download.ready` idempotently
- removes stored TikTok-derived data after a valid `authorization.removed` event

## Database controls

Migration `0004_tiktok_portability.sql` adds:

- `social_activity.import_source`
- `tiktok_portability_requests`
- user-scoped RLS for request visibility
- server-only import RPC
- server-only TikTok deletion RPC
- indexes for activity origin and portability status

`SOCIAL_ACTIVITY_PROVIDER=tiktok` excludes and removes development fixtures, preventing fake likes from being used as real production activity.

## Deletion behaviour

`Delete my TikTok data` attempts TikTok token revocation, then removes:

- TikTok social-account connection
- encrypted token row through cascade
- imported TikTok activity
- portability request records

`Disconnect TikTok` revokes/removes the connection but intentionally retains previously imported activity until the user explicitly deletes it. The UI states this before and after the action.
