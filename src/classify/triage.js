/**
 * classify/triage.js — diagnoses WHY an extraction came back empty:
 * blocked (CAPTCHA/bot-wall), genuinely no results, or something broke
 * (the site's markup changed under us). Rule-based, not a learned
 * classifier — deliberately.
 *
 * Why not a model (this replaced an earlier Laya-based design): the
 * thing that actually proves a page was fine is successful extraction
 * itself — if extract.js pulled out real listings with sane prices, the
 * page was obviously valid, no classifier needed to confirm that.
 * Classification only matters on the FAILURE path, and bot-block pages
 * (Cloudflare challenge, PerimeterX, Akamai, DataDome, or a site's own
 * "unusual traffic" page) are templated and a known, narrow set — a
 * fingerprint match generalizes better here than a trained classifier
 * would, because there's nothing open-ended to generalize over. Revisit
 * this choice only if/when a genuinely fuzzy, open-ended judgment call
 * shows up elsewhere (e.g. mapping messy amenity text onto a controlled
 * vocabulary) — this specific job doesn't need one.
 *
 * Called ONLY when extraction returns zero listings — a successful
 * extraction skips this entirely (see each scraper's index.js).
 */

const BLOCK_SIGNALS = [
  // Generic
  'captcha', 'unusual traffic', 'access denied', 'are you a robot',
  'verify you are human', 'rate limit exceeded',
  // Known providers' own wording
  'checking your browser', 'cf-browser-verification', 'cf-error',      // Cloudflare
  'px-captcha', 'perimeterx',                                          // PerimeterX
  'datadome',                                                           // DataDome
  'akamai', 'reference #',                                             // Akamai (its block pages often include "Reference #")
];

/**
 * @param {{status:number, text:string}} response — the raw proxyFetch() result
 * @returns {'blocked'|'empty'|'error'}
 */
export function diagnoseEmptyResult(response) {
  if (response.status === 403 || response.status === 429) return 'blocked';
  if (response.status === 0 || response.status >= 500) return 'error';

  const lower = response.text.toLowerCase();
  if (BLOCK_SIGNALS.some(signal => lower.includes(signal))) return 'blocked';

  if (response.text.trim().length < 500) return 'error'; // suspiciously empty body — more likely broken than "no results"

  return 'empty'; // page loaded fine, extraction just found nothing — probably a genuinely empty result set, or the markup changed and extract.js needs a look
}
