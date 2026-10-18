/**
 * scrapers/airbnb/fetch.js — Airbnb URL building + fetching.
 */

import { proxyFetch } from '../../proxy/fetch.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAX_BYTES = 2_000_000;

/** @param {{q?:string}} query */
export function buildSearchUrl(query) {
  return `https://www.airbnb.com/s/${encodeURIComponent(query.q || '')}/homes`;
}

const HANDOFF_ACTION_RE = /<form[^>]+action="(https:\/\/[^"]+\/v2\/domain_switch\/handoff)"/;
const HANDOFF_PAYLOAD_RE = /name="payload"\s+value="([^"]+)"/;
const HANDOFF_VERSION_RE = /name="version"\s+value="([^"]+)"/;

/**
 * Airbnb answers requests from the "wrong" region with a tiny page whose
 * onload script auto-submits a form to .../v2/domain_switch/handoff.
 * fetch() can't run that script, so we replay the POST ourselves, keep
 * the cookies it sets, then follow its redirect with those cookies.
 * Returns the usual {ok,status,text,finalUrl} plus `trace`, a step-by-step
 * record of what happened, so a failure shows exactly which hop broke.
 */
export async function fetchSearchPage(env, query) {
  const first = await proxyFetch(env, buildSearchUrl(query));
  const trace = [{ step: 'initial', status: first.status, finalUrl: first.finalUrl, length: first.text.length }];

  const actionMatch = first.text.match(HANDOFF_ACTION_RE);
  if (!actionMatch) return { ...first, trace };

  const payload = first.text.match(HANDOFF_PAYLOAD_RE)?.[1];
  const version = first.text.match(HANDOFF_VERSION_RE)?.[1] || '1';
  if (!payload) {
    trace.push({ step: 'handoff-parse-failed' });
    return { ...first, trace };
  }

  const actionUrl = actionMatch[1];
  let post;
  try {
    post = await fetch(actionUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: new URLSearchParams({ version, payload }).toString(),
    });
  } catch (err) {
    trace.push({ step: 'handoff-post-failed', error: String(err?.message || err) });
    return { ...first, trace };
  }

  const location = post.headers.get('location');
  const setCookies = post.headers.getSetCookie ? post.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  trace.push({ step: 'handoff-post', status: post.status, location, cookiesSet: setCookies.length });

  if (location) {
    const target = new URL(location, actionUrl).toString();
    const final = await proxyFetch(env, target, cookieHeader ? { headers: { Cookie: cookieHeader } } : {});
    trace.push({ step: 'followed-redirect', status: final.status, finalUrl: final.finalUrl, length: final.text.length });
    return { ...final, trace };
  }

  const text = (await post.text()).slice(0, MAX_BYTES);
  trace.push({ step: 'handoff-body', length: text.length });
  return { ok: post.ok, status: post.status, text, finalUrl: actionUrl, trace };
}
