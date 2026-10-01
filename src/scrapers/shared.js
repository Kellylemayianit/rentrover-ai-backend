/**
 * scrapers/shared.js — extraction helpers common to every scraper module.
 *
 * JSON-LD (schema.org structured data, usually a <script type="application/
 * ld+json"> block) is the extraction-first choice here deliberately: it's
 * a standardized shape many travel/hotel sites embed for SEO, so parsing
 * it is far more stable across a site's redesigns than scraping CSS
 * classes. Each scraper tries this first and only falls back to
 * site-specific HTML parsing when a page has no usable JSON-LD.
 *
 * HONESTY NOTE: the HTML-regex fallbacks in each scraper's extract.js are
 * best-effort, written without live access to test against the real
 * sites right now. Treat every selector/regex in those fallback paths as
 * "needs verification against a live response" before relying on it —
 * these sites change markup often, and this code will need maintenance,
 * not a one-time fix. JSON-LD extraction is the more durable path; lean
 * on it where a site provides it.
 */

/**
 * Pulls every JSON-LD block out of an HTML string and parses it.
 * Never throws on malformed JSON — skips it and keeps going.
 * @param {string} html
 * @returns {object[]}
 */
export function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed['@graph']) blocks.push(...parsed['@graph']);
      else blocks.push(parsed);
    } catch {
      // malformed JSON-LD block — skip, don't fail the whole extraction over one bad block
    }
  }
  return blocks;
}

const LODGING_TYPES = new Set(['Hotel', 'LodgingBusiness', 'Resort', 'BedAndBreakfast', 'Motel', 'Apartment']);

/**
 * Filters parsed JSON-LD blocks down to schema.org lodging/hotel types.
 * @param {object[]} blocks
 */
export function filterLodgingSchema(blocks) {
  return blocks.filter(b => b && typeof b['@type'] === 'string' && LODGING_TYPES.has(b['@type']));
}

/**
 * schema.org's AggregateRating → our {rating, reviewCount} shape.
 * @param {object} block
 */
export function extractRating(block) {
  const agg = block.aggregateRating;
  if (!agg) return { rating: undefined, reviewCount: undefined };
  return {
    rating: agg.ratingValue ? Number(agg.ratingValue) : undefined,
    reviewCount: agg.reviewCount ? Number(agg.reviewCount) : undefined,
  };
}

/**
 * schema.org's PostalAddress → {city, country}. Falls back to a single
 * "unknown" bucket rather than throwing when a listing is missing address
 * data — better to surface an incomplete record than drop it silently.
 * @param {object} block
 */
export function extractAddress(block) {
  const addr = block.address;
  if (!addr) return { city: 'Unknown', country: 'Unknown' };
  if (typeof addr === 'string') return { city: addr, country: 'Unknown' };
  return {
    city: addr.addressLocality || 'Unknown',
    country: addr.addressCountry || 'Unknown',
  };
}

/**
 * schema.org's `offers` (single object or array) → the lowest numeric
 * price found, since search-result pages often list a "from" price.
 * @param {object} block
 */
export function extractPrice(block) {
  const offers = Array.isArray(block.offers) ? block.offers : block.offers ? [block.offers] : [];
  const prices = offers.map(o => Number(o.price)).filter(n => !Number.isNaN(n) && n > 0);
  if (!prices.length) return { price: 0, currency: 'USD' };
  return { price: Math.min(...prices), currency: offers[0]?.priceCurrency || 'USD' };
}

/** @param {string} html @returns {string} */
export function stripHtmlTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
