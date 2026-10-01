/**
 * scrapers/booking/fetch.js — Booking.com URL building.
 */

/**
 * @param {import('../../types.js').SearchQuery} query
 * @returns {string}
 */
export function buildSearchUrl(query) {
  const params = new URLSearchParams({ ss: query.q || '' });
  if (query.maxPrice) {
    // Booking.com's own price-filter query param format changes over time —
    // VERIFY against a live search before relying on this filtering server-side.
    // Safe fallback: fetch unfiltered and filter maxPrice in normalize instead.
  }
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}
