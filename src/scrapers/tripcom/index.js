/**
 * scrapers/tripcom/index.js — public entry point: search Trip.com,
 * classify, extract, normalize. Same shape as scrapers/booking/index.js.
 */

import { proxyFetch } from '../../proxy/fetch.js';
import { classifyPage } from '../../classify/laya.js';
import { buildSearchUrl } from './fetch.js';
import { extractListings } from './extract.js';
import { mintPropertyId } from '../../normalize/ids.js';
import { logScrape } from '../../store/d1.js';

const PLATFORM = 'Trip.com';

/**
 * @param {object} env
 * @param {import('../../types.js').SearchQuery} query
 * @returns {Promise<import('../../types.js').NormalizedProperty[]>}
 */
export async function searchTripcom(env, query) {
  const started = Date.now();
  const url = buildSearchUrl(query);

  const res = await proxyFetch(env, url);
  if (!res.ok) {
    await logScrape(env, PLATFORM, query.q, 'error', Date.now() - started);
    return [];
  }

  const triage = await classifyPage(env, res.text);
  if (triage.isBlockedOrCaptcha) {
    await logScrape(env, PLATFORM, query.q, 'blocked', Date.now() - started);
    return [];
  }
  if (!triage.isValidListingPage) {
    await logScrape(env, PLATFORM, query.q, 'empty', Date.now() - started);
    return [];
  }

  const raw = extractListings(res.text);
  await logScrape(env, PLATFORM, query.q, raw.length ? 'ok' : 'empty', Date.now() - started);

  return raw.map(item => ({
    id: mintPropertyId(item.name, item.city),
    name: item.name,
    type: 'Hotel',
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
    emoji: '🏨',
    sources: [{
      platform: PLATFORM,
      sourceListingId: item.sourceListingId,
      url: item.url,
      price: item.price,
    }],
  }));
}
