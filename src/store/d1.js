/**
 * store/d1.js — every D1 read/write in the backend goes through here.
 * Two caching layers live in this file, both central to the unit
 * economics discussed while planning this:
 *
 *   1. search_cache — an identical query served twice within the TTL
 *      window never re-scrapes at all. This is the main lever.
 *   2. properties.content_hash — even on a cache MISS for the search
 *      itself, a property whose fresh scrape matches its stored hash
 *      only gets `last_verified_at` bumped, not rewritten — cheap.
 */

import { contentHash, queryHash } from '../normalize/ids.js';

// ── Search cache ─────────────────────────────────────────────

/**
 * @param {object} env
 * @param {string} q
 * @param {{region?:string, type?:string, maxPrice?:number}} filters
 * @returns {Promise<string[]|null>} cached property ids, or null on a miss
 */
export async function getCachedSearch(env, q, filters) {
  const hash = await queryHash(q, filters);
  const ttlMs = Number(env.SEARCH_CACHE_TTL_MINUTES || '15') * 60_000;

  const row = await env.DB.prepare('SELECT property_ids, cached_at FROM search_cache WHERE query_hash = ?')
    .bind(hash).first();
  if (!row) return null;
  if (Date.now() - row.cached_at > ttlMs) return null; // stale — treat as a miss

  try { return JSON.parse(row.property_ids); } catch { return null; }
}

/**
 * @param {object} env @param {string} q
 * @param {{region?:string, type?:string, maxPrice?:number}} filters
 * @param {string[]} propertyIds
 */
export async function setCachedSearch(env, q, filters, propertyIds) {
  const hash = await queryHash(q, filters);
  await env.DB.prepare(
    `INSERT INTO search_cache (query_hash, property_ids, cached_at) VALUES (?, ?, ?)
     ON CONFLICT(query_hash) DO UPDATE SET property_ids = excluded.property_ids, cached_at = excluded.cached_at`
  ).bind(hash, JSON.stringify(propertyIds), Date.now()).run();
}

// ── Properties ───────────────────────────────────────────────

/**
 * Insert a new property, or — if it already exists and nothing about it
 * actually changed — just bump last_verified_at instead of a full write.
 * Always upserts the property_sources row for whichever platform this
 * scrape came from.
 * @param {object} env
 * @param {import('../types.js').NormalizedProperty} property
 */
export async function upsertProperty(env, property) {
  const now = Date.now();
  const hash = await contentHash(property);

  const existing = await env.DB.prepare('SELECT content_hash FROM properties WHERE id = ?')
    .bind(property.id).first();

  if (existing && existing.content_hash === hash) {
    await env.DB.prepare('UPDATE properties SET last_verified_at = ? WHERE id = ?')
      .bind(now, property.id).run();
  } else if (existing) {
    await env.DB.prepare(`
      UPDATE properties SET
        name=?, type=?, city=?, country=?, region=?, description=?, price_per_night=?,
        currency=?, rating=?, review_count=?, tags=?, amenities=?, image=?, gallery=?, emoji=?,
        content_hash=?, last_scraped_at=?, last_verified_at=?
      WHERE id=?
    `).bind(
      property.name, property.type, property.city, property.country, property.region, property.description,
      property.pricePerNight, property.currency, property.rating ?? null, property.reviewCount ?? null,
      JSON.stringify(property.tags), JSON.stringify(property.amenities), property.image,
      JSON.stringify(property.gallery || []), property.emoji || '🏠',
      hash, now, now, property.id
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO properties (id, name, type, city, country, region, description, price_per_night,
        currency, rating, review_count, tags, amenities, image, gallery, emoji, content_hash,
        first_scraped_at, last_scraped_at, last_verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      property.id, property.name, property.type, property.city, property.country, property.region,
      property.description, property.pricePerNight, property.currency, property.rating ?? null,
      property.reviewCount ?? null, JSON.stringify(property.tags), JSON.stringify(property.amenities),
      property.image, JSON.stringify(property.gallery || []), property.emoji || '🏠', hash, now, now, now
    ).run();
  }

  for (const src of property.sources) {
    await env.DB.prepare(`
      INSERT INTO property_sources (property_id, platform, source_listing_id, url, price, cancellation, last_seen_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(platform, source_listing_id) DO UPDATE SET
        url = excluded.url, price = excluded.price, cancellation = excluded.cancellation, last_seen_at = excluded.last_seen_at
    `).bind(property.id, src.platform, src.sourceListingId, src.url, src.price, src.cancellation || null, now).run();
  }
}

/**
 * @param {object} env @param {string[]} ids
 * @returns {Promise<import('../types.js').NormalizedProperty[]>}
 */
export async function getPropertiesByIds(env, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results: properties } = await env.DB.prepare(
    `SELECT * FROM properties WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  const { results: sources } = await env.DB.prepare(
    `SELECT * FROM property_sources WHERE property_id IN (${placeholders})`
  ).bind(...ids).all();

  const sourcesByProperty = new Map();
  for (const s of sources) {
    if (!sourcesByProperty.has(s.property_id)) sourcesByProperty.set(s.property_id, []);
    sourcesByProperty.get(s.property_id).push({
      platform: s.platform, sourceListingId: s.source_listing_id, url: s.url,
      price: s.price, cancellation: s.cancellation || undefined,
    });
  }

  // Preserve the original id order (it's the ranked search-result order).
  const byId = new Map(properties.map(p => [p.id, p]));
  return ids.map(id => byId.get(id)).filter(Boolean).map(p => ({
    id: p.id, name: p.name, type: p.type, city: p.city, country: p.country, region: p.region,
    description: p.description, pricePerNight: p.price_per_night, currency: p.currency,
    rating: p.rating ?? undefined, reviewCount: p.review_count ?? undefined,
    tags: JSON.parse(p.tags || '[]'), amenities: JSON.parse(p.amenities || '[]'),
    image: p.image, gallery: JSON.parse(p.gallery || '[]'), emoji: p.emoji,
    sources: sourcesByProperty.get(p.id) || [],
  }));
}

/** Properties whose last_verified_at is within the TTL — used to skip re-scraping entirely when possible. */
export async function getFreshPropertiesForQuery(env, propertyIds) {
  const ttlMs = Number(env.PROPERTY_TTL_MINUTES || '180') * 60_000;
  const cutoff = Date.now() - ttlMs;
  if (!propertyIds.length) return [];
  const placeholders = propertyIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id FROM properties WHERE id IN (${placeholders}) AND last_verified_at > ?`
  ).bind(...propertyIds, cutoff).all();
  return results.map(r => r.id);
}

// ── Observability ────────────────────────────────────────────

/** @param {object} env @param {string} platform @param {string} query @param {'ok'|'blocked'|'empty'|'error'} outcome @param {number} durationMs */
export async function logScrape(env, platform, query, outcome, durationMs) {
  await env.DB.prepare(
    'INSERT INTO scrape_log (platform, query, outcome, duration_ms, created_at) VALUES (?,?,?,?,?)'
  ).bind(platform, query, outcome, durationMs, Date.now()).run();
}
