/**
 * index.js — Cloudflare Worker entry point. CORS, health check, route
 * mounting. Kept deliberately thin — see routes/ for actual logic.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { searchRoute } from './routes/search.js';
import { authRoute } from './routes/auth.js';

const app = new Hono();

// The frontend calls this backend from a different origin (see its own
// README: "the backend must allow requests from wherever this frontend is
// served"). Tighten `origin` to the real deployed frontend domain before
// this goes further than local development.
app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'X-User-Email'] }));

app.get('/health', (c) => c.json({
  status: 'healthy',
  service: 'rentrover-backend',
  endpoints: ['/api/search/combined', '/api/auth/signup', '/api/auth/login'],
}));

app.route('/api/search', searchRoute);
app.route('/api/auth', authRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
