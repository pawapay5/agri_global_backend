# AgriPrice web: architecture proposal (Step 1)

Status: **approved with hosting decided: self-hosted on Coolify** (2026-11-24). §7 and §9 reflect what's built; see [deploy-coolify.md](deploy-coolify.md).

Scope: `apps/web`, the web companion to the mobile app. It serves public visitors and search engines, signed-in users, and staff (admins, data operators and enumerators).

## 0. Where we start from

Parts of Step 3 were built before this spec arrived. They're kept, but refactored to the rules below.

| Area | Exists today | Change under this proposal |
|---|---|---|
| Auth and BFF | `/api/auth/*`: login, register, OTP, MFA, forgot/reset, logout, refresh, Google and Apple sign-in. httpOnly cookies, silent refresh in `proxy.ts`, Origin check. | Add a CSRF token, rate limiting, passkeys and Facebook sign-in (§7). |
| Public pages | landing, `/{cc}/prices`, `/{cc}/prices/{commodity}`, OG image, sitemaps, robots | Move to the `components/agri` library. Server-rendered charts to hit the JS budget (§6). |
| App | dashboard, commodities and detail tabs, forecast with SHAP, market comparison, alerts | Rebuild on the design system. Add the missing routes. |
| Feedback | app-wide alert dialog for action outcomes | Keep. Document it in Storybook. |

**Framework note.** The repo runs **Next.js 16.4** (the spec says 15). Everything here uses the Next 16 conventions:
- `proxy.ts`, not `middleware.ts`;
- Cache Components with `'use cache'`, `cacheTag` and `cacheLife`;
- async `params`;
- Partial Prerendering.

## 1. Folder structure

```
apps/web/
├─ .storybook/                    main.ts, preview.tsx (theme, locale and dir toolbars; MSW from the contract)
├─ e2e/                           Playwright specs, fixtures, axe helpers
├─ lighthouserc.json              Lighthouse CI budgets (§6)
├─ src/
│  ├─ app/                        routes only: thin pages that compose features (§2)
│  ├─ components/
│  │  ├─ ui/                      shadcn base on Radix: button, input, select, dialog, alert-dialog, sheet,
│  │  │                           tabs, tooltip, popover, dropdown, table, skeleton, badge, toast, form
│  │  ├─ agri/                    domain library (§5): PriceCell, ChangeBadge, StatCard, CommodityAvatar,
│  │  │                           RangeTabs, PriceChart, ForecastChart, ShapBars, MarketMap, RegionHeatmap,
│  │  │                           InsightCard, AlertForm, EmptyState, DataFreshness, CurrencyUnitSwitcher,
│  │  │                           LocaleSwitcher, plus chart/ChartTable (accessible fallback)
│  │  ├─ shells/                  public-shell, app-shell (sidebar and bottom nav), admin-shell, auth-shell
│  │  ├─ seo/                     JsonLd, alternates, breadcrumbs
│  │  └─ feedback/                alert dialog (exists)
│  ├─ features/                   one folder per area: client views, hooks and schemas
│  │  ├─ dashboard/ commodities/ forecast/ markets/ alerts/ notifications/ insights/ reports/
│  │  ├─ data-explorer/ billing/ messages/ marketplace/ seller/ community/ tools/ org/
│  │  └─ developers/ profile/ settings/ admin/
│  ├─ lib/
│  │  ├─ api/                     schema.d.ts (generated) · server.ts (cached RSC fetchers) · browser.ts
│  │  │                           (openapi-fetch via the BFF) · queries/ (TanStack hooks per area) · tags.ts
│  │  ├─ auth/                    tokens, bff helpers, csrf, rate-limit, roles
│  │  ├─ format/                  money, units, numbers, dates, relative time (Intl), plus tests
│  │  ├─ url-state/               nuqs parsers shared by features (commodity, market, range, horizon…)
│  │  ├─ security/                csp.ts (nonce and SRI policies), ip-allowlist.ts
│  │  ├─ countries.ts  env.ts  charts.ts  utils.ts
│  ├─ i18n/  messages/{en,fr,tw,ee,gaa,ha,sw,pt,ar}.json  (split by namespace: public, app, admin)
│  └─ proxy.ts                    locale → CSP nonce (app/admin) → IP allow-list (admin) → silent refresh → role gate
└─ mocks/                         Prism config and recorded examples for Storybook and e2e
```

**Rules:**
- `app/` pages contain no business logic.
- `components/agri` never fetches; it takes typed props built from `components["schemas"]`.
- `features/*` own the data hooks.

## 2. Route tree, rendering and caching

