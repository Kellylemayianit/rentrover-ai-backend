/**
 * types.js — JSDoc-only shape definitions, no runtime code. Documents the
 * exact contract the RentRover frontend's src/services/api.js expects
 * back from GET /api/search/combined — every scraper's job ends the
 * moment its raw output has been mapped into NormalizedProperty.
 *
 * Plain JS throughout this backend (no TypeScript build step) — these
 * @typedef blocks exist purely so editors can offer autocomplete/hints via
 * the `@param {import('../types.js').X}` references used elsewhere; they
 * have zero effect at runtime.
 */

/**
 * @typedef {'Booking.com' | 'Airbnb' | 'Trip.com'} Platform
 */

/**
 * @typedef {object} SourceListing
 * @property {Platform} platform
 * @property {string} sourceListingId - the platform's own id — used for dedup + rebuilding the url later
 * @property {string} url - REQUIRED: real per-listing page, not a search results page (in-app browser depends on this)
 * @property {number} price
 * @property {string} [cancellation]
 */

/**
 * @typedef {object} NormalizedProperty
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} city
 * @property {string} country
 * @property {string} region
 * @property {string} description
 * @property {number} pricePerNight
 * @property {string} currency
 * @property {number} [rating]
 * @property {number} [reviewCount]
 * @property {string[]} tags
 * @property {string[]} amenities
 * @property {string} image
 * @property {string[]} [gallery]
 * @property {string} [emoji]
 * @property {SourceListing[]} sources
 */

/**
 * @typedef {object} SearchQuery
 * @property {string} q
 * @property {string} [region]
 * @property {string} [type]
 * @property {number} [maxPrice]
 */

/**
 * @typedef {object} TriageResult
 * @property {boolean} isValidListingPage
 * @property {boolean} isBlockedOrCaptcha
 * @property {string} language
 * @property {number} confidence
 */

export {}; // marks this file as an ES module so the @typedef exports resolve via import()
