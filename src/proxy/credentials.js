/**
 * proxy/credentials.js — gets proxy credentials for the scrapers to route
 * through. Two modes, switched by env.PROXY_MODE (wrangler.toml):
 *
 *   'mock' — returns null (fetch.js falls back to a direct, unproxied
 *            request). Fine for building/testing extraction logic against
 *            sites that don't block the sandbox's IP; NOT fine for real
 *            production scraping of Booking/Trip.com/Airbnb, which will
 *            block a shared/datacenter IP fast.
 *   'real' — the actual x402 flow: GET Proxies.sx's endpoint, get a 402,
 *            pay USDC on-chain from a backend-held wallet, retry with the
 *            tx hash, get back {host,port,user,pass}. NOT implemented yet
 *            — see the TODO below — because there's no funded wallet to
 *            sign with. Everything downstream (fetch.js, every scraper)
 *            only ever calls getProxyCredentials(); nothing needs to
 *            change when this switches from mock to real.
 *
 * @typedef {{host:string, port:number, username:string, password:string, expiresAt:number}} ProxyCredentials
 */

let _cached = null;

/**
 * @param {{PROXY_MODE:string, PROXIES_WALLET_PRIVATE_KEY?:string, PROXIES_WALLET_NETWORK?:string}} env
 * @returns {Promise<ProxyCredentials|null>}
 */
export async function getProxyCredentials(env) {
  if (env.PROXY_MODE !== 'real') {
    return null; // signals fetch.js to go direct, unproxied
  }

  if (_cached && _cached.expiresAt > Date.now()) {
    return _cached;
  }

  return _realX402PurchaseFlow(env);
}

/**
 * TODO: implement once a funded backend wallet exists (see README — hot-
 * wallet balance policy). Shape of the real flow, per Proxies.sx's own
 * x402 API docs:
 *
 *   1. GET https://api.proxies.sx/v1/x402/proxy?country=US&traffic=1
 *   2. Response is HTTP 402 with { price, wallet, networks } in the body.
 *   3. Sign + broadcast a USDC transfer for `price` to `wallet`, on
 *      whichever of `networks` matches env.PROXIES_WALLET_NETWORK
 *      (Solana ~400ms/~$0.0001 gas is the cheaper choice over Base).
 *   4. Retry step 1 with the tx hash in a Payment-Signature header.
 *   5. 200 response carries { host, port, user, pass } — cache it (set
 *      `expiresAt` from whatever TTL the response gives the traffic
 *      allotment) and return it.
 *
 * Needs env.PROXIES_WALLET_PRIVATE_KEY set as a Wrangler secret (never a
 * plain var) once this is implemented — deliberately absent from
 * wrangler.toml's [vars] for that reason.
 */
async function _realX402PurchaseFlow(env) {
  throw new Error(
    'PROXY_MODE=real but the x402 purchase flow is not implemented yet — ' +
    'no funded wallet configured. Set PROXY_MODE=mock in wrangler.toml until it is.'
  );
}
