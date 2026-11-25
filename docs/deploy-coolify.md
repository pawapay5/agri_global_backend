# Deploying AgriPrice on Coolify

Coolify runs the stack in [`docker-compose.coolify.yml`](../docker-compose.coolify.yml) on your own server. It provides the domains, TLS, and generated secrets. Everything runs in one stack:

| Service | Exposed | Purpose |
|---|---|---|
| `web` | yes: your site domain | Next.js (standalone). Public pages, app, admin, and the BFF at `/api/*` |
| `api` | yes: API domain (the mobile app and the price-ingest pipelines use it) | NestJS REST API |
| `storage` | yes: files domain (image URLs) | S3-compatible storage (RustFS) for uploads and reports. MinIO is no longer published on Docker Hub. |
| `workers` | no | alerts, notifications, reports, revalidating web pages |
| `ml` | no | forecasting service |
| `migrate` | no (one-shot) | applies database migrations before `api` starts |
| `postgres` | no | TimescaleDB and PostGIS |
| `redis` | no | queues, cache, socket.io, web rate limits |
| `gotenberg`, `clamav`, `mlflow`, `storage-perms`, `storage-init` | no | PDF rendering, upload virus scanning, model registry, storage volume ownership, bucket setup (makes `agriprice-images` publicly readable) |

**Server sizing.** Plan on at least 4 vCPU, 8 GB RAM and 60 GB disk. ClamAV alone uses about 1.5 GB of RAM. The first build compiles every image, so allow 10–15 minutes.

## 1. Create the resource

1. In Coolify, go to **Projects → (your project) → New → Resource**, then **Public/Private Repository**, pick this repo and branch, and choose the **Docker Compose** build pack.
2. Set the compose file to `/docker-compose.coolify.yml`.
3. Under **Domains**, assign:
   - `web`: `https://agriprice.example`;
   - `api`: `https://api.agriprice.example`;
   - `storage`: `https://files.agriprice.example`.

   Coolify generates domains if you skip this. Because `NEXT_PUBLIC_SITE_URL` is baked in at build time, redeploy `web` after changing its domain.

## 2. Environment

Coolify generates and keeps every `SERVICE_PASSWORD_*` and `SERVICE_USER_*` value: database, Redis, storage, JWT, OTP pepper, revalidation secret and ML token. You must set these in the **Environment Variables** tab yourself. Compose checks the required ones when it builds, so if Coolify offers a build-time toggle for a variable, leave it on:

