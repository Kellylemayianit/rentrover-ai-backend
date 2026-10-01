/**
 * routes/search.js — GET /api/search/combined, the one endpoint the
 * RentRover frontend actually calls (src/services/api.js). Returns a
 * plain JSON array of NormalizedProperty — no wrapper object — because
 * that's exactly what the frontend's `.json()` call expects to iterate.
 */

import { Hono } from 'hono';
import { runSearch } from '../orchestrator.js';
import { checkAndConsumeSearchQuota } from '../tiers.js';

export const searchRoute = new Hono();

searchRoute.get('/combined', async (c) => {
  const q = c.req.query('q') || '';
  const region = c.req.query('region') || undefined;
  const type = c.req.query('type') || undefined;
  const maxPriceRaw = c.req.query('maxPrice');
  const maxPrice = maxPriceRaw ? Number(maxPriceRaw) : undefined;

  // Optional for now — see tiers.js's note on this being a stand-in for
  // real session auth, not a trustworthy identity check yet.
  const email = c.req.header('x-user-email') || null;
  const quota = await checkAndConsumeSearchQuota(c.env, email);
  if (!quota.ok) {
    return c.json({ error: 'Daily search limit reached for your plan.' }, 429);
  }

  try {
    const properties = await runSearch(c.env, { q, region, type, maxPrice });
    return c.json(properties);
  } catch (err) {
    return c.json({ error: 'Search failed.', detail: String(err?.message || err) }, 500);
  }
});
