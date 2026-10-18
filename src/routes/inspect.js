/**
 * routes/inspect.js — GET /api/debug/inspect: shows the SHAPE of the big
 * JSON blobs a page embeds in <script> tags, so extractors can be written
 * against what is really there instead of guessed. Same X-Debug-Key gate
 * as /api/debug/raw; remove both before real production traffic.
 *
 * Params: platform, q,
 *   script=<id>|largest   which embedded JSON blob to inspect (default largest)
 *   at=<path>             return the value at a path like  a/b/*\/c  (* = first item)
 */

import { Hono } from 'hono';
import { proxyFetch } from '../proxy/fetch.js';
import { buildSearchUrl as buildBookingUrl } from '../scrapers/booking/fetch.js';
import { buildSearchUrl as buildTripcomUrl } from '../scrapers/tripcom/fetch.js';
import { fetchSearchPage as fetchAirbnbPage } from '../scrapers/airbnb/fetch.js';

const FETCHERS = {
  booking: (env, query) => proxyFetch(env, buildBookingUrl(query)),
  tripcom: (env, query) => proxyFetch(env, buildTripcomUrl(query)),
  airbnb: fetchAirbnbPage,
};

const MAX_NODES = 80000; // keeps CPU time low — Workers have tight CPU limits
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function findJsonScripts(text) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[2].trim();
    if (body[0] !== '{' && body[0] !== '[') continue;
    out.push({ id: m[1].match(/\bid=["']([^"']+)["']/)?.[1] || null, body });
  }
  return out;
}

function loadJson(text, which) {
  const scripts = findJsonScripts(text);
  const available = scripts
    .map(s => ({ id: s.id, length: s.body.length }))
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);

  if (which === 'largest') {
    const sorted = [...scripts].sort((a, b) => b.body.length - a.body.length).slice(0, 6);
    for (const s of sorted) {
      try { return { chosen: s, parsed: JSON.parse(s.body), available }; } catch { /* try next */ }
    }
    return { error: 'no embedded JSON script parsed', available };
  }

  const chosen = scripts.find(s => s.id === which);
  if (!chosen) return { error: `no JSON script with id "${which}"`, available };
  try {
    return { chosen, parsed: JSON.parse(chosen.body), available };
  } catch (e) {
    return { error: `JSON.parse failed: ${e.message}`, head: chosen.body.slice(0, 300), available };
  }
}

function describe(kind, path, count, sample, firstKey) {
  const flat = JSON.stringify(sample) || '';
  return {
    kind, path, count, firstKey,
    keys: Object.keys(sample).slice(0, 30),
    hasPrice: /price/i.test(flat),
    hasName: /"(name|title|headline)"\s*:/i.test(flat),
    _sample: flat,
  };
}

/** Finds arrays of objects and id->object maps — where listings usually live. */
function findCandidates(root) {
  const found = [];
  let visited = 0;

  function walk(node, path, depth) {
    if (visited++ > MAX_NODES || depth > 14) return;
    if (Array.isArray(node)) {
      const objs = node.filter(isObj);
      if (node.length >= 3 && objs.length >= node.length * 0.8) {
        found.push(describe('array', `${path}/*`, node.length, objs[0]));
      }
      node.slice(0, 3).forEach((child, i) => walk(child, `${path}/${i}`, depth + 1));
      return;
    }
    if (!isObj(node)) return;

    const entries = Object.entries(node);
    const objEntries = entries.filter(([, v]) => isObj(v));
    const homogeneous = entries.length >= 5 && objEntries.length >= entries.length * 0.8;
    if (homogeneous) found.push(describe('map', path || '/', entries.length, objEntries[0][1], objEntries[0][0]));

    // In a big id->object map, a few entries are enough to see the shape.
    const toWalk = homogeneous && entries.length > 20 ? entries.slice(0, 3) : entries;
    for (const [k, v] of toWalk) walk(v, `${path}/${k}`, depth + 1);
  }

  walk(root, '', 0);

  return found
    .map(f => ({ ...f, score: (f.hasPrice ? 1000 : 0) + (f.hasName ? 500 : 0) + Math.min(f.count, 200) + Math.min(f.keys.length, 40) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((c, i) => {
      const { _sample, score, ...rest } = c;
      return i < 2 ? { ...rest, sample: _sample.slice(0, 1800) } : rest;
    });
}

function valueAt(root, path) {
  let cur = root;
  for (const seg of path.split('/').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return { found: false, stoppedAt: seg };
    cur = cur[seg === '*' ? '0' : seg];
    if (cur === undefined) return { found: false, stoppedAt: seg };
  }
  return { found: true, value: cur };
}

export const inspectRoute = new Hono();

inspectRoute.get('/inspect', async (c) => {
  const key = c.req.header('x-debug-key');
  if (!c.env.DEBUG_KEY || key !== c.env.DEBUG_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const platform = c.req.query('platform');
  const fetchPage = FETCHERS[platform];
  if (!fetchPage) {
    return c.json({ error: `Unknown platform "${platform}". Use one of: ${Object.keys(FETCHERS).join(', ')}` }, 400);
  }

  let res;
  try {
    res = await fetchPage(c.env, { q: c.req.query('q') || '' });
  } catch (err) {
    return c.json({ error: 'fetch failed', detail: String(err?.message || err) }, 502);
  }

  const base = { status: res.status, pageLength: res.text.length };
  const loaded = loadJson(res.text, c.req.query('script') || 'largest');
  if (loaded.error) return c.json({ ...base, ...loaded });

  const root = loaded.parsed;
  const at = c.req.query('at');
  if (at) {
    const r = valueAt(root, at);
    const flat = r.found ? JSON.stringify(r.value) : '';
    const out = { ...base, script: loaded.chosen.id, at, found: r.found, stoppedAt: r.stoppedAt, length: flat.length };
    if (r.found) {
      if (flat.length <= 6000) out.value = r.value;
      else out.valueTruncated = flat.slice(0, 6000);
    }
    return c.json(out);
  }

  return c.json({
    ...base,
    script: loaded.chosen.id,
    scriptLength: loaded.chosen.body.length,
    rootType: Array.isArray(root) ? `array(${root.length})` : 'object',
    rootKeys: isObj(root) ? Object.keys(root).slice(0, 40) : undefined,
    candidates: findCandidates(root),
    otherScripts: loaded.available,
  });
});
