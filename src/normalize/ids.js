/**
 * normalize/ids.js — id minting + content hashing.
 *
 * The property id is deliberately derived from name+city ALONE, not the
 * platform or the platform's own listing id. That's what lets two
 * scrapers that found "the same" property on different platforms collapse
 * into one D1 row with two entries in `sources` (see store/d1.js's
 * upsert) — merging is just "did we mint the same id", nothing fuzzier.
 *
 * Honest limitation: this is exact-match after normalization (lowercase,
 * strip punctuation), not real entity resolution. "The Grand Hotel" and
 * "Grand Hotel, The" won't merge. Good enough as a first pass; swap for
 * proper fuzzy/geo matching later if duplicate properties turn out to be
 * common in practice.
 */

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** @param {string} name @param {string} city @returns {string} */
export function mintPropertyId(name, city) {
  return `${slugify(name)}--${slugify(city)}`;
}

/** @param {string} input @returns {Promise<string>} */
export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash of everything EXCEPT id/sources/timestamps — what the validity-
 * check compares against a fresh scrape.
 * @param {{name:string, description:string, pricePerNight:number, rating?:number, amenities:string[], image:string}} p
 */
export async function contentHash(p) {
  return sha256Hex(JSON.stringify({
    name: p.name, description: p.description, pricePerNight: p.pricePerNight,
    rating: p.rating ?? null, amenities: [...p.amenities].sort(), image: p.image,
  }));
}

/**
 * Stable hash of a search query + filters, for search_cache's key.
 * @param {string} q @param {{region?:string, type?:string, maxPrice?:number}} filters
 */
export async function queryHash(q, filters) {
  const normalized = q.trim().toLowerCase();
  return sha256Hex(JSON.stringify({ q: normalized, ...filters }));
}