Legend:
- **SSG**: generated at build from `generateStaticParams` (country packs), refreshed on demand by tag.
- **PPR**: static shell plus streamed dynamic parts.
- **Dyn**: rendered per request.
- **CSR-data**: shell is static; data comes from TanStack Query through the BFF.

### 2.1 Public: `/[locale]/…` (indexable)

| Route | Render | Cache tags (cacheLife) | JSON-LD | Mockup |
|---|---|---|---|---|
| `/` landing | SSG | `content`, `prices:{cc}` for the ticker (hours) | Organization, WebSite | Onboarding, Impact |
| `/{cc}/prices` | SSG | `prices:{cc}` (minutes) | BreadcrumbList, Dataset | Markets |
| `/{cc}/prices/{commodity}` | SSG | `prices:{cc}:{commodity}`, `catalogue:{cc}` | Dataset, BreadcrumbList, FAQPage | Commodity detail, History |
| `/{cc}/markets/{market}` | SSG | `prices:{cc}:market:{market}` | Place, Dataset, Breadcrumb | Markets |
| `/{cc}/regions/{region}` | SSG | `prices:{cc}:region:{region}` | Dataset, Breadcrumb | Regional heatmap |
| `/{cc}/marketplace` | PPR: shell static, listings streamed with `cacheLife("minutes")` | `listings:{cc}` | ItemList | (no mockup) |
| `/{cc}/marketplace/{listing}` | SSG on first request (ISR-style) | `listing:{id}` | Product, Offer, Breadcrumb | (no mockup) |
| `/guides/{crop}`, `/pests/{slug}` | SSG | `content:guides`, `content:pests` (days) | Article, HowTo, Breadcrumb | Help |
| `/methodology` `/pricing` `/about` `/stories` `/help` `/help/{slug}` `/contact` `/legal/privacy` `/legal/terms` | SSG | `content` (days) | FAQPage (help), Article | Help, Success stories |
| `/status` | PPR, component status streamed (`cacheLife("seconds")`) | n/a | n/a | n/a |

Country is a path segment (`/en/gh/prices`). The spec's `/[locale]/[country]/prices/[commodity]` maps to `/{cc}/prices/{commodity}`. Every page ships:
- `generateMetadata`;
- hreflang alternates for all 9 locales plus `x-default`;
- an OG image from `next/og`;
- a per-country sitemap and `robots.txt`.

### 2.2 Auth: `/[locale]/(auth)/…` (noindex)

`/login`, `/signup`, `/verify`, `/forgot-password`, `/onboarding` (country, role, crops and markets, alert opt-in), `/2fa`. These are SSG shells with client forms.

### 2.3 Signed-in: `/[locale]/app/…` (noindex, CSR-data, nonce CSP)

| Route | Notes | Mockup |
|---|---|---|
| `/app` | dashboard: snapshot, trending, AI banner, alerts summary | Home |
| `/app/commodities`, `/app/commodities/{id}?tab=overview\|history\|forecast\|markets&range=` | | Commodity detail, History |
| `/app/forecast`, `/app/forecast/{commodity}?market=&h=` | chart and SHAP side by side | Forecast, SHAP |
| `/app/markets?commodity=&markets=&view=chart\|table&range=` | | Comparison |
| `/app/markets/map`, `/app/markets/heatmap`, `/app/markets/nearby` | MapLibre, loaded only on these routes | Map, Heatmap, Nearby |
| `/app/insights/seasonal`, `/recommendations`, `/weather`, `/export` | | Seasonal, Recommendations, Weather, Export |
| `/app/alerts`, `/app/notifications` | | Alerts, Notifications |
| `/app/reports`, `/app/data` | Premium explorer: TanStack Table, bulk export | Reports |
| `/app/profile`, `/app/settings`, `/app/billing` | | Profile/Settings |
| `/app/marketplace/…`, `/app/sell/…`, `/app/analytics` | buyer side, seller centre, seller analytics | (no mockup) |
| `/app/messages` | realtime over socket.io via the BFF (§7) | (no mockup) |
| `/app/community`, `/app/tools` | | (no mockup) |
| `/app/org`, `/app/developers` | members and roles; API keys and usage | (no mockup) |
| `/app/collect` | enumerator price submission; role-gated on the server | (no mockup) |

### 2.4 Admin: `/[locale]/admin/…` (proposed; the spec's admin list was cut off)

Derived from the contract's `/v1/admin/*` operations. Role-gated in `proxy.ts` and again in each page (server). Optional IP allow-list.

