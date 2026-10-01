/**
 * auth.js — signup/login backing POST /api/auth/signup and /api/auth/login,
 * which the frontend's authStore.js already calls (falling back to its own
 * local demo store when these don't exist — now they do).
 *
 * Real password hashing via Web Crypto's PBKDF2 (100,000 iterations,
 * random salt per user) — this is a real backend, unlike the frontend's
 * local-only demo fallback which explicitly documents itself as insecure.
 */

const PBKDF2_ITERATIONS = 100_000;

async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? _hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );

  return { hash: _bytesToHex(new Uint8Array(bits)), salt: _bytesToHex(salt) };
}

function _bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function _hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/**
 * @param {object} env @param {{name:string, email:string, password:string}} fields
 * @returns {Promise<{ok:boolean, error?:string, user?:{name:string,email:string}}>}
 */
export async function signUp(env, { name, email, password }) {
  if (!email || !password || password.length < 6) {
    return { ok: false, error: 'Email and a password of at least 6 characters are required.' };
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return { ok: false, error: 'An account with that email already exists.' };

  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, tier, searches_today, searches_reset_at, created_at)
     VALUES (?,?,?,?,?,?,0,?,?)`
  ).bind(id, email, name || '', hash, salt, 'tier5', now + 86_400_000, now).run();

  return { ok: true, user: { name: name || '', email } };
}

/**
 * @param {object} env @param {{email:string, password:string}} fields
 * @returns {Promise<{ok:boolean, error?:string, user?:{name:string,email:string}}>}
 */
export async function login(env, { email, password }) {
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!row) return { ok: false, error: 'No account matches that email and password.' };

  const { hash } = await hashPassword(password, row.password_salt);
  if (hash !== row.password_hash) {
    return { ok: false, error: 'No account matches that email and password.' };
  }

  return { ok: true, user: { name: row.name, email: row.email } };
}