| Variable | Required | Notes |
|---|---|---|
| `FIELD_ENCRYPTION_KEY` | **yes** | Generate with `openssl rand -base64 32` (for example in the Coolify server's terminal). **Back it up:** losing it makes encrypted profile fields unreadable. Never rotate it casually. |
| `SMTP_URL` | **yes** | Transactional email (verification codes, alerts), e.g. `smtps://user:pass@smtp.provider.com:465` |
| `EMAIL_FROM` | **yes** | e.g. `AgriPrice <no-reply@agriprice.example>` |
| `SMS_PROVIDER` | no | Unset or `log`: **no SMS is sent in production** (the log provider only exists in development), so phone sign-in and SMS alerts won't work. Use `africastalking` with `AT_USERNAME`, `AT_API_KEY` and `AT_SENDER_ID`, or `twilio`. Email is the only channel that must work on day one, since sign-up verification codes go by email. |
| `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | no | Backend audiences for social sign-in |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_APPLE_SERVICE_ID` | no | Show the sign-in buttons on the web; build-time values |
| `ADMIN_IP_ALLOWLIST` | no | CIDRs, e.g. `203.0.113.0/24, 2001:db8::/32`. When set, `/admin` and `/api/v1/admin/*` return 404 to every other IP. |
| `CLIENT_IP_HEADER` | no | Set to `cf-connecting-ip` **only** if Cloudflare proxies your domain (see §5) |

## 3. First deploy

1. Click **Deploy**. `migrate` runs, then `api` starts once its health check passes, then `web` and `workers`.
2. Load the first country. In Coolify, open the **api** container's **Terminal** and run:
   ```sh
   node dist/seed/seed.cli.js gh
   ```
   This loads `country-packs/_global` and `gh`: commodities, markets, regions and units. Prices come from the ingest pipelines (`pipelines/`), which post to the API's import endpoint.
3. Check that it's up:
   - `https://agriprice.example/api/health` should return `{"status":"ok"}`;
   - `https://api.agriprice.example/healthz` should return 200;
   - `https://agriprice.example/en/gh/prices` should list Ghana's commodities.
4. Create the first admin. Sign up on the site, then set your role in Postgres from the **postgres** terminal:
   ```sh
   psql -U "$POSTGRES_USER" agriprice -c "update users set role='admin' where email='you@example.com';"
   ```

## 4. How the web app behaves in production

- **Build without the API.** The web image builds without contacting the API; it isn't on the build network. Public pages prerender from the country packs. Live prices stream in at request time and are cached by tag. When new prices land, the workers call `http://web:3000/api/revalidate`.
- **Outages.** If the API is down or slow, server fetches time out after 5 s (`SSR_FETCH_TIMEOUT_MS`) and pause for 15 s. BFF calls time out after 10 s (`API_TIMEOUT_MS`; exports get 60 s via `API_LONG_TIMEOUT_MS`). Pages render their "unavailable" states instead of hanging.
- **Security.**
  - **CSP:** `/app` and `/admin` render per request with a nonce-based policy (`script-src 'nonce-…' 'strict-dynamic'`). Cached public and auth pages use `script-src 'self' 'unsafe-inline'`, because a static page can't carry a per-request nonce. All other directives are strict.
  - **CSRF:** every mutating BFF request needs the same Origin and the double-submit token (`__Host-ap_csrf` cookie plus `X-CSRF-Token` header).
  - **Rate limits:** auth routes are rate-limited per IP in Redis (for example 10 logins per minute). If Redis is down, limiting fails open; the API keeps its own per-account throttles.
- **Scaling.** One `web` replica is the default. Next's page cache is in-process, so with more than one replica, a revalidation only reaches the replica that received it until each one's cache lifetime ends. Before scaling `web` out, add a shared cache handler (Redis); it isn't included yet.

## 5. Optional: Cloudflare in front

If Cloudflare proxies your domains:
- use SSL mode **Full (strict)**;
- set `CLIENT_IP_HEADER=cf-connecting-ip` so rate limits and the admin allow-list see visitors, not Cloudflare;
- lock the server's firewall to Cloudflare's IP ranges, otherwise anyone can bypass Cloudflare and forge that header.

## Troubleshooting sign-in and sign-up

1. **Open `https://<web domain>/api/health?deep=1`.**

   | What it shows | What it means | What to do |
   |---|---|---|
   | `api.reachable: false` | The web container can't reach the API. | The `api` service isn't running or isn't healthy. Check its logs. |
   | `api.ready: false` | The API can't reach its database. | The `checks` field names Postgres or Redis as down. |
   | `data.countries: 0` | No country is loaded. | Every sign-up fails with "AgriPrice isn't available in that country yet". Run the seed: in the **api** terminal, `node dist/seed/seed.cli.js gh`. |

2. **Read the web container's log.** Every rejected request has one line:
   - `[bff] POST /v1/auth/register → 422 country_unsupported` means the API refused it, and the last word is the reason.
   - `[bff] 403 cross_site_request: Origin host "…" is not one of ours […]` means the browser's address doesn't match the site's configured domain. Redeploy `web` after changing its domain.
   - `[bff] 403 csrf_failed: no … cookie` usually means the site URL scheme is wrong. If the site URL says `https://` but the site is served over `http://`, the browser drops the security cookie.
   - `[bff] API unreachable at …` means the network path from web to API is broken.
3. **The toast in the browser shows the specific reason** for every error code the API can return. A test fails the build if the backend adds a code without a message.

## 6. Backups

In Coolify, schedule backups for:
- `pgdata`, or better, scheduled `pg_dump` from the **postgres** service;
- `storagedata` (uploads and reports);
- `models` (trained forecast models).

Store `FIELD_ENCRYPTION_KEY` in your password manager.

## What has and hasn't been verified

- **Verified locally:**
  - the web standalone server, run exactly as the image runs it: health check, locale redirect, login redirect for `/app`, nonce on every app script, CSP headers, the CSRF cookie and its 403s, the admin allow-list 404, and upstream timeouts;
  - production build;
  - unit tests.
- **Not yet verified:**
  - `docker build` of the images, because Docker isn't installed on the development machine;
  - a real Coolify deploy, including how Coolify fills the `SERVICE_*` variables in build args.

  Run the first deploy on a staging domain and check §3 step 3.
