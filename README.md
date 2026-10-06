# RentRover Backend

Plain JavaScript (no TypeScript build step), on Cloudflare Workers + D1.
Powers `GET /api/search/combined` and `/api/auth/*` — the exact two
endpoints the [RentRover frontend](../rentrover-ai) already calls and
degrades gracefully without.

Subscription-funded, not pay-per-call: three tiers ($5/$7/$9) buy search
quota, not individual requests. No x402 payment gate on this backend's own
API — that was deliberately deferred (see the planning discussion) in
favor of this backend being the thing subscriptions fund.

## Pipeline

```
GET /api/search/combined?q=...
        │
        ▼
  search_cache fresh for this query? ──yes──► serve cached property ids, done.
        │ no
        ▼
  run Booking.com + Trip.com scrapers in parallel (Airbnb: off by default,
  see scrapers/airbnb/extract.js)
        │
        ▼
  each scraper: proxyFetch → extract (JSON-LD first, HTML fallback second)
                → got results? log 'ok', done.
                → got nothing? classify/triage.js diagnoses WHY
                  (blocked / empty / error) for scrape_log, nothing else
        │
        ▼
  normalize/dedupe.js — merge listings that minted the same id (name+city)
  across platforms into one property with multiple `sources` entries
        │
        ▼
  store/d1.js — per property: content-hash match to what's stored?
                unchanged → bump last_verified_at only
                changed/new → full upsert
        │
        ▼
  cache this query's resulting id list, return the properties
```

## Why plain JS, not TypeScript

No build step — Wrangler deploys these files directly. JSDoc comments
(`@param`, `@typedef` in `src/types.js`) document shapes for editor
hints; nothing is type-checked at build time. Keep that in mind when
editing — a typo in a field name won't be caught until runtime.

## What's real vs. mock right now

| Piece | Status |
|---|---|
| D1 schema, validity-check caching, search caching | Real |
| Booking.com scraper — JSON-LD extraction | Real-ish — written against schema.org's standard Hotel markup, not tested against a live response from here |
| Booking.com scraper — HTML fallback | **Unverified** — selectors are a best guess, check against a live page |
| Trip.com scraper | **Unverified** — the embedded-state variable name (`window.IBU_HOTEL`) is a best guess |
| Airbnb scraper | **Unverified, off by default** (`ENABLE_AIRBNB = false` in `orchestrator.js`) — no JSON-LD, no stable public structure to extract from; rewrite against a real captured response before enabling |
| Proxy layer (`proxy/credentials.js`) | **Mock** (`PROXY_MODE=mock` in `wrangler.toml`) — direct, unproxied requests. Will get blocked fast against the real sites; see the TODO in that file for the x402 purchase flow once a wallet exists |
| Triage (`classify/triage.js`) | Real, and permanent by design — rule-based fingerprint matching for known bot-wall providers (Cloudflare/PerimeterX/Akamai/DataDome), runs only when an extraction comes back empty. Deliberately NOT a learned classifier — see that file's header for why; a successful extraction is itself the validity proof, so there's nothing for a model to add on the success path |
| Auth (signup/login) | Real — PBKDF2 password hashing, real D1-backed accounts |
| Subscription tier enforcement | Partial — enforced by email passed in an `X-User-Email` header, which is **not a real session token**. Anyone can pass anyone's email right now. Fine for solo prototyping, not for real users — needs a real bearer-token session before this is trustworthy |
| x402 public developer API | Not built — deferred per the earlier planning discussion |

## The in-app browser dependency

The frontend's checkout flow (`components/inAppBrowser.js` /
`utilities/platformLinks.js`) needs a **real per-listing URL**, not a
search-results page. Every scraper here is written to carry that through:
`sources[].url` on every returned property is the actual listing page on
that platform — if a scraper can't find a real listing URL for an item,
it drops that item rather than returning a broken link (see the
`.filter()` calls at the end of each `extract.js`).

## Setup

```bash
npm install
npx wrangler d1 create rentrover          # then paste the returned database_id into wrangler.toml
npm run db:migrate                         # applies schema.sql locally
npm run dev                                 # local dev server
```

Before any real scraping: flip `PROXY_MODE` to `'real'` in `wrangler.toml`
and implement `_realX402PurchaseFlow` in `src/proxy/credentials.js` (the
exact steps are documented inline) — needs a funded Solana or Base wallet,
set as a Wrangler **secret** (`wrangler secret put PROXIES_WALLET_PRIVATE_KEY`),
never a plain `[vars]` entry.

## Known gaps worth tracking

- **Region field is empty** on every scraped property (`region: ''` in
  each scraper's `index.js`) — needs a city→region lookup table or a
  geocoding step; the frontend's destination filtering depends on it.
- **No anonymous rate limiting** — `checkAndConsumeSearchQuota` only
  enforces a limit when an `X-User-Email` header is present; a request
  with no header currently has no limit at all. Needs either a Cloudflare
  rate-limiting rule or a KV-based IP counter before this is public.
- **CORS is wide open** (`origin: '*'` in `index.js`) — tighten to the
  real frontend domain before deploying anywhere reachable.
