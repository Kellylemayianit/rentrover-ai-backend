/**
 * orchestrator.js — the one function routes/search.js calls. Ties the
 * whole pipeline together: cache check → scrape (parallel, per enabled
 * platform) → merge across platforms → store → cache → return.
 */

import { searchBooking } from './scrapers/booking/index.js';
import { searchTripcom } from './scrapers/tripcom/index.js';
import { searchAirbnb } from './scrapers/airbnb/index.js';
import { mergeAcrossPlatforms } from './normalize/dedupe.js';
import { getCachedSearch, setCachedSearch, upsertProperty, getPropertiesByIds } from './store/d1.js';

// Airbnb's extractor is an unverified sketch (see scrapers/airbnb/extract.js's
// header) — off by default so it doesn't burn proxy bandwidth on requests
// that can't succeed yet. Flip once that module has been rewritten against
// a real captured response.
const ENABLE_AIRBNB = false;

/**
 * @param {object} env
 * @param {import('./types.js').SearchQuery} query
 * @returns {Promise<import('./types.js').NormalizedProperty[]>}
 */
export async function runSearch(env, query) {
  const filters = { region: query.region, type: query.type, maxPrice: query.maxPrice };

  const cachedIds = await getCachedSearch(env, query.q, filters);
  if (cachedIds) {
    return getPropertiesByIds(env, cachedIds);
  }

  const scraperCalls = [searchBooking(env, query), searchTripcom(env, query)];
  if (ENABLE_AIRBNB) scraperCalls.push(searchAirbnb(env, query));

  const results = await Promise.allSettled(scraperCalls);
  const listings = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => /** @type {any} */ (r).value);

  const merged = mergeAcrossPlatforms(listings);
  const filtered = _applyFilters(merged, filters);

  // Store — each property individually validity-checked against what's
  // already there (see store/d1.js's upsertProperty).
  for (const property of filtered) {
    await upsertProperty(env, property);
  }

  const ids = filtered.map(p => p.id);
  await setCachedSearch(env, query.q, filters, ids);

  return filtered;
}

function _applyFilters(properties, filters) {
  return properties.filter(p => {
    if (filters.region && p.region && p.region.toLowerCase() !== filters.region.toLowerCase()) return false;
    if (filters.type && p.type.toLowerCase() !== filters.type.toLowerCase()) return false;
    if (filters.maxPrice && p.pricePerNight > filters.maxPrice) return false;
    return true;
  });
}
