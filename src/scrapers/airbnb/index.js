/**
 * scrapers/airbnb/index.js — public entry point for Airbnb. Same shape as
 * the other two scrapers, but see extract.js's header before trusting
 * this — orchestrator.js gates this behind ENABLE_AIRBNB, off by default.
 */

import { proxyFetch } from '../../proxy/fetch.js';
import { diagnoseEmptyResult } from '../../classify/triage.js';
import { buildSearchUrl } from './fetch.js';
import { extractListings } from './extract.js';
import { mintPropertyId } from '../../normalize/ids.js';
import { logScrape } from '../../store/d1.js';

const PLATFORM = 'Airbnb';

/**
 * @param {object} env
 * @param {import('../../types.js').SearchQuery} query
 * @returns {Promise<import('../../types.js').NormalizedProperty[]>}
 */
export async function searchAirbnb(env, query) {
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
    type: 'Apartment',
    city: item.city,
    country: item.country,
    region: '',
    description: item.description,
    pricePerNight: item.price,
    currency: item.currency,
    rating: item.rating,
    reviewCount: item.reviewCount,
    tags: [],
    amenities: item.amenities,
    image: item.image,
    gallery: item.image ? [item.image] : [],
    emoji: '🏠',
    sources: [{
      platform: PLATFORM,
      sourceListingId: item.sourceListingId,
      url: item.url,
      price: item.price,
    }],
  }));
}
