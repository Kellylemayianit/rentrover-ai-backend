/**
 * scrapers/airbnb/fetch.js — Airbnb URL building.
 */

/**
 * @param {import('../../types.js').SearchQuery} query
 * @returns {string}
 */
export function buildSearchUrl(query) {
  return `https://www.airbnb.com/s/${encodeURIComponent(query.q || '')}/homes`;
}
