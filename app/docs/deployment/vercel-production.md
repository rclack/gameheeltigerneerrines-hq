# Vercel production deployment

This guide deploys GameHeelTigerNeerRines HQ from GitHub without putting secret values in the repository. Complete it only after the deployment-readiness checkpoint is pushed.

## Before you begin

Have access to:

- the GitHub repository `rclack/gameheeltigerneerrines-hq`;
- the Vercel account that will own the application;
- the existing Supabase project dashboard; and
- the CFBD API key.

Do not paste secret values into source files, GitHub issues, screenshots, or chat. Vercel Environment Variables are the correct place for the CFBD key.

## 1. Create the Vercel project

1. Sign in to Vercel and choose **Add New → Project**.
2. Import `rclack/gameheeltigerneerrines-hq` from GitHub.
3. Set **Framework Preset** to **Next.js**.
4. Set **Root Directory** to `app`.
5. Leave **Install Command** at the Vercel default (`npm install`/automatic detection).
6. Leave **Build Command** at the Next.js default (`npm run build`).
7. Leave **Output Directory** at the Next.js default. Do not enter `.next` manually.
8. Leave **Development Command** at the default.
9. Keep the committed `vercel.json`; it contains only the production CFBD cron schedules.
10. Use Vercel's current default Node.js version supported by Next.js 16. No project override is required.

## 2. Add Vercel environment variables

In **Project Settings → Environment Variables**, add these values before the first deployment:

| Name | Visibility | Environments | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public browser configuration | Production; Preview if previews will be tested | Existing Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public browser configuration | Production; Preview if previews will be tested | Existing Supabase publishable key |
| `CFBD_API_KEY` | Secret | Production; Preview only if provider testing is intended there | Server-only CFBD access |
| `SUPABASE_CRON_SECRET_KEY` | Secret | Production only | Dedicated named Supabase `sb_secret_...` key for scheduled CFBD synchronization |
| `CRON_SECRET` | Secret | Production only | High-entropy bearer secret automatically sent by Vercel Cron |
| `CFBD_CRON_LEAGUE_IDS` | Sensitive server configuration | Production only | Comma-separated UUIDs of the leagues scheduled for synchronization |
| `NEXT_PUBLIC_SITE_URL` | Public, recommended | Production | Canonical deployed origin: `https://gameheeltigerneerrines.com` |

`SUPABASE_SERVICE_ROLE_KEY` is not used by the production application and must not be added to Vercel. It is required only by disposable local integration harnesses. Scheduled synchronization instead uses a dedicated, independently rotatable modern Supabase Secret Key named for the cron service and stored only as `SUPABASE_CRON_SECRET_KEY`.

Never prefix the cron key, cron bearer secret, or league scope with `NEXT_PUBLIC_`. Do not print them in logs, return them from API routes, expose them through `/api/health`, or place them in source control.

### Scheduled CFBD synchronization

1. In Supabase **Settings → API Keys**, create a dedicated named Secret Key for the production CFBD cron service. It must begin with `sb_secret_`; do not substitute the legacy `service_role` JWT.
2. Add that value to Vercel Production as `SUPABASE_CRON_SECRET_KEY` with sensitive-value protection enabled.
3. Generate a separate high-entropy value and add it to Vercel Production as `CRON_SECRET`. Vercel sends it as `Authorization: Bearer ...` when invoking the cron route.
4. Add the approved production league UUIDs to `CFBD_CRON_LEAGUE_IDS`. This fixed server-side scope is the only league input accepted by the cron route.
5. Redeploy after setting all three values. Preview deployments should not receive these variables or execute production cron jobs.

The committed schedule runs daily at 11:00 UTC and adds a second Saturday run at 21:00 UTC. This stays within the two-job/daily-frequency Vercel Hobby limits while providing additional game-day coverage. Both invocations call `/api/cron/cfbd-sync`, which reuses the existing CFBD sync service, audit rows, failure recording, manual-override protection, and idempotent import RPCs. It never processes scoring.

The database wrappers used by this route are executable only by Supabase's elevated `service_role`, which is the Postgres role assigned to modern Secret Keys. They bind only the configured league's commissioner context before invoking the existing sync RPC chain. A league-level overlap guard rejects concurrent runs and closes stale runs older than 45 minutes as failed audit entries.

To rotate the Supabase cron key:

1. Create a new named Secret Key in Supabase without deleting the old key.
2. Replace `SUPABASE_CRON_SECRET_KEY` in Vercel Production and redeploy.
3. Verify one authorized cron invocation and its sync audit entry.
4. Delete the old Supabase Secret Key only after the new deployment is verified.

Rotate `CRON_SECRET` separately by replacing it in Vercel and redeploying. Never include either old or new values in tickets, chat, documentation, screenshots, or command output.

In a Vercel Production deployment, the application always uses
`https://gameheeltigerneerrines.com` as its public origin. Outside Vercel
Production, it resolves its public origin in this order:

1. `NEXT_PUBLIC_SITE_URL`;
2. Vercel's system-provided `VERCEL_URL`; and
3. `http://localhost:3000` for local development.

