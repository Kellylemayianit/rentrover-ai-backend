/**
 * classify/triage.js — diagnoses WHY an extraction came back empty:
 * blocked (CAPTCHA/bot-wall/JS challenge), genuinely no results, or
 * something broke (the site's markup changed under us). Rule-based, not
 * a learned classifier — deliberately. Runs ONLY when extraction returns
 * zero listings; a successful extraction skips it entirely.
 */

const BLOCK_SIGNALS = [
  'captcha', 'unusual traffic', 'access denied', 'are you a robot',
  'verify you are human', 'rate limit exceeded',
  'checking your browser', 'cf-browser-verification', 'cf-error',   // Cloudflare
  'px-captcha', 'perimeterx',                                       // PerimeterX
  'datadome',                                                        // DataDome
  'akamai', 'reference #',                                          // Akamai
  'awswaf', 'aws-waf', 'challenge.js', 'gokuprops',                  // AWS WAF
];

// Real block/challenge pages are small (the Booking.com one we caught was
// ~4KB). A genuine results page is 80KB-1MB and can contain these words
// anywhere in its scripts, so scanning one gives false "blocked" results
// (that is exactly what happened to the Airbnb and Trip.com test pages).
const MAX_BLOCK_PAGE_CHARS = 30000;

/**
 * @param {{status:number, text:string}} response — the raw proxyFetch() result
 * @returns {'blocked'|'empty'|'error'}
 */
export function diagnoseEmptyResult(response) {
  if (response.status === 403 || response.status === 429) return 'blocked';
  // Observed live on Booking.com: HTTP 202 plus a ~4KB script-only page
  // instead of results — the JS-challenge pattern.
  if (response.status === 202) return 'blocked';
  if (response.status === 0 || response.status >= 500) return 'error';

  if (response.text.length <= MAX_BLOCK_PAGE_CHARS) {
    const lower = response.text.toLowerCase();
    if (BLOCK_SIGNALS.some(signal => lower.includes(signal))) return 'blocked';
  }

  if (response.text.trim().length < 500) return 'error';

  // A full-size page that parsed to nothing: most likely our extractor no
  // longer matches the markup, or the query truly has no results.
  return 'empty';
}
