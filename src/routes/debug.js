/**
 * routes/debug.js — GET /api/debug/raw: fetch a platform's search page and
 * report what's actually in it. Gated by X-Debug-Key (env.DEBUG_KEY); it
 * exposes raw site content, so remove it before real production traffic.
 *
 * Params: platform=booking|tripcom|airbnb, q=<query>,
 *   find=<text>        -> up to 6 snippets of context around that text
 *   slice=<start>,<n>  -> raw slice of the page (n capped at 6000)
 */

import { Hono } from 'hono';
import { proxyFetch } from '../proxy/fetch.js';
import { diagnoseEmptyResult } from '../classify/triage.js';
import { extractJsonLd, filterLodgingSchema } from '../scrapers/shared.js';
import { buildSearchUrl as buildBookingUrl } from '../scrapers/booking/fetch.js';
import { buildSearchUrl as buildTripcomUrl } from '../scrapers/tripcom/fetch.js';
import { buildSearchUrl as buildAirbnbUrl, fetchSearchPage as fetchAirbnbPage } from '../scrapers/airbnb/fetch.js';
import { extractListings as extractBooking } from '../scrapers/booking/extract.js';
import { extractListings as extractTripcom } from '../scrapers/tripcom/extract.js';
import { extractListings as extractAirbnb } from '../scrapers/airbnb/extract.js';

const BUILDERS = { booking: buildBookingUrl, tripcom: buildTripcomUrl, airbnb: buildAirbnbUrl };
const FETCHERS = {
  booking: (env, query) => proxyFetch(env, buildBookingUrl(query)),
  tripcom: (env, query) => proxyFetch(env, buildTripcomUrl(query)),
  airbnb: fetchAirbnbPage,
};
const EXTRACTORS = { booking: extractBooking, tripcom: extractTripcom, airbnb: extractAirbnb };

const KEYWORDS = [
  'hotelName', 'hotelId', 'hotelList', '"price"', 'minPrice', 'priceInfo',
  '__NEXT_DATA__', '__INITIAL_STATE__', 'initialState',
  'application/ld+json', 'data-testid="property-card"',
];

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

/** A map of where the data could be hiding: scripts, window globals, keyword counts. */
function anatomy(text, q) {
  const scripts = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(text)) !== null) {
    const attrs = m[1];
    scripts.push({
      id: attrs.match(/\bid=["']([^"']+)["']/)?.[1] || null,
      type: attrs.match(/\btype=["']([^"']+)["']/)?.[1] || null,
      src: (attrs.match(/\bsrc=["']([^"']+)["']/)?.[1] || '').slice(0, 100) || null,
      inlineLength: m[2].length,
    });
  }

  const globals = new Set();
  const globalRe = /\bwindow(?:\.([A-Za-z_$][\w$]*)|\[["']([^"']+)["']\])\s*=(?!=)/g;
  while ((m = globalRe.exec(text)) !== null) globals.add(m[1] || m[2]);

  const keywordHits = {};
  for (const kw of KEYWORDS) {
    const n = countOccurrences(text, kw);
    if (n) keywordHits[kw] = n;
  }
  if (q) keywordHits[`query "${q}" (any case)`] = countOccurrences(text.toLowerCase(), q.toLowerCase());

  return {
    scriptCount: scripts.length,
    externalScriptCount: scripts.filter(s => s.src).length,
    largestInlineScripts: scripts
      .filter(s => s.inlineLength > 0)
      .sort((a, b) => b.inlineLength - a.inlineLength)
      .slice(0, 10),
    windowGlobals: Array.from(globals).slice(0, 40),
    keywordHits,
  };
}

export const debugRoute = new Hono();

debugRoute.get('/raw', async (c) => {
  const key = c.req.header('x-debug-key');
  if (!c.env.DEBUG_KEY || key !== c.env.DEBUG_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const platform = c.req.query('platform');
  const q = c.req.query('q') || '';
  const find = c.req.query('find');
  const sliceParam = c.req.query('slice');

  const buildUrl = BUILDERS[platform];
  if (!buildUrl) {
    return c.json({ error: `Unknown platform "${platform}". Use one of: ${Object.keys(BUILDERS).join(', ')}` }, 400);
  }

  const query = { q };
  let res;
  try {
    res = await FETCHERS[platform](c.env, query);
  } catch (err) {
    return c.json({ error: 'fetch failed', detail: String(err?.message || err) }, 502);
  }

  const jsonLdBlocks = extractJsonLd(res.text);
  const lodgingBlocks = filterLodgingSchema(jsonLdBlocks);

  let extracted = [];
  let extractError = null;
  try { extracted = EXTRACTORS[platform](res.text); } catch (err) { extractError = String(err?.message || err); }

  const body = {
    requestedUrl: buildUrl(query),
    finalUrl: res.finalUrl,
    status: res.status,
    ok: res.ok,
    textLength: res.text.length,
    trace: res.trace,
    jsonLdBlockCount: jsonLdBlocks.length,
    lodgingBlockCount: lodgingBlocks.length,
    lodgingBlockTypes: jsonLdBlocks.map(b => b['@type']).filter(Boolean),
    extractedCount: extracted.length,
    extractError,
    triageIfEmpty: extracted.length ? null : diagnoseEmptyResult(res),
    ...anatomy(res.text, q),
    sample: res.text.slice(0, 1500),
  };

  if (find) {
    const matches = [];
    let from = 0;
    while (matches.length < 6) {
      const i = res.text.indexOf(find, from);
      if (i === -1) break;
      matches.push({ at: i, context: res.text.slice(Math.max(0, i - 200), i + find.length + 400) });
      from = i + Math.max(find.length, 1500);
    }
    body.matches = matches;
  }

  if (sliceParam) {
    const [start, len] = sliceParam.split(',').map(Number);
    body.slice = res.text.slice(start || 0, (start || 0) + Math.min(len || 2000, 6000));
  }

  return c.json(body);
});
