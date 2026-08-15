# TikTok production setup: exact next steps

Current live site used in these instructions:

```text
https://who-liked-game.vercel.app
```

The code is ready for TikTok Data Portability, but TikTok must approve the production product/scope before the official import can run. TikTok Sandbox does not provide Data Portability API access.

## 1. Apply the new Supabase migration

Your existing database already has migrations 0001 to 0003. Do not rerun the full bootstrap against the existing project.

In Supabase:

1. Open your existing project.
2. Open **SQL Editor**.
3. Create a new query.
4. Paste all of `supabase/migrations/0004_tiktok_portability.sql`.
5. Press **Run**.
6. Confirm it completes without an error.

For a brand-new database only, `supabase/bootstrap.sql` contains all migrations in order.

## 2. Deploy the updated code

Replace/update the repository with this version, then push it to the same GitHub repository Vercel already deploys.

Typical commands:

```bash
git add .
git commit -m "Add TikTok Data Portability and real likes import"
git push
```

Vercel should create a new deployment automatically.

## 3. Add legal/operator environment variables in Vercel

Open:

```text
Vercel
-> who-liked-game
-> Settings
-> Environment Variables
```

Add:

```text
NEXT_PUBLIC_OPERATOR_NAME=<your genuine name or organisation name>
NEXT_PUBLIC_SUPPORT_EMAIL=<a support/privacy email you actually monitor>
```

Keep the TikTok variables you already configured:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI=https://who-liked-game.vercel.app/api/auth/tiktok/callback
TIKTOK_TOKEN_ENCRYPTION_KEY
```

If `TIKTOK_TOKEN_ENCRYPTION_KEY` is still missing, generate another strong random secret and add it. Do not reuse or expose the TikTok client secret.

For now you may leave:

```text
SOCIAL_ACTIVITY_PROVIDER=fake
```

while you verify the new pages and manual importer. When you want the game to require real imported TikTok activity, change it to:

```text
SOCIAL_ACTIVITY_PROVIDER=tiktok
```

and redeploy. In TikTok mode, fixture likes are excluded from readiness and gameplay.

## 4. Verify the new live pages

After redeployment open:

```text
https://who-liked-game.vercel.app/privacy
https://who-liked-game.vercel.app/terms
https://who-liked-game.vercel.app/account
https://who-liked-game.vercel.app/tiktok-import
https://who-liked-game.vercel.app/review/tiktok-portability
```

The Privacy and Terms links are also visible in the site footer.

## 5. Test the manual likes fallback before TikTok approval

This works without Data Portability approval.

1. Obtain your own TikTok data export as ZIP, JSON or TXT.
2. Open `/account`.
3. Under **Manual archive fallback**, choose the export.
4. The browser parses the archive locally.
5. Only extracted Like List records are submitted to the server.
6. The page should show the number of imported likes.
7. Once at least 10 eligible likes are present, the readiness badge should say **Ready**.

To test actual gameplay with these manually imported likes before Data Portability approval, set this Vercel variable:

```text
SOCIAL_ACTIVITY_PROVIDER=tiktok
```

then redeploy. Every player in the test room needs enough of their own imported likes. You can switch back to `fake` at any time for fixture gameplay. This provider switch does not require Data Portability approval because it only reads activity already imported into your own Supabase database.

Do not upload another person's archive unless you are actually authorised to process it.

## 6. Move your TikTok developer app to a Production Draft

In TikTok for Developers:

1. Open **Manage apps**.
2. Open your existing app.
3. Switch from **Sandbox** to **Production**.
4. Open the Production **Draft**.
5. If useful, import your working Sandbox configuration into the Draft.
6. Keep Login Kit configured with this exact redirect URI:

```text
https://who-liked-game.vercel.app/api/auth/tiktok/callback
```

Do not remove the working Login Kit product.

## 7. Complete production app details

Use the real public site, not a placeholder:

```text
Website URL
https://who-liked-game.vercel.app

Privacy Policy
https://who-liked-game.vercel.app/privacy

