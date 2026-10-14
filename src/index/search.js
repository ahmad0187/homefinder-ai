import { milesBetween, resolveLocation } from '../geo/geocode.js';

const SCHEME_PATTERNS = {
  'part exchange': /part exchange/i,
  'deposit boost': /deposit boost|deposit contribution|deposit \+|deposit paid/i,
  'stamp duty': /stamp duty/i,
  'ready to move': /ready to move|move in now|ready now/i,
  'savings': /saving|£[\d,]+\s*(?:worth|off)|upgrades/i,
  'movemaker': /movemaker|move maker/i,
  'first time buyer': /first time buyer|first homes/i,
  'key worker': /key worker/i,
};

const lower = (s) => String(s || '').toLowerCase();

function offerText(h) {
  return [...(h.tags || []), ...(h.statusMessages || []), ...(h.schemes || []), ...(h.developmentSchemes || []), h.featureText].join(' | ');
}

/** Rich enough for cards in the chat and for the AI to talk about, small enough to keep calls cheap. */
export function toCard(h, distance = null) {
  return {
    id: h.id,
    title: [h.houseType, h.beds ? `${h.beds} bed ${h.style || h.propertyType || 'home'}` : null].filter(Boolean).join(' · '),
    houseType: h.houseType || null,
    beds: h.beds ?? null,
    propertyType: h.propertyType || null,
    style: h.style || null,
    price: h.price ?? null,
    priceText: h.priceText || null,
    plotNo: h.plotNo || null,
    development: h.developmentName || null,
    town: h.town || null,
    county: h.county || null,
    postcode: h.postcode || null,
    distanceMiles: distance == null ? null : Math.round(distance * 10) / 10,
    badges: [...new Set([...(h.statusMessages || []), ...(h.tags || [])])].slice(0, 4),
    image: h.image || null,
    url: h.url,
  };
}

/**
 * Filters and ranks the homes for sale. Every filter is optional.
 * Returns the matches plus notes explaining anything that couldn't be checked, so the AI never over-claims.
 */
export async function searchHomes(index, filters = {}, opts = {}) {
  const f = { ...filters };
  const notes = [];
  let homes = index.homes.filter((h) => h.status !== 'Sold' && h.available !== false);
  let location = null;

  if (f.location) {
    location = await resolveLocation(f.location, index.developments, opts);
    const radius = Number(f.radiusMiles) || (location?.kind === 'development' ? 0 : 10);
    if (!location || location.kind === 'unknown') {
      notes.push(`I couldn't find "${f.location}" on the site or on the map.`);
      homes = [];
    } else {
      const devSet = new Set(location.devIds);
      homes = homes
        .map((h) => {
          const d = location.center ? milesBetween(location.center, h) : null;
          return { h, d };
        })
        .filter(({ h, d }) => devSet.has(h.developmentId) || (radius && d != null && d <= radius))
        .map(({ h, d }) => ({ ...h, _distance: d }));
      location.radiusMiles = location.center && radius ? radius : null;
    }
  }

  if (f.developmentId) homes = homes.filter((h) => h.developmentId === lower(f.developmentId));
  if (f.minBeds) homes = homes.filter((h) => h.beds != null && h.beds >= f.minBeds);
  if (f.maxBeds) homes = homes.filter((h) => h.beds != null && h.beds <= f.maxBeds);
  if (f.minPrice) homes = homes.filter((h) => h.price != null && h.price >= f.minPrice);
  if (f.maxPrice) homes = homes.filter((h) => h.price != null && h.price <= f.maxPrice);
  if (f.houseType) homes = homes.filter((h) => lower(h.houseType).includes(lower(f.houseType)));

  if (f.propertyType) {
    const want = lower(f.propertyType);
    if (['detached', 'semi-detached', 'terraced'].includes(want)) {
      const unknown = homes.filter((h) => !h.style).length;
      homes = homes.filter((h) => h.style === want);
      if (unknown) notes.push(`${unknown} homes haven't been checked for style yet, so only homes confirmed as ${want} are shown.`);
    } else {
      homes = homes.filter((h) => h.propertyType === want || h.style === want || (want === 'house' && ['detached', 'semi-detached', 'terraced'].includes(h.style)));
    }
  }

  for (const s of f.schemes || []) {
    const re = SCHEME_PATTERNS[lower(s)] || new RegExp(lower(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    homes = homes.filter((h) => re.test(offerText(h)));
  }
  if (f.readyToMove) homes = homes.filter((h) => SCHEME_PATTERNS['ready to move'].test(offerText(h)));

  if (f.features?.length) {
    const unknown = homes.filter((h) => !h.hasDetails).length;
    homes = homes.filter((h) => h.hasDetails && f.features.every((k) => h.featureText.includes(lower(k).replace(/s$/, ''))));
    if (unknown) notes.push(`Feature search only covers homes whose full details have been read (${unknown} not yet read).`);
  }

  const sorters = {
    price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    price_desc: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    beds_desc: (a, b) => (b.beds ?? 0) - (a.beds ?? 0) || (a.price ?? 0) - (b.price ?? 0),
    distance: (a, b) => (a._distance ?? Infinity) - (b._distance ?? Infinity) || (a.price ?? 0) - (b.price ?? 0),
  };
  const sort = f.sort && sorters[f.sort] ? f.sort : location?.center ? 'distance' : 'price_asc';
  homes.sort(sorters[sort]);

  const limit = Math.min(Math.max(Number(f.limit) || 6, 1), 12);
  const prices = homes.map((h) => h.price).filter(Boolean);
  return {
    total: homes.length,
    sort,
    location: location && { label: location.label, matchedBy: location.kind, radiusMiles: location.radiusMiles ?? null },
    priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    towns: [...new Set(homes.map((h) => h.town).filter(Boolean))].slice(0, 8),
    results: homes.slice(0, limit).map((h) => toCard(h, h._distance ?? null)),
    notes,
  };
}

/** Developments overview for questions like "where do you build?" */
export function listAreas(index) {
  const byCounty = new Map();
  for (const d of index.developments) {
    const county = d.address?.county || d.address?.region || 'Other';
    if (!byCounty.has(county)) byCounty.set(county, { county, towns: new Set(), developments: 0, homes: 0 });
    const c = byCounty.get(county);
    if (d.address?.town) c.towns.add(d.address.town);
    c.developments++;
    c.homes += d.homeCount || 0;
  }
  return [...byCounty.values()]
    .map((c) => ({ ...c, towns: [...c.towns].sort() }))
    .sort((a, b) => b.homes - a.homes);
}

/** Simple keyword ranking over information pages (BM25-lite). */
export function searchInfo(index, query, limit = 3) {
  const terms = lower(query)
    .split(/[^a-z0-9£]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  const passages = index.content.flatMap((p) => p.passages.map((text) => ({ url: p.url, title: p.title, text })));
  const df = new Map(terms.map((t) => [t, passages.filter((p) => lower(p.text).includes(t)).length]));
  const N = passages.length || 1;
  return passages
    .map((p) => {
      const text = lower(p.title + ' ' + p.text);
      let score = 0;
      for (const t of terms) {
        const tf = text.split(t).length - 1;
        if (tf) score += Math.log(1 + N / (1 + df.get(t))) * ((tf * 2.2) / (tf + 1.2)) + (lower(p.title).includes(t) ? 1.5 : 0);
      }
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...p }) => ({ ...p, text: p.text.slice(0, 1100) }));
}

const STOP = new Set('the and for with what how does can are you your about from this that have has will who when where which why there their into than then them our out was were been being any all not but get got'.split(' '));
