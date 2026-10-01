/**
 * scrapers/tripcom/fetch.js — Trip.com URL building.
 */

/**
 * @param {import('../../types.js').SearchQuery} query
 * @returns {string}
 */
export function buildSearchUrl(query) {
  const params = new URLSearchParams({ city: query.q || '', locale: 'en-US', curr: 'USD' });
  return `https://www.trip.com/hotels/list?${params.toString()}`;
}
