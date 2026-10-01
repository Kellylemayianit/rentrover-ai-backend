/**
 * routes/auth.js — POST /api/auth/signup and /api/auth/login. The
 * frontend's authStore.js already calls these exact paths and falls back
 * to its own local demo store on failure — these routes existing is what
 * makes that fallback stop being necessary.
 */

import { Hono } from 'hono';
import { signUp, login } from '../auth.js';

export const authRoute = new Hono();

authRoute.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await signUp(c.env, body);
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json(result.user);
});

authRoute.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await login(c.env, body);
  if (!result.ok) return c.json({ error: result.error }, 401);
  return c.json(result.user);
});
