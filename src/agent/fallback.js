import { searchHomes, listAreas, searchInfo } from '../index/search.js';
import { getHomeDetails } from '../crawl/crawler.js';
import { detailCard } from './tools.js';

/**
 * The built-in assistant used when no ANTHROPIC_API_KEY is set (or Claude is unreachable).
 * It understands common requests with rules, so the demo always works offline and costs nothing.
 */

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const num = (s) => (s == null ? null : WORD_NUM[s.toLowerCase()] ?? Number(s));

export function parseAmount(raw) {
  if (!raw) return null;
  const m = /£?\s*([\d.,]+)\s*(k|m|thousand|million|grand)?/i.exec(raw);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'thousand' || unit === 'grand') n *= 1e3;
  if (unit === 'm' || unit === 'million') n *= 1e6;
  if (!unit && n < 5000) n *= 1e3; // "under 350" in a house search means £350k
  return Math.round(n);
}

const AMOUNT = String.raw`£?\s*\d[\d.,]*\s*(?:k|m|thousand|million|grand)?\b`;
const FEATURE_WORDS = [
  ['garage', /garage/],
  ['en suite', /en[- ]?suite/],
  ['study', /study|home office|work from home/],
  ['garden', /garden/],
  ['south facing', /south[- ]facing/],
  ['utility', /utility/],
  ['driveway', /driveway|parking/],
  ['electric car charging', /ev charg|electric car|car charg/],
  ['photovoltaic', /solar|photovoltaic/],
  ['cul-de-sac', /cul[- ]de[- ]sac/],
];
const LOCATION_STOP = /\s+(?:with|under|below|over|above|for|that|which|and|around £|between|up to|less|more|max|budget|ready|near|please|in|having)\b.*$/i;

