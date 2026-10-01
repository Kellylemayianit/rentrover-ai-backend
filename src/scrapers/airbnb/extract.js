/**
 * scrapers/airbnb/extract.js — turns an Airbnb search HTML page into raw
 * listing objects.
 *
 * ⚠️ HIGHEST-RISK MODULE IN THIS BACKEND — read before touching.
 *
 * Airbnb has no schema.org JSON-LD on search results and no affiliate/
 * partner data API (confirmed in the earlier planning discussion). Its
 * search page is a client-rendered SPA that hydrates from a large JSON
 * blob embedded in a <script> tag — historically under an id like
 * `data-deferred-state-0`, with listings nested many levels deep (keys
 * have included things like `niobeMinimalClientData`). That exact shape
 * is NOT verified here — I have no live access to confirm it as of this
 * writing — and Airbnb changes this more aggressively than Booking.com or
 * Trip.com change theirs, specifically because scraping is a bigger
 * competitive concern for them.
 *
 * Practical consequence: treat this module as a sketch to iterate against
 * real captured responses, not working code. `scrapers/index? ` — see
 * orchestrator.js's ENABLE_AIRBNB flag — is OFF by default so a broken
 * extractor here doesn't burn proxy bandwidth on requests that can never
 * succeed until this has been rewritten against a real page.
 */

/** @param {string} html */
export function extractListings(html) {
  const state = _extractDeferredState(html);
  if (!state) return [];

  // VERIFY: this path into the blob is a best guess, not a confirmed
  // structure — inspect a real captured response and correct this before
  // trusting any output from this function.
  const listings = _digForListings(state);

  return listings.map(item => ({
    name: item.name || item.title || 'Unnamed property',
    url: item.url || (item.id ? `https://www.airbnb.com/rooms/${item.id}` : ''),
    sourceListingId: String(item.id || item.name),
    city: item.city || 'Unknown',
    country: item.country || 'Unknown',
    price: Number(item.price || item.pricing?.rate?.amount || 0),
    currency: item.currency || item.pricing?.rate?.currency || 'USD',
    rating: item.rating ? Number(item.rating) : undefined,
    reviewCount: item.reviewCount ? Number(item.reviewCount) : undefined,
    description: item.description || '',
    image: item.image || item.pictureUrl || '',
    amenities: Array.isArray(item.amenities) ? item.amenities : [],
  })).filter(l => l.price > 0 && l.url);
}

function _extractDeferredState(html) {
  const match = html.match(/<script[^>]+id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

/**
 * Walks the deferred-state object looking for anything that looks like a
 * listings array. Deliberately loose (duck-typed on "has an id and a
 * price-shaped field") because the exact key path is unverified — this
 * will over- or under-match until someone corrects it against a real
 * response.
 */
function _digForListings(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    const looksLikeListings = obj.length > 0 && obj.every(x => x && typeof x === 'object' && ('id' in x));
    if (looksLikeListings) return obj;
    return obj.flatMap(x => _digForListings(x, depth + 1));
  }
  return Object.values(obj).flatMap(v => _digForListings(v, depth + 1));
}