Terms of Service
https://who-liked-game.vercel.app/terms
```

Use a genuine app name/icon/description consistent with the website.

Suggested public description:

```text
Who Liked That? is a private multiplayer party game where friends join a room and guess which player liked the TikTok shown in each round.
```

## 8. Verify the Vercel URLs without buying a domain

TikTok currently allows URL-prefix verification using a signature file, so the free `vercel.app` URL can be used without paying for a custom domain.

In the TikTok Production app:

1. Click **URL properties**.
2. Choose **Verify properties**.
3. Choose **URL prefix** rather than Domain.
4. Enter the exact URL TikTok asks you to verify.
5. Download TikTok's signature file.
6. Put that exact file into this project's `public/` directory so Next.js serves it from the requested URL.
7. Commit and push the file.
8. Wait for Vercel to deploy.
9. Open the signature-file URL yourself and confirm the file is reachable.
10. Return to TikTok and complete verification.

Repeat for the Web URL, Privacy Policy URL and Terms URL if TikTok presents them as separate properties.

Do not rename or edit TikTok's signature file.

## 9. Add Webhooks in TikTok Production

Under **Products -> Add products**, add **Webhooks**.

Configure the callback URL as:

```text
https://who-liked-game.vercel.app/api/webhooks/tiktok
```

The application already verifies TikTok's signed webhook header and supports:

```text
portability.download.ready
authorization.removed
```

No separate webhook secret is required by this implementation. TikTok signs webhook payloads using your existing client secret.

## 10. Add Data Portability API

Under **Products -> Add products**, add:

```text
Data Portability API
```

TikTok requires the app to have Login Kit and Webhooks as part of the Data Portability setup.

## 11. Apply for the correct scope

Choose/apply for:

```text
portability.all.single
```

Do not request ongoing access for this MVP.

Reason: TikTok's current Data Types documentation places **Likes and Favourites -> Like List -> Video landing page link** inside the Full Archive. The narrower Activity category lists watch history, searches, shares and other activity, but not the Like List. The code therefore requests one full archive once, extracts only the Like List fields needed by the game, and discards unrelated raw archive contents.

## 12. Prepare the four UX screenshots TikTok asks for

Open:

```text
https://who-liked-game.vercel.app/review/tiktok-portability
```

Use it to capture the application-owned screens:

1. **Connect to TikTok**
2. **Connecting / transfer explanation**, including Proceed and Go back
3. **TikTok authorisation**, use a real screenshot of TikTok's own authorisation screen
4. **Final result**, likes imported and Ready

The review route contains a labelled guide for these states.

## 13. Fill the Data Portability application

Use `TIKTOK_REVIEW_APPLICATION.md` in this repository. It contains prepared copy for the technical/use-case questions.

Replace every placeholder with truthful information about you/your organisation. Do not invent an organisation, representative, domain email or TikTok contact.

## 14. Submit the app review material

TikTok's general app review also asks for a demo video showing the complete, current integration flow. Record the live domain shown above, not localhost or a different domain.

For the first review, demonstrate the products/scopes that are actually selected. Remove any product/scope you are not using because unnecessary permissions can delay review.

## 15. After Data Portability approval

Once `portability.all.single` is approved and added to the Production app:

1. Ensure these Vercel variables still match the Production TikTok credentials, not the Sandbox credentials.
2. Set:

```text
SOCIAL_ACTIVITY_PROVIDER=tiktok
```

3. Redeploy.
4. Open `/account`.
5. Connect/authorise the one-time likes import.
6. TikTok prepares the archive.
7. The webhook or status polling marks it ready.
8. Press **Import ready TikTok data**.
9. Verify the readiness count.
10. Test a room with multiple users who each imported at least 10 eligible likes.

## 16. Do not implement reposts yet

The database/domain still understands `REPOST`, but the production UI should continue to show reposts as unavailable until a legitimate supported data source for the exact use case is approved and implemented.


### Data Portability feature flag

Keep `TIKTOK_PORTABILITY_ENABLED=false` (or leave it unset) until TikTok approves the app for the required Data Portability scope. After approval, set it to `true` in Vercel and redeploy. This prevents users from being sent to a TikTok OAuth request for a scope the app cannot yet request.
