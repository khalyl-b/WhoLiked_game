# Deploy for £0: Vercel Hobby + Supabase Free

This is the recommended deployment for the current project. You do **not** need Oracle Cloud, DuckDNS, Nginx/Caddy, a VPS, or a paid domain.

The deployed architecture is:

```text
Players' phones/browsers
        |
        | HTTPS
        v
Vercel Hobby: Next.js
        |
        | server-side requests + Realtime
        v
Supabase Free
  - Auth anonymous users
  - PostgreSQL game state
  - Realtime
```

Vercel supplies a free `*.vercel.app` HTTPS address. Supabase stores rooms and games so Vercel function restarts do not erase them.

## Before starting

You need free accounts for:

1. GitHub
2. Supabase
3. Vercel

TikTok developer credentials are **not** required to play the current fake-data MVP.

---

## Part 1: Put the project on GitHub

### 1. Extract the project

Extract `tiktok-guess-game.zip` to a normal folder on your computer.

Open Terminal/PowerShell inside that folder.

### 2. Optional local verification

If Node.js 22+ is installed:

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

If those pass, continue. If you do not have Node installed, Vercel can still install/build the project after import, but a local check makes deployment errors easier to diagnose.

### 3. Create an empty GitHub repository

On GitHub:

1. Click **New repository**.
2. Name it, for example `tiktok-guess-game`.
3. A personal public or private repository is fine.
4. Do **not** initialise it with another README, `.gitignore`, or licence if you are pushing this existing folder.
5. Create the repository.

### 4. Push this folder

Run the commands GitHub shows for an existing repository. They will look like:

```bash
git init
git add .
git commit -m "Initial multiplayer MVP"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tiktok-guess-game.git
git push -u origin main
```

If this folder is already a Git repository, do not run `git init` again. Check:

```bash
git status
```

The project's `.gitignore` excludes `.env` and `.env.local`, so secrets should not be committed.

---

## Part 2: Create the free Supabase backend

### 5. Create the Supabase project

1. Sign in to Supabase.
2. Create a **Free** project.
3. Give it a name such as `tiktok-guess-game`.
4. Generate/save the database password when prompted.
5. Choose the available region closest to your users, preferably UK/Western Europe for UK testing.
6. Wait until the project reports that it is ready.

Do not upgrade the project to Pro.

### 6. Enable anonymous sign-ins

The game deliberately gives each browser a stable internal Supabase user without asking players to make an email/password account.

In the Supabase dashboard:

1. Open **Authentication**.
2. Open **Sign In / Providers**.
3. Find **Anonymous Sign-Ins** / **Allow anonymous sign-ins**.
4. Enable it and save.

If this is not enabled, creating/joining a room will return a useful error instead of silently creating an unstable identity.

### 7. Install the database schema

In the same Supabase project:

1. Open **SQL Editor**.
2. Create a new query.
3. Open this repository's `supabase/bootstrap.sql` file.
4. Copy **the entire file** into the Supabase SQL editor.
5. Click **Run**.
6. Confirm there is no SQL error.

`bootstrap.sql` contains migrations `0001`, `0002` and `0003` in order. Use it on a new project so you only need one paste.

It creates the database tables, constraints, RLS rules, Realtime publication and server-only atomic game functions.

### 8. Get your three Supabase values

In Supabase:

1. Open **Settings -> API Keys**.
2. Use the **Publishable and secret API keys** tab.
3. Copy your **Project URL**.
4. Copy the **Publishable key** (`sb_publishable_...`).
5. Create/copy a **Secret key** (`sb_secret_...`).

Map them like this:

```text
Project URL      -> NEXT_PUBLIC_SUPABASE_URL
Publishable key  -> NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
Secret key       -> SUPABASE_SECRET_KEY
```

**Never** put the secret key into a variable beginning with `NEXT_PUBLIC_`, source code, GitHub, browser JavaScript, screenshots, or chat messages.

The old `anon` and `service_role` key names are supported by the code as compatibility fallbacks, but the publishable/secret format is preferred for a new project.

---

## Part 3: Create a session secret

### 9. Generate a random secret locally

Run this on your computer:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Copy the output. It becomes:

```text
SESSION_SECRET
```

Do not reuse a password and do not commit it to GitHub.

You do not need `TIKTOK_TOKEN_ENCRYPTION_KEY` until you actually enable TikTok OAuth. When you do, generate another independent random value using the same command.

---

## Part 4: Deploy Next.js on Vercel for free

### 10. Import the GitHub repository

1. Sign in to Vercel with GitHub.
2. Choose **Add New -> Project**.
3. Import your `tiktok-guess-game` repository.
4. Vercel should detect **Next.js** automatically.
5. Leave the root directory as the repository root.
6. Do not deploy yet if you have not entered the environment variables.

### 11. Add environment variables

In the Vercel project setup screen add exactly these values:

