import { config } from '../config.js';

const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/i;
const cache = new Map();

export function milesBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const centroid = (devs) => {
  const pts = devs.filter((d) => d.lat && d.lng);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, d) => s + d.lat, 0) / pts.length, lng: pts.reduce((s, d) => s + d.lng, 0) / pts.length };
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Turns what a customer typed ("Rugby", "near Leeds", "CV22", "Ashlawn Gardens") into
 * the developments that match by name/town/county and, when possible, a map point to measure distance from.
 */
export async function resolveLocation(query, developments, { fetchImpl = fetch, online = config.geocode } = {}) {
  const q = norm(query).replace(/^(near|around|in|close to)\s+/, '');
  if (!q) return null;

  const byName = developments.filter((d) => norm(d.name) === q || (q.length > 5 && norm(d.name).includes(q)));
  if (byName.length) return { label: byName[0].name, kind: 'development', devIds: byName.map((d) => d.id), center: centroid(byName) };

  const pc = POSTCODE.exec(query.trim());
  if (pc) {
    const out = pc[1].toUpperCase();
    const devs = developments.filter((d) => (d.address?.postcode || '').toUpperCase().replace(/\s/g, '').startsWith(out + (pc[2] || '').toUpperCase()));
    const center = (await lookupPostcode(query.trim(), { fetchImpl, online })) || centroid(devs);
    return { label: query.trim().toUpperCase(), kind: 'postcode', devIds: devs.map((d) => d.id), center };
  }

  const inTown = developments.filter((d) => norm(d.address?.town) === q);
  const inCounty = developments.filter((d) => [d.address?.county, d.address?.district, d.address?.region].some((v) => norm(v) === q));
  const inAddress = developments.filter((d) => ` ${norm(d.address?.line)} `.includes(` ${q} `));
  const textMatches = inTown.length ? inTown : inCounty.length ? inCounty : inAddress;
  const kind = inTown.length ? 'town' : inCounty.length ? 'county' : 'area';

  const placePoint = await lookupPlace(q, { fetchImpl, online });
  if (textMatches.length || placePoint) {
    return {
      label: query.trim().replace(/^(near|around|in|close to)\s+/i, ''),
      kind: placePoint && !textMatches.length ? 'place' : kind,
      devIds: textMatches.map((d) => d.id),
      center: kind === 'county' ? null : placePoint || centroid(textMatches),
    };
  }
  return { label: query.trim(), kind: 'unknown', devIds: [], center: null };
}

/**
 * Adds county, district and region to each development from its postcode (postcodes.io bulk lookup, free, no key),
 * so customers can search by "Leicestershire" or "North West" even when the page only shows a town.
 */
export async function enrichLocations(developments, { fetchImpl = fetch, online = config.geocode } = {}) {
  if (!online) return 0;
  const withPc = developments.filter((d) => d.address?.postcode);
  let updated = 0;
  for (let i = 0; i < withPc.length; i += 100) {
    const batch = withPc.slice(i, i + 100);
    let json;
    try {
      const res = await fetchImpl('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postcodes: batch.map((d) => d.address.postcode) }),
        signal: AbortSignal.timeout(15000),
      });
      json = res.ok ? await res.json() : null;
    } catch {
      json = null;
    }
    for (const [k, item] of (json?.result || []).entries()) {
      const r = item?.result;
      const d = batch[k];
      if (!r || !d) continue;
      d.address.county ||= r.admin_county || r.admin_district || null;
      d.address.district = r.admin_district || null;
      d.address.region = r.region || r.country || null;
      if (!d.lat && r.latitude) [d.lat, d.lng] = [r.latitude, r.longitude];
      updated++;
    }
  }
  return updated;
}

async function getJson(url, fetchImpl) {
  if (cache.has(url)) return cache.get(url);
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    const json = res.ok ? await res.json() : null;
    cache.set(url, json);
    return json;
  } catch {
    return null;
  }
}

/** Free UK postcode lookup (postcodes.io, no API key). */
async function lookupPostcode(postcode, { fetchImpl, online }) {
  if (!online) return null;
  const compact = postcode.replace(/\s/g, '');
  const full = compact.length >= 5 ? await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`, fetchImpl) : null;
  const r = full?.result || (await getJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(compact)}`, fetchImpl))?.result;
  return r?.latitude ? { lat: r.latitude, lng: r.longitude } : null;
}

/** Free UK place-name lookup (towns, cities, villages) via postcodes.io. */
async function lookupPlace(name, { fetchImpl, online }) {
  if (!online || name.length < 3) return null;
  const json = await getJson(`https://api.postcodes.io/places?q=${encodeURIComponent(name)}&limit=5`, fetchImpl);
  const results = json?.result || [];
  const pick =
    results.find((p) => norm(p.name_1) === name && /City|Town/i.test(p.local_type)) ||
    results.find((p) => norm(p.name_1) === name) ||
    results[0];
  return pick?.latitude ? { lat: pick.latitude, lng: pick.longitude } : null;
}
