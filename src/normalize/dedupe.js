/**
 * normalize/dedupe.js — merges single-source normalized listings (each
 * scraper hands back one entry per property, with exactly one item in
 * `sources`) into the final cross-platform records the API returns.
 *
 * Merging is "did two listings mint the same id" (see ids.js — name+city
 * based), nothing fuzzier. When two listings share an id, their `sources`
 * arrays concatenate (so a property found on both Booking.com and Airbnb
 * ends up as ONE record with two source entries, matching what the
 * comparison-matrix UI on the frontend expects) and the first-seen
 * listing's descriptive fields (name/description/amenities/image) win —
 * arbitrary but simple; revisit if one platform's data turns out
 * consistently richer and should be preferred.
 *
 * @param {import('../types.js').NormalizedProperty[]} listings
 * @returns {import('../types.js').NormalizedProperty[]}
 */
export function mergeAcrossPlatforms(listings) {
  /** @type {Map<string, import('../types.js').NormalizedProperty>} */
  const byId = new Map();

  for (const listing of listings) {
    const existing = byId.get(listing.id);
    if (!existing) {
      byId.set(listing.id, { ...listing, sources: [...listing.sources] });
      continue;
    }
    // Same property, different platform (or a re-scrape within the same
    // batch) — merge sources, dedup by platform+sourceListingId.
    const seen = new Set(existing.sources.map(s => `${s.platform}:${s.sourceListingId}`));
    for (const src of listing.sources) {
      const key = `${src.platform}:${src.sourceListingId}`;
      if (!seen.has(key)) { existing.sources.push(src); seen.add(key); }
    }
    // Keep the lowest price across sources as the headline pricePerNight.
    existing.pricePerNight = Math.min(existing.pricePerNight, listing.pricePerNight);
  }

  return Array.from(byId.values());
}