| Route | Contract |
|---|---|
| `/admin` | overview: queues, ingest health, model status |
| `/admin/prices/review` | `GET /admin/prices/review-queue`, `POST /admin/prices/{id}/review` |
| `/admin/prices/import` | CSV import: `POST /admin/prices/import` (dry run, then commit) |
| `/admin/catalogue/{table}` | `/admin/tables/{table}` (commodities, markets, units…) |
| `/admin/country-packs/{iso2}` | `/admin/country-packs/{iso2}` |
| `/admin/users`, `/admin/users/{id}` | roles, suspension |
| `/admin/moderation` | `/admin/moderation`, `/moderation/reports` |
| `/admin/disputes`, `/admin/disputes/{id}` | ships **with** the marketplace |
| `/admin/payouts`, `/admin/reconciliation` | ships with payments |
| `/admin/knowledge` | `/admin/knowledge/{table}/{id}/review`, revisions |
| `/admin/broadcasts` | |
| `/admin/models` | ML model registry and backtests |
| `/admin/audit-log` | |

### 2.5 Route handlers: `/api/…`

| Handler | Purpose |
|---|---|
| `/api/auth/[action]`, `/api/auth/oauth/[provider]`, `/api/auth/passkey/*` | auth BFF |
| `/api/v1/[...path]` | BFF passthrough |
| `/api/revalidate` | backend webhook, secret-guarded |
| `/api/realtime/token` | short-lived socket token |
| `/api/csp-report` | CSP violation reports |

## 3. Layout hierarchy

```
app/[locale]/layout.tsx             <html lang dir>, fonts, theme, intl provider (namespaced messages only)
├─ (public)/layout.tsx              PublicShell: header (country and locale switchers), footer. No Query, nuqs or session.
├─ (auth)/layout.tsx                AuthShell: brand panel. Query and feedback providers.
├─ app/layout.tsx                   AppShell: sidebar ≥1024 px, bottom nav <1024 px, top bar (search, notifications, profile).
│                                    Query, nuqs, feedback and realtime providers.
└─ admin/layout.tsx                 AdminShell: dense sidebar, environment badge, staff role check (server).
```

Providers move out of the root layout into the shells. Public pages then stop shipping TanStack Query, nuqs, the dialog and the full message catalogue. Today they ship all of it, which is a large part of the budget overrun in §6.

## 4. Caching strategy

**Server fetch.** Public data is read in Server Components through `lib/api/server.ts`, as `'use cache'` functions with `cacheTag` and `cacheLife`. This is the Next 16 equivalent of "fetch caching with tags": same tags, same `revalidateTag`.

**Tag scheme** (lower-case):

| Tag | Covers |
|---|---|
| `prices:{cc}` | country-wide |
| `prices:{cc}:{commodity}` | one commodity, e.g. `prices:gh:tomato` |
| `prices:{cc}:market:{code}`, `prices:{cc}:region:{code}` | one market or region |
| `forecast:{cc}:{commodity}` | one commodity's forecast |
| `catalogue:{cc}` | commodities, markets and units |
| `content`, `content:guides`, `content:pests`, `content:stories` | editorial content |
| `listings:{cc}`, `listing:{id}` | marketplace |

**Lifetimes:**

| Data | cacheLife |
|---|---|
| prices | `minutes` |
| forecasts | `hours` |
| catalogue | `hours` |
| content | `days` |
| any fetch that failed | `seconds` (so outages heal fast) |

**Invalidation.** The workers and the API POST `{ tags: [...] }` to `/api/revalidate`, secret-guarded:
- after aggregate refresh: `prices:*` for the affected commodities and markets;
- after `/internal/forecasts/refreshed`: `forecast:*`;
- on admin edits: catalogue and content tags.

Today the webhook only knows country-level scopes; it moves to explicit tags.

**Client.** TanStack Query handles interactive filters only:
- `staleTime` 60 s for prices, 10 min for forecasts;
- the query key always mirrors the URL search params.

**URL is the state.** Filters, ranges, markets, the commodity, tabs, horizon, view, map bbox and zoom live in nuqs parsers in `lib/url-state`. Every view is shareable and back/forward works.

**CDN.** Public SSG pages are served from the edge. `/app` and `/admin` are `private, no-store`.

## 5. Design system

### 5.1 Tokens

