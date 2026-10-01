/**
 * scrapers/booking/extract.js — turns a Booking.com search-results HTML
 * page into raw listing objects (pre-normalization).
 *
 * Strategy 1 (preferred): JSON-LD Hotel/LodgingBusiness blocks — standard
 * schema.org markup, stable across redesigns.
 * Strategy 2 (fallback): regex over the search-result card markup.
 * MARKED CLEARLY: this fallback's patterns are best-effort, unverified
 * against a live page from here, and WILL need adjustment once tested —
 * Booking.com's card markup is not a stable public contract the way
 * JSON-LD is.
 */

import { extractJsonLd, filterLodgingSchema, extractRating, extractAddress, extractPrice } from '../shared.js';

/**
 * @param {string} html
 * @returns {Array<{name:string, url:string, sourceListingId:string, city:string, country:string, price:number, currency:string, rating?:number, reviewCount?:number, description:string, image:string, amenities:string[]}>}
 */
export function extractListings(html) {
  const jsonLdResults = _extractFromJsonLd(html);
  if (jsonLdResults.length) return jsonLdResults;
  return _extractFromHtmlFallback(html);
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
      sourceListingId: _idFromUrl(url) || block.name,
      city, country, price, currency, rating, reviewCount,
      description: block.description || '',
      image: Array.isArray(block.image) ? block.image[0] : (block.image || ''),
      amenities: Array.isArray(block.amenityFeature)
        ? block.amenityFeature.map(a => a.name).filter(Boolean)
        : [],
    };
  }).filter(l => l.price > 0);
}

/**
 * VERIFY AGAINST A LIVE PAGE — these patterns are a starting point, not a
 * tested implementation. Booking.com search cards are typically React-
 * rendered with data-testid attributes; the ones below are the most
 * commonly reported as of this writing and are the first thing to check
 * if this returns nothing.
 */
function _extractFromHtmlFallback(html) {
  const results = [];
  const cardRe = /data-testid="property-card"[\s\S]*?(?=data-testid="property-card"|<\/main>)/g;
  const nameRe = /data-testid="title"[^>]*>([^<]+)</;
  const priceRe = /data-testid="price-and-discounted-price"[^>]*>[^\d]*([\d,.]+)/;
  const linkRe = /href="(https:\/\/www\.booking\.com\/hotel\/[^"?]+)/;

  let match;
  while ((match = cardRe.exec(html)) !== null) {
    const card = match[0];
    const name = card.match(nameRe)?.[1]?.trim();
    const priceStr = card.match(priceRe)?.[1]?.replace(/,/g, '');
    const url = card.match(linkRe)?.[1];
    if (!name || !priceStr || !url) continue;

    results.push({
      name, url, sourceListingId: _idFromUrl(url) || name,
      city: 'Unknown', country: 'Unknown', // HTML fallback doesn't reliably carry city/country per-card — confirm on a live page
      price: Number(priceStr), currency: 'USD',
      rating: undefined, reviewCount: undefined,
      description: '', image: '', amenities: [],
    });
  }
  return results;
}

function _idFromUrl(url) {
  const match = url.match(/\/hotel\/[a-z]{2}\/([a-z0-9-]+)\.html/i);
  return match ? match[1] : null;
}