For the first deployment, Vercel may not have assigned the final URL when variables are entered. It is acceptable to deploy once using the automatic `VERCEL_URL`, record the stable production URL, set `NEXT_PUBLIC_SITE_URL` to that exact HTTPS origin with no trailing path, and redeploy before inviting public users.

Never create `NEXT_PUBLIC_CFBD_API_KEY`.

## 3. Make the first deployment

1. Select **Deploy**.
2. Wait for the build and deployment checks to finish.
3. Record the stable production URL shown by Vercel, for example:

   `https://gameheeltigerneerrines.com`

4. In Vercel, set `NEXT_PUBLIC_SITE_URL` for **Production** to that exact origin if it was not known before the first build.
5. Redeploy the same Git commit so invitation and signup confirmation links use the canonical production origin.

Do not invite users until the Supabase URL settings below are complete.

## 4. Configure Supabase authentication URLs

Vercel deployment does not update Supabase automatically.

1. Open the existing Supabase project.
2. Go to **Authentication → URL Configuration**.
3. Set **Site URL** to the exact production origin:

   `https://gameheeltigerneerrines.com`

4. Add this exact production redirect URL to **Redirect URLs**:

   `https://gameheeltigerneerrines.com/auth/callback`

5. Keep these local entries if local development should continue:

   - Site/redirect development origin: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`

6. Save the configuration.

The Supabase **Confirm signup** email template must send the signed token hash to
the application callback so confirmation does not depend on the browser that
started signup. Set its confirmation link to:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup">Confirm email address</a>
```

`RedirectTo` already contains `/auth/callback?next=...`, so the template uses
`&token_hash=...` rather than starting another query string.

### Optional preview strategy

Preview authentication is not required for launch. The conservative choices are:

- Do not test email-confirmation signup on previews; test it on the production deployment only.
- For a specific preview QA session, add that preview's exact `https://...vercel.app/auth/callback` URL temporarily, then remove it after QA.

Avoid a broad wildcard preview redirect unless the team explicitly accepts the larger redirect surface. Another safe option is to set `NEXT_PUBLIC_SITE_URL` to the production origin in Preview, causing confirmation and invitation links generated by previews to return to production.

## 5. First-deployment checklist

- [ ] Vercel imported `rclack/gameheeltigerneerrines-hq`.
- [ ] Root Directory is `app`.
- [ ] Framework Preset is Next.js.
- [ ] Install, build, and output settings use Vercel defaults.
- [ ] The public application variables and server-only CFBD variables are configured.
- [ ] `NEXT_PUBLIC_SITE_URL` contains the exact stable production origin.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is absent from Vercel.
- [ ] `SUPABASE_CRON_SECRET_KEY`, `CRON_SECRET`, and `CFBD_CRON_LEAGUE_IDS` exist only in Vercel Production.
- [ ] The Supabase cron key is a dedicated named `sb_secret_...` key and is not exposed by `/api/health`.
- [ ] Supabase Site URL is the exact production origin.
- [ ] Supabase allows the exact production `/auth/callback` URL.
- [ ] The production deployment was rebuilt after its canonical URL was configured.
- [ ] `GET /api/health` returns `status: "ok"` and both configuration booleans are `true`.

## 6. Post-deployment smoke test

Use disposable accounts and a disposable league where a mutation is necessary.

1. Open the public landing page in a private browser window. Confirm **Commissioner Login** and **Create Account** are obvious.
2. Create an account and follow the confirmation email. Confirm `/auth/callback` returns to the intended internal page.
3. Sign out and sign in again. Refresh the page and confirm the session persists.
4. As a disposable commissioner, create a league and invitation.
5. Use **Copy Invite Link**. Confirm it starts with the production HTTPS origin, not localhost or a preview URL.
6. Open the invitation as its intended disposable owner, sign up or sign in, accept it, and confirm arrival on the league page.
7. Confirm the owner can immediately find **My Season**, points/place, **View My Score**, **League Standings**, and the draft room/results.
8. Confirm the commissioner can find **View My League**, Draft, Scoring, and Standings.
9. Open the draft page in two authenticated browsers. Confirm Realtime updates arrive and the five-second polling fallback keeps both views current.
10. Open commissioner scoring and run **Test Connection** for CFBD.
11. Run one disposable-league CFBD schedule synchronization. Confirm the sync audit succeeds and no scoring event or owner point is created by synchronization.
12. Confirm final imported games still require the commissioner to select **Process Scoring**.
13. Confirm owner and anonymous users cannot access commissioner mutations.
14. Confirm `/api/health` exposes only status/configuration booleans and no URL, key, token, header, or provider response.

Do not rerun seed data or alter the established development league during smoke testing.

## 7. Rollback

If the deployment fails or a smoke test finds a regression:

1. In Vercel, open **Deployments**.
2. Find the most recent known-good deployment created from the previous Git commit.
3. Open its menu and choose **Promote to Production** or **Redeploy**, depending on the Vercel dashboard wording.
4. Confirm the production domain now points to that deployment.
5. Do not rewrite Git history or reset the database as part of a Vercel rollback.
6. Fix the problem in a new Git commit, validate it, push it, and deploy normally.

A Vercel code rollback does not reverse Supabase migrations. If a future deployment includes a database migration, its rollback must have a separately reviewed database plan.
