/**
 * scrapers/tripcom/extract.js — turns a Trip.com hotel-list HTML page
 * into raw listing objects.
 *
 * Trip.com's search results are heavily client-rendered (the initial HTML
 * response is often a shell with data hydrated via an embedded JSON blob
 * in a <script> tag rather than schema.org JSON-LD or server-rendered
 * cards). Strategy here: look for that embedded state blob first (common
 * pattern: `window.IBU_HOTEL` or similar global assignment), fall back to
 * schema.org JSON-LD if present, then a last-resort HTML regex.
 *
 * MARKED CLEARLY: the embedded-state variable name below is a best guess
 * based on how Trip.com/Ctrip properties have historically exposed
 * hydration data — VERIFY against a live response, this is the single
 * most likely thing to have changed.
 */

import { extractJsonLd, filterLodgingSchema, extractRating, extractAddress, extractPrice } from '../shared.js';

/** @param {string} html */
export function extractListings(html) {
  const fromState = _extractFromEmbeddedState(html);
  if (fromState.length) return fromState;

  const fromJsonLd = _extractFromJsonLd(html);
  if (fromJsonLd.length) return fromJsonLd;

  return []; // no HTML-regex fallback for Trip.com yet — its markup is the least predictable of the three; add one once a live sample is available to write it against
}

function _extractFromEmbeddedState(html) {
  // VERIFY: look for something like `window.IBU_HOTEL = {...};` — adjust
  // the variable name once checked against a live page.
  const match = html.match(/window\.IBU_HOTEL\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return [];

  let state;
  try { state = JSON.parse(match[1]); } catch { return []; }

  const list = state?.hotelList || state?.searchResult?.hotelList || [];
  if (!Array.isArray(list)) return [];

  return list.map(hotel => ({
    name: hotel.hotelName || hotel.name || 'Unnamed property',
    url: hotel.url || (hotel.hotelId ? `https://www.trip.com/hotels/detail/?hotelId=${hotel.hotelId}` : ''),
    sourceListingId: String(hotel.hotelId || hotel.id || hotel.hotelName),
    city: hotel.cityName || 'Unknown',
    country: hotel.countryName || 'Unknown',
    price: Number(hotel.price || hotel.minPrice || 0),
    currency: hotel.currency || 'USD',
    rating: hotel.starRating ? Number(hotel.starRating) : undefined,
    reviewCount: hotel.commentCount ? Number(hotel.commentCount) : undefined,
    description: hotel.description || '',
    image: hotel.imageUrl || hotel.image || '',
    amenities: Array.isArray(hotel.facilities) ? hotel.facilities : [],
  })).filter(l => l.price > 0 && l.url);
}

function _extractFromJsonLd(html) {
  const blocks = filterLodgingSchema(extractJsonLd(html));
  return blocks.map(block => {
    const { city, country } = extractAddress(block);
    const { rating, reviewCount } = extractRating(block);
    const { price, currency } = extractPrice(block);
    const url = block.url || block['@id'] || '';
    return {
      name: block.name || 'Unnamed property',
      url,
      sourceListingId: url || block.name,
      city, country, price, currency, rating, reviewCount,
      description: block.description || '',
      image: Array.isArray(block.image) ? block.image[0] : (block.image || ''),
      amenities: [],
    };
  }).filter(l => l.price > 0);
}
