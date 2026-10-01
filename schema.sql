-- ============================================================
-- RentRover backend — D1 schema
-- Run with: wrangler d1 execute rentrover --file=schema.sql
-- ============================================================

-- One row per de-duplicated property. `content_hash` is what the
-- validity-check compares against a fresh scrape to decide "unchanged,
-- just bump last_verified_at" vs "changed, overwrite + re-cache".
CREATE TABLE IF NOT EXISTS properties (
  id               TEXT PRIMARY KEY,       -- stable id we mint (see normalize/ids.ts)
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  city             TEXT NOT NULL,
  country          TEXT NOT NULL,
  region           TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  price_per_night  REAL NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  rating           REAL,
  review_count     INTEGER,
  tags             TEXT NOT NULL DEFAULT '[]',      -- JSON array
  amenities        TEXT NOT NULL DEFAULT '[]',       -- JSON array
  image            TEXT NOT NULL DEFAULT '',
  gallery          TEXT NOT NULL DEFAULT '[]',       -- JSON array
  emoji            TEXT NOT NULL DEFAULT '🏠',
  content_hash     TEXT NOT NULL,
  first_scraped_at INTEGER NOT NULL,
  last_scraped_at  INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_region ON properties(region);

-- A property can legitimately appear on more than one platform — this is
-- what the in-app checkout browser reads from (buildCheckoutUrl() on the
-- frontend needs a REAL per-listing url here, not a search page).
CREATE TABLE IF NOT EXISTS property_sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id       TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,          -- 'Booking.com' | 'Airbnb' | 'Trip.com'
  source_listing_id TEXT NOT NULL,          -- the platform's own id, used for dedup + rebuilding the url
  url               TEXT NOT NULL,          -- the real listing page — required for the in-app browser
  price             REAL NOT NULL,
  cancellation      TEXT,
  last_seen_at      INTEGER NOT NULL,
  UNIQUE(platform, source_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_sources_property ON property_sources(property_id);

-- Caches an entire search's RESULT SET (a list of property ids) so an
-- identical query from a different subscriber doesn't re-trigger scraping
-- at all — this is the main lever that keeps proxy-bandwidth cost low
-- relative to subscription revenue (see the unit-economics discussion).
CREATE TABLE IF NOT EXISTS search_cache (
  query_hash   TEXT PRIMARY KEY,    -- hash of the normalized query+filters
  property_ids TEXT NOT NULL,        -- JSON array of property.id, in result order
  cached_at    INTEGER NOT NULL
);

-- Subscribers. Real password hashing (PBKDF2 via Web Crypto) — this is a
-- real backend, unlike the frontend's local-demo authStore.js fallback.
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  tier            TEXT NOT NULL DEFAULT 'tier5',  -- 'tier5' | 'tier7' | 'tier9' — see billing/tiers.ts
  searches_today  INTEGER NOT NULL DEFAULT 0,
  searches_reset_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

-- One row per scrape attempt, for observability/cost tracking — lets us
-- actually see the cache-hit-rate the unit economics depend on, instead
-- of assuming it.
CREATE TABLE IF NOT EXISTS scrape_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL,
  query        TEXT NOT NULL,
  outcome      TEXT NOT NULL,   -- 'ok' | 'blocked' | 'empty' | 'error'
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL
);
