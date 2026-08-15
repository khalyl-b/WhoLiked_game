# TikTok Data Portability application copy

Use this as prepared copy for the TikTok application. Replace placeholders with truthful details. Do not invent a company, representative, email address, App ID or TikTok contact.

## Applicant details

**Applicant name**

```text
<YOUR REAL NAME>
```

**Applicant email**

```text
<YOUR GENUINE CONTACT EMAIL>
```

If TikTok requires an organisation-domain email and you do not have one, do not fake one. Use the portal's real requirements and obtain/confirm an acceptable identity with TikTok.

**Organisation name**

```text
<YOUR REAL ORGANISATION / PROJECT-OWNING ENTITY>
```

**Organisation website**

```text
https://who-liked-game.vercel.app
```

**TikTok representative email**

Leave blank unless you genuinely have a TikTok representative.

**App ID**

Copy the App ID displayed by TikTok for this exact Production app.

## Data scope required

Request:

```text
portability.all.single
```

Do not request `portability.all.ongoing` for the MVP.

## Detailed scope and use-case explanation

```text
Who Liked That? is a private multiplayer social party game for users in the UK/EEA. Friends join a private room and are shown one TikTok at a time. Each player guesses which room member liked that TikTok.

To create a player's private candidate pool, the player explicitly chooses to import their own TikTok Like List. TikTok's Data Types documentation places Like List entries, including the Date and Video landing page link, in the Full Archive rather than the narrower Activity export. For that reason the application requests portability.all.single once for a user-authorised transfer.

Immediately before redirecting to TikTok, the application explains that the one-time full archive may contain unrelated TikTok categories because the Like List is part of the Full Archive. The application explains why the data is needed, what it retains, and gives the user both Proceed and Go back controls.

After TikTok prepares the export, our server downloads the authorised archive and extracts only the Like List fields needed for gameplay: the TikTok video landing page URL/derived video identifier and the like date where provided. The raw archive is processed transiently and is not intentionally stored. Unrelated archive categories are ignored rather than written to the application's database.

Imported Like List records remain associated with the importing user's internal account. Other room members are never sent the complete Like List. During a game, the server exposes only the individual activity selected for the current round. The activity owner remains server-side until the legal reveal state, after guesses are locked or the server deadline expires.

We chose one-time portability.all.single rather than ongoing access because the game does not require continuous background synchronisation. A user can make a deliberate import when they want to supply activity for gameplay.
```

## UX flow description

```text
1. Connection screen: the Account page presents Connect TikTok using Login Kit and separately shows the user's likes-readiness state.

2. Transfer explanation screen: after the user chooses to import likes, /tiktok-import explains that TikTok stores the Like List inside the full archive, explains that the archive can contain additional categories, states that the game retains only Like List video URLs/identifiers and dates, explains the gameplay purpose, and provides Proceed to TikTok and Go back controls.

3. TikTok authorisation: the user is redirected to TikTok's own authorisation page to grant the requested one-time Data Portability permission.

4. Result screen: the Account page shows the request/import state and, after extraction, displays the number of imported likes and whether the user has sufficient eligible activity to play. The page also provides Disconnect TikTok and Delete my TikTok data controls.
```

## Why the narrower Activity scope is insufficient

```text
The requested gameplay data is the user's Like List. TikTok's Data Types documentation currently lists Watch History, Searches, Share History and other information under the Activity category, but the Like List appears under Likes and Favourites in the Full Archive. Therefore portability.activity.single does not cover the specific Like List data required by this feature.
```

## Data minimisation and retention

```text
The service persists only the imported TikTok activity needed for the game: TikTok video URL, a stable video identifier derived from that URL, the activity/like date where available, import timestamp/source, and availability state. The complete portability ZIP is not intentionally stored. Unrelated full-archive categories are not copied into application tables.

TikTok OAuth access/refresh tokens are server-side only and encrypted with AES-256-GCM before database persistence. Application data is stored in Supabase PostgreSQL with row-level/security controls, and the web application is hosted on Vercel.

Imported TikTok activity is retained until the user deletes it or it is removed for service/platform compliance. Disconnecting TikTok revokes/removes the connection, while the separate Delete my TikTok data control removes the stored connection, encrypted token record, imported TikTok activity and portability request records.
```

## Data-subject requests

```text
Users have an immediate self-service Delete my TikTok data control on the Account page. It removes imported TikTok activity, portability request records and the stored TikTok connection/token record.

For access to a copy of application data associated with them, correction, restriction or another privacy/data-subject request, users can contact <YOUR SUPPORT EMAIL>, which is also published in the Privacy Policy. We verify that the request relates to the relevant account/session before disclosing or changing data and respond in accordance with applicable requirements.
```

Privacy Policy:

```text
https://who-liked-game.vercel.app/privacy
```

Terms of Service:

```text
https://who-liked-game.vercel.app/terms
```

## Security/process explanation

```text
The OAuth flow uses a cryptographically random state bound to the internal application user in an HTTP-only cookie. OAuth token exchange and refresh happen server-side. TikTok tokens are encrypted at rest before persistence and are not returned to browser JavaScript.

The TikTok webhook endpoint verifies TikTok-Signature using HMAC-SHA256 over the timestamp and exact raw request body with the app client secret. It rejects stale signatures and validates the client key before processing events. portability.download.ready only marks an existing request ready, and authorization.removed triggers cleanup of the associated TikTok-derived records.

Manual archive import is provided only as a development/approval-period fallback. The ZIP/JSON is parsed locally in the user's browser and only extracted Like List records are sent to the server. The server validates TikTok URLs and derives stable video IDs again instead of trusting client-supplied identifiers.
```

## UX screenshot checklist

TikTok currently asks for four distinct screens. Use the live `/review/tiktok-portability` route as your screenshot guide:

1. Account / Connect TikTok
2. Data-transfer explanation with Proceed and Go back
3. Actual TikTok-hosted authorisation page
4. Final imported likes/readiness result

## Demo video outline for general app review

Record the actual live domain and show, in one uninterrupted flow where possible:

1. Landing page and game proposition.
2. Footer with Privacy and Terms links.
3. Account page.
4. Connect TikTok via Login Kit.
5. Return to connected Account state.
6. Open TikTok likes import explanation.
7. Show the disclosure and Proceed/Go back controls.
8. Show TikTok's authorisation screen for the selected approved scope when available.
9. Show pending/ready/import result.
10. Show imported likes count and readiness.
11. Show deletion/disconnect controls.
12. Briefly demonstrate the private-room gameplay that consumes imported activity.