These are CSS variables in `globals.css`, mapped into Tailwind v4 via `@theme inline`. Light values are listed first; the dark theme is in the right-hand column.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | #0F5132 | #3BB54A | primary, headers |
| `--leaf` | #3BB54A | #4ADE80 | history series, success |
| `--forecast` | #F59E0B | #FBBF24 | forecast series, band (22 % alpha) |
| `--up` / `--down` | #16A34A / #DC2626 | #22C55E / #F87171 | price change, always with an arrow and sign (not colour alone) |
| `--surface` | #F7F9F8 | #0B1410 | page background |
| `--card`, `--muted`, `--border`, `--fg`, `--muted-fg`, `--ring` | (existing) | (existing) | |
| `--chart-1…6` | categorical, colour-blind-checked | | multi-market lines |
| `--heat-0…6` | sequential green→orange for the heatmap | | |

The other scales:
- **Type:** Inter with tabular numbers for prices; 12/14/16/18/24/30/36.
- **Radius:** 8/12/16/full.
- **Spacing:** Tailwind 4 px scale.
- **Elevation:** 0–3.
- **Motion:** 150/250 ms, off under `prefers-reduced-motion`.
- **Z-index:** nav 40, overlay 50, toast 60.

All foreground/background pairs are checked for 4.5:1 contrast (3:1 for large text and chart marks) in light and dark, and the check runs in CI.

### 5.2 Components and their contracts

Each component has light, dark and RTL (`ar`) stories, plus loading, empty and "Not enough data" states.

| Component | Contract |
|---|---|
| `PriceCell` | display `amount`, `currency` and `unit` from the API. Formats with `Intl.NumberFormat(locale, {style:"currency"})`. Never computes. |
| `ChangeBadge` | %, arrow and sign; screen-reader text "up 4.2 percent week on week". |
| `PriceChart`, `ForecastChart` | history solid `--leaf`, P50 dashed `--forecast`, P10–P90 band, "Today" reference line, keyboard-focusable points, `aria-describedby` summary. `<ChartTable>` fallback behind a "View as table" toggle. |
| `ShapBars` | diverging bars with feature labels and share %; table fallback. |
| `MarketMap` | MapLibre and react-map-gl with OpenFreeMap tiles (free); keyboard pan and zoom; marker list as the accessible alternative. |
| `RegionHeatmap` | choropleth from `/regions/choropleth` with a legend (binned, units shown); table fallback. |
| `DataFreshness` | "Updated 2 h ago · WFP / MoFA". Relative time via `Intl.RelativeTimeFormat`; absolute time in a tooltip. Required next to every price and forecast. |
| `EmptyState` | covers the API's `insufficient_data` reasons; never shows a placeholder number. |
| `CurrencyUnitSwitcher` | writes `?currency=&unit=` and the profile preference. |
| `LocaleSwitcher` | keeps the path; sets the `ap_locale` cookie. |
| others | `StatCard`, `CommodityAvatar`, `RangeTabs`, `InsightCard`, `AlertForm` |

**Storybook.** Use `@storybook/nextjs-vite` (to be confirmed against Next 16 in Step 2) with:
- a toolbar for theme, locale and direction;
- `@storybook/addon-a11y` (axe) on every story;
- MSW handlers generated from the contract examples.

## 6. Performance budget

**Targets** on a mid-range Android over 4G:
- LCP under 2.5 s, INP under 200 ms, CLS under 0.1;
- **public JS under 150 KB gzipped.**

**Measured today** from the production build, gzipped JS loaded by the page:

| Page | JS | Status |
|---|---|---|
| `/en` landing | ~205 KB | over |
| `/en/gh/prices` | ~205 KB | over |
| `/en/gh/prices/maize-white` | ~343 KB | over: Recharts on the client |

**Plan:**
1. **Public pages get no client chart library.** `PriceChart` and `ForecastChart` render as server SVG, using the same series transform (`lib/charts.ts`). A small client island adds hover and keyboard tooltips only. The full interactive Recharts chart stays in `/app`.
2. **Providers move to the shells** (§3). Public pages keep only intl, with the `public` namespace, and theme.
3. **Heavy libraries load lazily on the routes that use them:** MapLibre, Recharts and TanStack Table only on `/app` routes.
4. **No layout shift:** `next/image` with AVIF/WebP and fixed aspect ratios; fonts via `next/font` with fallback metrics.
5. **Enforced in CI:**
   - Lighthouse CI (`@lhci/cli`, mobile preset, throttled 4G) on landing, a price index and a commodity page;
   - a bundle-size check that fails the PR over 150 KB.

## 7. Security

### CSP

Nonces force every page to render dynamically: no SSG, ISR, PPR or CDN caching, as the Next 16 CSP guide states. That conflicts with the SEO and Core Web Vitals goals for public pages. Proposed split:

