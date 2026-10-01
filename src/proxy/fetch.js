/**
 * proxy/fetch.js — the one function every scraper calls to make an HTTP
 * request. Routes through a mobile proxy when real credentials exist,
 * goes direct in mock mode, retries on transient failure, and always
 * returns text (never a Response object) — same "cap response size,
 * don't pay for bytes you don't need" discipline as the template this is
 * based on.
 */

import { getProxyCredentials } from './credentials.js';

const MAX_RESPONSE_BYTES = 2_000_000; // ~2MB cap — see the per-request cost table in the planning notes
const MAX_RETRIES = 2;

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
];

/**
 * @param {object} env
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<{ok:boolean, status:number, text:string, finalUrl:string}>}
 */
export async function proxyFetch(env, url, init = {}) {
  const creds = await getProxyCredentials(env);
  const userAgent = MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // NOTE: Cloudflare Workers' fetch() has no native "route through this
      // HTTP proxy" option the way Node's http.Agent does — a real 'real'
      // mode needs either (a) Proxies.sx's proxy exposed as a CONNECT/SOCKS
      // endpoint reachable via a Worker-compatible client, or (b) routing
      // through a small relay service that accepts host/port/user/pass and
      // forwards the request. `creds` is fetched above and currently
      // unused for exactly that reason — left as a TODO alongside
      // credentials.js's x402 flow; both land at the same time, once
      // there's a wallet.
      const res = await fetch(url, {
        ...init,
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          ...(init.headers || {}),
        },
      });

      const text = await _readCapped(res, MAX_RESPONSE_BYTES);
      return { ok: res.ok, status: res.status, text, finalUrl: res.url || url };
    } catch (err) {
      await _wait(300 * (attempt + 1));
    }
  }

  return { ok: false, status: 0, text: '', finalUrl: url };
}

async function _readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { reader.cancel(); break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(_concat(chunks));
}

function _concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function _wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
