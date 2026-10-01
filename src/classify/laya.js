/**
 * classify/laya.js — runs every scraped response through Laya (322M–421M,
 * ModernBERT/mmBERT + decision head) before any extraction is attempted:
 * is this actually a listing page, or a CAPTCHA/block page/redirect?
 * What language? This is the step that stops a bad scrape from wasting
 * time on extraction logic that has nothing real to parse.
 *
 * Laya is CPU-friendly and hosted as its own small inference service
 * (env.LAYA_ENDPOINT) — NOT run inside this Worker. Until that service is
 * deployed, `_heuristicFallback` stands in: cheap regex/keyword checks for
 * the obvious cases (CAPTCHA pages, "access denied", empty bodies). It
 * will false-negative on subtler blocks a real classifier would catch —
 * that gap is exactly why Laya exists, this is not a substitute for it,
 * just enough to keep the pipeline runnable before it's deployed.
 *
 * @typedef {{isValidListingPage:boolean, isBlockedOrCaptcha:boolean, language:string, confidence:number}} TriageResult
 */

const BLOCK_SIGNALS = [
  'captcha', 'unusual traffic', 'access denied', 'are you a robot',
  'verify you are human', 'blocked', 'rate limit exceeded', 'cf-error',
];

/**
 * @param {{LAYA_ENDPOINT?:string}} env
 * @param {string} html
 * @returns {Promise<TriageResult>}
 */
export async function classifyPage(env, html) {
  if (env.LAYA_ENDPOINT) {
    try {
      return await _callLaya(env.LAYA_ENDPOINT, html);
    } catch {
      // Laya endpoint configured but unreachable this call — degrade to the
      // heuristic rather than fail the whole scrape on a classifier outage.
      return _heuristicFallback(html);
    }
  }
  return _heuristicFallback(html);
}

async function _callLaya(endpoint, html) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: html.slice(0, 20_000) }), // Laya only needs a sample, not the full payload
  });
  if (!res.ok) throw new Error(`Laya endpoint returned ${res.status}`);
  return res.json();
}

function _heuristicFallback(html) {
  const lower = html.toLowerCase();
  const isBlocked = BLOCK_SIGNALS.some(signal => lower.includes(signal));
  const isEmpty = html.trim().length < 500;

  return {
    isValidListingPage: !isBlocked && !isEmpty,
    isBlockedOrCaptcha: isBlocked,
    language: 'en', // heuristic fallback doesn't attempt language id — Laya does
    confidence: 0.4, // deliberately low — this is a stand-in, not a real classification
  };
}
