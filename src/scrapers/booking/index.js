/**
 * scrapers/booking/index.js — public entry point: search Booking.com,
 * extract, and hand back NormalizedProperty[] (one `sources` entry each —
 * normalize/dedupe.js merges across platforms later).
 *
 * Extraction success IS the validity check — a successful extraction
 * proves the page was fine, no separate classification step needed.
 * diagnoseEmptyResult() only runs on the failure path, to log WHY nothing
 * came back (see classify/triage.js).
 */

import { proxyFetch } from '../../proxy/fetch.js';
import { diagnoseEmptyResult } from '../../classify/triage.js';
import { buildSearchUrl } from './fetch.js';
import { extractListings } from './extract.js';
import { mintPropertyId } from '../../normalize/ids.js';
import { logScrape } from '../../store/d1.js';

const PLATFORM = 'Booking.com';

/**
 * @param {object} env
 * @param {import('../../types.js').SearchQuery} query
 * @returns {Promise<import('../../types.js').NormalizedProperty[]>}
 */
export async function searchBooking(env, query) {
  const started = Date.now();
  const url = buildSearchUrl(query);

  const res = await proxyFetch(env, url);
  if (!res.ok) {
    await logScrape(env, PLATFORM, query.q, 'error', Date.now() - started);
    return [];
  }

  const raw = extractListings(res.text);

  if (!raw.length) {
    const outcome = diagnoseEmptyResult(res);
    await logScrape(env, PLATFORM, query.q, outcome, Date.now() - started);
    return [];
  }

  await logScrape(env, PLATFORM, query.q, 'ok', Date.now() - started);

  return raw.map(item => ({
    id: mintPropertyId(item.name, item.city),
    name: item.name,
    type: 'Hotel',
    city: item.city,
    country: item.country,
    region: '', // filled in by normalize step using a city→region lookup — TODO once that table exists
    description: item.description,
    pricePerNight: item.price,
    currency: item.currency,
    rating: item.rating,
    reviewCount: item.reviewCount,
    tags: [],
    amenities: item.amenities,
    image: item.image,
    gallery: item.image ? [item.image] : [],
    emoji: '🏨',
    sources: [{
      platform: PLATFORM,
      sourceListingId: item.sourceListingId,
      url: item.url,
      price: item.price,
    }],
  }));
}
