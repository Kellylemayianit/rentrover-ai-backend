/**
 * tiers.js — the $5 / $7 / $9 subscription tiers. Differentiated by daily
 * search volume for now, since that maps directly to proxy-bandwidth cost
 * (the thing these subscriptions are funding) — adjust freely, this is a
 * starting default, not something settled elsewhere.
 */

export const TIERS = {
  tier5: { price: 5, label: 'Starter', dailySearchLimit: 30 },
  tier7: { price: 7, label: 'Explorer', dailySearchLimit: 100 },
  tier9: { price: 9, label: 'Unlimited', dailySearchLimit: Infinity },
};

export const DEFAULT_TIER = 'tier5';

/**
 * Looked up by email rather than a session id, because that's all the
 * frontend's authStore.js currently keeps client-side (see its
 * currentUser() shape) — there's no real session-token exchange yet. This
 * is a known gap: anyone could pass another person's email in the header
 * below and consume their quota. Fine for a single-developer prototype
 * phase; needs a real bearer-token session before this is trustworthy in
 * production. Flagging rather than quietly shipping it as if it's solid.
 *
 * @param {object} env @param {string|null} email
 * @returns {Promise<{ok:boolean, remaining?:number}>}
 */
export async function checkAndConsumeSearchQuota(env, email) {
  if (!email) return { ok: true }; // anonymous request — see routes/search.js's note on this
  const user = await env.DB.prepare('SELECT tier, searches_today, searches_reset_at FROM users WHERE email = ?')
    .bind(email).first();
  if (!user) return { ok: true }; // unrecognized email — fail open rather than block on a lookup miss

  const now = Date.now();
  let { tier, searches_today: used, searches_reset_at: resetAt } = user;

  if (now > resetAt) {
    used = 0;
    resetAt = now + 86_400_000;
  }

  const limit = TIERS[tier]?.dailySearchLimit ?? TIERS[DEFAULT_TIER].dailySearchLimit;
  if (used >= limit) return { ok: false, remaining: 0 };

  await env.DB.prepare('UPDATE users SET searches_today = ?, searches_reset_at = ? WHERE email = ?')
    .bind(used + 1, resetAt, email).run();

  return { ok: true, remaining: limit === Infinity ? Infinity : limit - used - 1 };
}