```text
GAME_STORAGE=supabase
SESSION_SECRET=<the random value from step 9>
NEXT_PUBLIC_SUPABASE_URL=<your Supabase Project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
SUPABASE_SECRET_KEY=<your Supabase secret key>
```

Leave these unset for the current fake-TikTok MVP:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
TIKTOK_TOKEN_ENCRYPTION_KEY
```

The most important variable is:

```text
GAME_STORAGE=supabase
```

The application intentionally refuses to use process-memory storage in production, so a bad deployment cannot appear to work while silently losing rooms.

### 12. Deploy

Click **Deploy**.

Vercel will install packages and run the Next.js build. If the build fails, open the build log and fix that error before continuing.

Once successful, Vercel gives a URL similar to:

```text
https://tiktok-guess-game-xxxx.vercel.app
```

That URL already has HTTPS. No DuckDNS and no SSL configuration are required.

---

## Part 5: Prove the database connection works

### 13. Open the health endpoint

Visit:

```text
https://YOUR-VERCEL-URL.vercel.app/api/health
```

A correct production deployment should return approximately:

```json
{
  "ok": true,
  "storage": "supabase",
  "database": true
}
```

If `ok` is false, do not start multiplayer testing yet. The response distinguishes a missing production storage configuration from a missing/unapplied Supabase schema.

### 14. If health reports a schema problem

Check these in order:

1. `NEXT_PUBLIC_SUPABASE_URL` is from the same Supabase project where you ran `bootstrap.sql`.
2. `SUPABASE_SECRET_KEY` is the server-side secret key, not the publishable key.
3. `supabase/bootstrap.sql` completed successfully.
4. Vercel environment variables were applied to **Production**.
5. After changing a Vercel environment variable, redeploy the latest deployment.

---

## Part 6: Test actual multiplayer

### 15. Test room creation

Open the main Vercel URL.

1. Press **Create Game**.
2. Enter `James`.
3. Choose 5 rounds and 15 seconds.
4. Create the room.
5. Copy the six-character room code.

### 16. Join as three independent users

Use independent browser identities. For example:

- Chrome normal profile: James
- Edge/InPrivate or another Chrome profile: Ahmed
- Firefox/private profile: Sam
- a phone or another browser profile: Ryan

Do not use four ordinary tabs in the same browser profile. They share the same Supabase login identity and are intentionally treated as the same application user.

Join all three guests with the code.

### 17. Validate the lobby

Confirm on every device/browser:

- all four players appear
- the room code is identical
- the host is James
- settings are identical
- refresh does not add a duplicate player

### 18. Validate a game

Start the game and verify:

1. All players see the same video/card.
2. Every player's name remains a possible answer.
3. Each player can submit only one guess.
4. The countdown roughly agrees on every device.
5. The answer reveals automatically when everybody has guessed or the deadline expires.
6. Correct guesses receive one point.
7. The next round starts automatically.
8. The final leaderboard appears.
9. Play Again returns the existing players to a clean lobby.

### 19. Test persistence, the problem that was fixed

During a lobby/game:

1. Refresh one player's page.
2. Confirm their identity and room membership survive.
3. Open Vercel and redeploy the same commit if you want a stronger test.
4. Reopen the room page.
5. Confirm room/game data still exists because it is stored in Supabase, not Vercel RAM.

---

## Part 7: Confirm Realtime

### 20. Check live lobby updates

Keep the host lobby open and join from a second device.

The new player should appear without manually refreshing the host page.

The application uses Supabase Realtime as the fast invalidation path. It also has a low-frequency recovery poll and deadline-triggered refetches so a temporary Realtime/WebSocket failure does not permanently strand a game.

---

## Part 8: What costs £0 and what can stop being free

For this personal testing deployment:

- Vercel Hobby costs £0 while you stay inside Hobby limits and use it for allowed personal/non-commercial purposes.
- Supabase Free costs £0 while you remain on the Free plan and inside its quota/fair-use restrictions.
- GitHub can host the repository for free.
- The `*.vercel.app` domain and HTTPS certificate cost £0.
- Oracle Cloud is not needed.
- DuckDNS is not needed.
- A custom domain is not needed.

Do not upgrade either service if your requirement is strictly £0.

If you eventually turn this into a commercial product, Vercel Hobby is not the appropriate plan because its terms restrict Hobby to personal/non-commercial use. At that point hosting becomes a separate business decision.

Supabase Free projects can also be paused after a period of inactivity. If a dormant project is paused, restore it from the Supabase dashboard before playing again.

---

## Future TikTok OAuth setup

Do not configure TikTok just to test the multiplayer MVP. The fake provider is intentional.

When you later obtain approved TikTok credentials, set:

```text
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://YOUR-VERCEL-URL.vercel.app/api/auth/tiktok/callback
TIKTOK_TOKEN_ENCRYPTION_KEY=<another random 48-byte secret>
```

Register that exact HTTPS callback URI in TikTok's developer console.

Connecting TikTok still must not be presented as access to liked/reposted video history unless TikTok has officially granted the required API capability.