/** Pulls search filters out of a sentence like "3 bed detached in Rugby under £350k with a garage". */
export function parseQuery(text, index) {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  const f = {};

  const bedRange = /\b(\d|one|two|three|four|five|six)\s*(?:-|to|or)\s*(\d|one|two|three|four|five|six)\s*(?:bed|bedroom|br)/.exec(t);
  const bedMin = /\b(?:at least|min(?:imum)?|minimum of)\s*(\d|one|two|three|four|five|six)\s*(?:bed|bedroom)|\b(\d|one|two|three|four|five|six)\s*\+\s*(?:bed|bedroom)|\b(\d|one|two|three|four|five|six)\s*(?:bed|bedroom)s?\s*(?:or more|plus|\+)/.exec(t);
  const bedExact = /\b(\d|one|two|three|four|five|six)[\s-]*(?:bed|bedroom|br)s?\b/.exec(t);
  if (bedRange) [f.minBeds, f.maxBeds] = [num(bedRange[1]), num(bedRange[2])];
  else if (bedMin) f.minBeds = num(bedMin[1] || bedMin[2] || bedMin[3]);
  else if (bedExact) f.minBeds = f.maxBeds = num(bedExact[1]);

  const between = new RegExp(String.raw`between\s+(${AMOUNT})\s+(?:and|to|-)\s+(${AMOUNT})`, 'i').exec(t);
  const under = new RegExp(String.raw`(?:under|below|less than|up to|max(?:imum)?|no more than|budget(?: is| of)?|afford|cheaper than|within)\s+(${AMOUNT})`, 'i').exec(t);
  const over = new RegExp(String.raw`(?:over|above|more than|at least|from|min(?:imum)?)\s+(${AMOUNT})`, 'i').exec(t);
  const around = new RegExp(String.raw`(?:around|about|roughly|approx(?:imately)?)\s+(£\s*\d[\d.,]*\s*(?:k|m)?|\d[\d.,]*\s*(?:k|m)\b)`, 'i').exec(t);
  if (between) [f.minPrice, f.maxPrice] = [parseAmount(between[1]), parseAmount(between[2])];
  else {
    if (under && /£|\dk\b|\dm\b|thousand|\d{5,}/.test(under[1])) f.maxPrice = parseAmount(under[1]);
    if (over && /£|\dk\b|\dm\b|thousand|\d{5,}/.test(over[1])) f.minPrice = parseAmount(over[1]);
    if (around && !f.maxPrice && !f.minPrice) {
      const a = parseAmount(around[1]);
      [f.minPrice, f.maxPrice] = [Math.round(a * 0.85), Math.round(a * 1.1)];
    }
  }

  if (/apartment|\bflat\b/.test(t)) f.propertyType = 'apartment';
  else if (/bungalow/.test(t)) f.propertyType = 'bungalow';
  else if (/semi[- ]?detached|\bsemi\b/.test(t)) f.propertyType = 'semi-detached';
  else if (/\bdetached/.test(t)) f.propertyType = 'detached';
  else if (/terrace|townhouse/.test(t)) f.propertyType = 'terraced';

  const schemes = [];
  if (/part[- ]?ex/.test(t)) schemes.push('part exchange');
  if (/deposit (?:boost|contribution|help)/.test(t)) schemes.push('deposit boost');
  if (/stamp duty/.test(t) && !/what is|explain|how does/.test(t)) schemes.push('stamp duty');
  if (/key ?worker|nhs|nurse|teacher|police|armed forces/.test(t) && !/what is|explain/.test(t)) schemes.push('key worker');
  if (/movemaker|move maker/.test(t) && !/what is|explain/.test(t)) schemes.push('movemaker');
  if (/first[- ]time buyer|first homes/.test(t) && !/what is|explain|guide/.test(t)) schemes.push('first time buyer');
  if (schemes.length) f.schemes = schemes;
  if (/ready to move|move in (?:now|straight away|asap)|move (?:asap|quickly|soon)|available now|ready now/.test(t)) f.readyToMove = true;

  const feats = FEATURE_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (feats.length) f.features = feats;

  const radius = /within\s+(\d+)\s*(?:miles?|mi)\b/.exec(t);
  if (radius) f.radiusMiles = Number(radius[1]);

  const pc = /\b([a-z]{1,2}\d[a-z\d]?)(?:\s*(\d[a-z]{2}))?\b/i.exec(text);
  if (pc && /\d/.test(pc[1]) && !/^\d/.test(pc[1]) && !/bed/i.test(text.slice(pc.index, pc.index + 8))) f.location = pc[0].toUpperCase();
  else {
    for (const loc of text.matchAll(/\b(?:in|near|around|close to|nearby|of|at|by)\s+([a-z][a-z' .-]{2,40})/gi)) {
      const candidate = loc[1].replace(LOCATION_STOP, '').replace(/[.?!,]+$/, '').trim();
      if (candidate && !NOT_PLACES.test(candidate) && !/^\d/.test(candidate)) {
        f.location = titleCase(candidate);
        break;
      }
    }
  }
  if (!f.location && index) {
    // A town or development named anywhere in the message, e.g. "Rugby 4 beds".
    const places = new Set();
    for (const d of index.developments) for (const p of [d.address?.town, d.address?.county, d.name]) if (p && p.length > 3) places.add(p);
    const hit = [...places].sort((a, b) => b.length - a.length).find((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (hit) f.location = hit;
  }
  if (f.location && /^(new homes?|homes?|houses?|properties|the area)$/i.test(f.location)) delete f.location;

  if (/cheapest|lowest price|most affordable/.test(t)) f.sort = 'price_asc';
  else if (/most expensive|highest price|luxury|biggest|largest/.test(t)) f.sort = /biggest|largest/.test(t) ? 'beds_desc' : 'price_desc';
  else if (/nearest|closest/.test(t)) f.sort = 'distance';
  return f;
}

const NOT_PLACES = /^(a|an|the|my|our|least|most|all|any|budget|total|price|stock|mind|home|homes|house|houses|it|this|that|them|the moment|once|first|last)$/i;
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const money = (n) => (n == null ? '' : `£${Math.round(n).toLocaleString('en-GB')}`);

function describeFilters(f, res, count = 2) {
  const bits = [];
  if (f.minBeds && f.maxBeds && f.minBeds === f.maxBeds) bits.push(`${f.minBeds}-bedroom`);
  else if (f.minBeds && f.maxBeds) bits.push(`${f.minBeds}–${f.maxBeds} bedroom`);
  else if (f.minBeds) bits.push(`${f.minBeds}+ bedroom`);
  const one = count === 1;
  const nouns = { apartment: one ? 'apartment' : 'apartments', bungalow: one ? 'bungalow' : 'bungalows', house: one ? 'house' : 'houses' };
  bits.push(nouns[f.propertyType] || (f.propertyType ? `${f.propertyType} ${one ? 'home' : 'homes'}` : one ? 'home' : 'homes'));
  if (res.location) bits.push(res.location.radiusMiles ? `within ${res.location.radiusMiles} miles of ${res.location.label}` : `in ${res.location.label}`);
  if (f.minPrice && f.maxPrice) bits.push(`between ${money(f.minPrice)} and ${money(f.maxPrice)}`);
  else if (f.maxPrice) bits.push(`up to ${money(f.maxPrice)}`);
  else if (f.minPrice) bits.push(`from ${money(f.minPrice)}`);
  const SCHEME_NAMES = { 'part exchange': 'Part Exchange', 'deposit boost': 'Deposit Boost', 'stamp duty': 'Stamp Duty paid', 'key worker': 'the Key Worker Scheme', movemaker: 'Movemaker', 'first time buyer': 'first-time buyer offers', savings: 'savings offers' };
  if (f.schemes?.length) bits.push(`with ${f.schemes.map((x) => SCHEME_NAMES[x] || x).join(' and ')}`);
  if (f.readyToMove) bits.push('ready to move into');
  if (f.features?.length) bits.push(`with ${f.features.join(', ')}`);
  return bits.join(' ');
}

function resolveReference(text, context, index) {
  const shown = context.shownHomes || [];
  const t = text.toLowerCase();
  const ord = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, sixth: 5, '6th': 5 };
  for (const [w, i] of Object.entries(ord)) if (new RegExp(`\\b${w}\\b`).test(t) && shown[i]) return shown[i].id;
  if (/\blast one\b/.test(t) && shown.length) return shown.at(-1).id;
  const hash = /(?:#|number |no\.? ?)(\d{1,2})\b/.exec(t);
  if (hash && shown[Number(hash[1]) - 1]) return shown[Number(hash[1]) - 1].id;
  const plot = /plot\s*(\w+)/.exec(t);
  if (plot) {
    const inShown = shown.find((h) => String(h.plotNo).toLowerCase() === plot[1]);
    if (inShown) return inShown.id;
    const any = index.homes.filter((h) => String(h.plotNo).toLowerCase() === plot[1]);
    if (any.length === 1) return any[0].id;
  }
  const byType = shown.find((h) => h.houseType && t.includes(h.houseType.toLowerCase()));
  if (byType) return byType.id;
  if (/\b(it|this one|this home|that one|this house)\b/.test(t) && context.focusHomeId) return context.focusHomeId;
  return null;
}

function detailReply(d, question, dev) {
  const q = question.toLowerCase();
  const head = `**Plot ${d.plotNo}${d.houseType ? ` – the ${d.houseType}` : ''}** at ${d.developmentName || 'this development'}: ${d.beds ? `${d.beds} bedrooms, ` : ''}${d.priceText || money(d.price)}.`;
  const roomsText = () =>
    d.rooms?.length
      ? d.rooms.map((r) => `- ${r.floor ? `${r.floor}: ` : ''}${r.room} – ${r.metric?.replace(/(\d{4})mm/g, (_, mm) => `${(mm / 1000).toFixed(1)}m`)}${r.imperial ? ` (${r.imperial})` : ''}`).join('\n')
      : 'The website doesn\'t list room sizes for this home.';
  const offers = [...new Set([...(d.schemes || []), ...(d.keyFeatures || []).filter((k) => /£|saving|stamp|deposit|part exchange|included|upgrade/i.test(k))])];

  if (/room|size|dimension|how big|floor ?plan|square|sq/.test(q)) return `${head}\n\nRoom sizes from the floor plans:\n${roomsText()}`;
  if (/energy|epc|solar|eco|heating|bill|insulation|charg/.test(q))
    return `${head}\n\nEnergy features listed: ${d.energyFeatures?.length ? d.energyFeatures.join(', ') : 'none listed on the website'}.`;
  if (/offer|deal|saving|incentive|scheme|stamp|deposit|part ex|discount/.test(q))
    return `${head}\n\n${offers.length ? `Offers on this home:\n${offers.map((o) => `- ${o}`).join('\n')}` : 'The website doesn\'t list a specific offer on this home right now.'}\n\nOffers have terms, so check with the sales team on **${d.salesPhone || 'the number on the page'}**.`;
  if (/school|transport|train|station|shop|area|amenit|motorway|commute/.test(q))
    return `${head}\n\n${dev?.about ? `About the area: ${dev.about.slice(0, 700)}${dev.about.length > 700 ? '…' : ''}` : "The website doesn't describe the local area for this development."}`;
  if (/show ?home|visit|view(ing)?|book|appointment|see it/.test(q))
    return `${head}\n\n${d.nearestShowHome ? `${d.nearestShowHome}.\n\n` : ''}You can book a viewing on [the home's page](${d.url}) or call the sales team on **${d.salesPhone || 'the number on the page'}**${d.salesHours ? ` (${d.salesHours})` : ''}.`;
  if (/garage|parking|garden|kitchen|bathroom|en ?suite|study|office/.test(q)) {
    const word = /garage|parking|garden|kitchen|bathroom|en ?suite|study|office/.exec(q)[0].replace(' ', '');
    const lines = [...(d.keyFeatures || []), ...(d.highlights || []), ...(d.rooms || []).map((r) => `${r.room} ${r.metric || ''}`), d.description || ''].filter((l) => l.toLowerCase().replace(' ', '').includes(word));
    return `${head}\n\n${lines.length ? [...new Set(lines)].slice(0, 6).map((l) => `- ${l}`).join('\n') : `The website doesn't mention a ${word} for this home.`}`;
  }

  return [
    head,
    d.description ? (d.description.length > 320 ? d.description.slice(0, 320).replace(/\s\S*$/, '') + '…' : d.description) : null,
    offers.length ? `**Offers:** ${offers.slice(0, 3).join(' · ')}` : null,
    `Key features, ${d.rooms?.length ? `all ${d.rooms.length} room sizes, ` : ''}energy features and the nearest show home are in the card below. To view it, [book on its page](${d.url}) or call **${d.salesPhone || 'the sales team'}**${d.salesHours ? ` (${d.salesHours})` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** One conversation turn without Claude. */
export async function chatOffline({ index, message, context = {}, action }) {
  const t = message.toLowerCase().trim();

  // Details: a card's "Details" button, or "tell me about the second one".
  const wantsDetail = action?.type === 'details' || /tell me (more|everything|all)|more (info|details|about)|details|about (the|plot|this|that|it)|\b(it|this one|that one)\b|what about the|room|size|dimension|energy|epc|show ?home|offers? on|garage|garden|school|transport|area like|amenit|book a viewing|viewing|offers? (are )?on|this home|this house/.test(t);
  const looksLikeNewSearch = (() => {
    const q = parseQuery(message, index);
    return Boolean(q.location || q.minBeds || q.maxPrice || q.minPrice);
  })();
  const homeId =
    action?.homeId ||
    (wantsDetail ? resolveReference(message, context, index) : null) ||
    (wantsDetail && !looksLikeNewSearch && context.focusHomeId && !/tell me about the|first|second|third|plot \w/.test(t) ? context.focusHomeId : null);
  if (homeId) {
    const d = await getHomeDetails(index, homeId);
    if (d) {
      const dev = index.getDevelopment(d.developmentId || index.getHome(homeId)?.developmentId);
      return { reply: detailReply(d, action?.type === 'details' ? '' : message, dev), home: detailCard(d, index), focusHomeId: homeId };
    }
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|help|start|what can you do)\b/.test(t) && t.length < 40) {
    return {
      reply: `Hi! I can search every new home for sale on the ${index.developments.length ? `${index.developments.length} developments` : 'website'} and tell you everything about each one.\n\nTell me what you're after, for example **"3 bed house in Rugby under £350k"** or **"homes with Part Exchange near Leeds"**.`,
    };
  }

  if (/where (do|are|can)|which (areas|towns|counties|locations)|what (areas|locations)/.test(t)) {
    const areas = listAreas(index).filter((a) => a.county !== 'Other').slice(0, 12);
    return { reply: `Homes are for sale in ${areas.length} areas, including:\n${areas.map((a) => `- **${a.county}**: ${a.towns.slice(0, 4).join(', ')} (${a.homes} homes)`).join('\n')}\n\nWhich area suits you?` };
  }

  const isInfo = /^(what|how|why|can i|do you|does|is there|explain)\b/.test(t) && !/\b(bed|bedroom|homes? (in|near)|houses? (in|near))\b/.test(t);
  const filtersNow = parseQuery(message, index);
  if (isInfo && !filtersNow.location && !filtersNow.minBeds) {
    const hits = searchInfo(index, message, 2);
    if (hits.length) {
      const top = hits[0];
      return { reply: `From the website's **${top.title}** page:\n\n${top.text.replace(/^## /gm, '').slice(0, 650)}${top.text.length > 650 ? '…' : ''}\n\n[Read more](${top.url})`, sources: hits.map(({ url, title }) => ({ url, title })) };
    }
  }

  // Search, refining the previous search unless the customer starts again.
  // A new place means a new search; a message without a place refines the last one ("only with Part Exchange").
  const prev = context.filters || {};
  const newPlace = filtersNow.location && filtersNow.location.toLowerCase() !== String(prev.location || '').toLowerCase();
  const fresh = /new search|start again|start over|forget that/.test(t) || newPlace;
  let filters = fresh ? filtersNow : { ...prev, ...filtersNow };
  if (/cheaper|less expensive|lower price/.test(t) && context.shownHomes?.length) {
    const minShown = Math.min(...context.shownHomes.map((h) => h.price).filter(Boolean));
    if (Number.isFinite(minShown)) filters = { ...filters, maxPrice: minShown - 1, sort: 'price_asc' };
  }
  if (/bigger|more bedrooms|larger/.test(t)) filters = { ...filters, minBeds: (filters.minBeds || 2) + 1, maxBeds: undefined };
  if (/any price|no budget|ignore (the )?price/.test(t)) filters = { ...filters, minPrice: undefined, maxPrice: undefined };

  const anyFilter = Object.values(filtersNow).some((v) => v !== undefined) || /cheaper|bigger|show|homes|houses|properties|search|find|looking/.test(t);
  if (!anyFilter) {
    return { reply: "I can help with that if you tell me what you're looking for: an area, number of bedrooms and a budget all help. For example **\"4 bed detached near Chichester under £600k\"**." };
  }

  const res = await searchHomes(index, filters);
  if (!res.total) {
    let tip = '';
    if (res.location?.label && (filters.maxPrice || filters.minBeds || filters.schemes || filters.features)) {
      const looser = await searchHomes(index, { location: filters.location, radiusMiles: Math.max(filters.radiusMiles || 10, 20) });
      if (looser.total) tip = ` There are **${looser.total} homes** ${looser.location?.radiusMiles ? `within ${looser.location.radiusMiles} miles of` : 'in'} ${res.location.label} if you relax the other filters${looser.priceRange ? ` (from ${money(looser.priceRange.min)})` : ''}.`;
    } else if (!res.location || res.location.matchedBy === 'unknown') {
      const areas = listAreas(index).filter((a) => a.county !== 'Other').slice(0, 6).map((a) => a.county);
      tip = ` Areas with homes for sale include ${areas.join(', ')}.`;
    }
    return { reply: `I couldn't find any ${describeFilters(filters, res)} right now.${tip}${res.notes.length ? `\n\n_${res.notes.join(' ')}_` : ''}`, homes: [], filters, total: 0 };
  }

  const top = res.results.slice(0, 3);
  const why = top
    .map((c) => `- **${c.title}** at ${c.development}, ${c.town}: ${c.priceText || money(c.price)}${c.distanceMiles ? ` (${c.distanceMiles} mi)` : ''}${c.badges.length ? ` · ${c.badges.slice(0, 2).join(' · ')}` : ''}`)
    .join('\n');
  const reply = `I found **${res.total} ${describeFilters(filters, res, res.total)}**${res.priceRange && res.total > 1 ? `, from ${money(res.priceRange.min)} to ${money(res.priceRange.max)}` : ''}.\n\n${why}\n\n${res.total > res.results.length ? `Showing the first ${res.results.length}. ` : ''}Tap **Details** on any home, or tell me how to narrow it down.${res.notes.length ? `\n\n_${res.notes.join(' ')}_` : ''}`;
  return { reply, homes: res.results, filters, total: res.total };
}