| Area | Policy |
|---|---|
| `/app`, `/admin`, auth pages | **nonce-based strict CSP** set in `proxy.ts`: `script-src 'nonce-…' 'strict-dynamic'`, no `unsafe-inline`. These routes render per request; they're per-user anyway. |
| Public pages | **hash-based CSP via Next's experimental SRI** (`experimental.sri`): `script-src 'self'` plus integrity hashes, static and cacheable. If SRI proves unworkable with Turbopack in Step 2, fall back to `script-src 'self' 'unsafe-inline'` on public pages only. Those pages hold no session or user data, and all other directives stay strict. |
| Everywhere | `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `report-to /api/csp-report` |

### Other controls

- **CSRF on BFF routes.** Keep the Origin/Referer check and add a double-submit token: a `__Host-ap_csrf` cookie plus an `X-CSRF` header on every mutating request. Cookies stay `SameSite=Lax`.
- **Rate limiting on auth routes.** The backend already throttles login and OTP per account and IP. The BFF adds a per-IP limit (for example 10/min on login, 3/min on OTP request). It needs a shared store: Redis when self-hosted; on Vercel, Vercel's own firewall rules or Upstash. See question 3.
- **No secrets in client bundles.** Only `NEXT_PUBLIC_*` public IDs; `server-only` guards on `env.ts` and the BFF libs; a CI grep for secret patterns in `.next/static`.
- **Admin:**
  - role check in `proxy.ts` plus a server check in the admin layout and every admin page and action;
  - optional `ADMIN_IP_ALLOWLIST` (CIDR list) enforced in `proxy.ts`, using the client IP from `x-forwarded-for` set by Vercel or Cloudflare;
  - every admin mutation is audit-logged by the backend.
- **Passkeys (WebAuthn).** The contract has no WebAuthn endpoints yet. They need backend work first: register/assert options and verify. See question 5.
- **Realtime messages.** The browser can't send the httpOnly token to socket.io. `/api/realtime/token` mints a short-lived (60 s), audience-scoped token for the socket handshake.

## 8. Testing

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | formatters (money, units, relative time, RTL digits), chart transforms, URL-state parsers, hooks via `renderHook` with a mocked client |
| Component | Testing Library (+ jsdom; needs Node ≥ the version undici 8 requires, see question 7) | every `components/agri` component: states, keyboard, aria |
| Contract mocks | **Prism** (`@stoplight/prism-cli`, open source) serving `openapi/openapi.yaml` | Storybook (via MSW), Playwright, and local development when backend endpoints aren't live |
| E2E | Playwright (desktop and Pixel 7) | sign-up → OTP → onboarding → dashboard → forecast → alert; report export; admin CSV import; locale/RTL smoke |
| Accessibility | `@axe-core/playwright` | landing, price index, commodity, dashboard, forecast, alerts, admin import; fails on serious or critical issues |
| Performance | Lighthouse CI | budgets in §6 |

## 9. Deployment

- **Decided: Coolify (self-hosted).** `output: "standalone"` image (`apps/web/Dockerfile`), whole stack in `docker-compose.coolify.yml`, optional Cloudflare in front. Preview deployments per PR use Coolify's preview feature.
- **Single `web` replica for now.** Before scaling out, add a Redis-backed Next cache handler so `revalidateTag` reaches every replica.
- **CI pipeline:** typecheck → lint → unit → build → Lighthouse CI and bundle budget → Playwright against Prism (PR) or staging (main).

## 10. Questions before Step 2

1. **CSP split (§7).** Do you accept nonce CSP for app, admin and auth, and SRI or hash CSP for public pages? The alternative is nonces everywhere, which gives up static public pages.
2. **Hosting.** Vercel or self-hosted? Vercel's paid tiers and Upstash are third-party paid services not named in the spec; the self-hosted route needs a Redis cache handler.
3. **Auth rate-limit store.** The answer depends on question 2: Redis when self-hosted, Vercel firewall or Upstash on Vercel.
4. **Analytics.** Vercel Analytics or PostHog? Both sit behind consent. PostHog has a free tier and can be self-hosted.
5. **Passkeys.** Should I add WebAuthn endpoints to the contract and backend (a backend change), or ship passkeys later?
6. **Admin routes (§2.4).** These are derived from the contract because the spec's list was cut off. Is anything missing, for example the enumerator management screens?
7. **Node version.** Component tests need jsdom 31, which won't load on this machine's Node 22.14. Should I upgrade the local and CI Node to 24 LTS, or pin jsdom 26?
8. **Marketplace public pages.** Should `/{cc}/marketplace/{listing}` be indexable for every listing, or only for verified sellers? This affects spam and SEO.
