import { searchHomes, listAreas, searchInfo, toCard } from '../index/search.js';
import { getHomeDetails } from '../crawl/crawler.js';

const SCHEMES = ['part exchange', 'deposit boost', 'stamp duty', 'ready to move', 'savings', 'movemaker', 'first time buyer', 'key worker'];

/** Tool definitions given to Claude. Each one reads the site's data; none of them writes anything. */
export const TOOL_DEFS = [
  {
    name: 'search_homes',
    description:
      'Search the homes currently for sale on the website. Use it whenever the customer describes what they want, even partly. All filters are optional; pass only what the customer said or clearly implied. Results come back as cards that the customer sees under your reply.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Town, city, county, postcode (full or first half like "CV22"), or development name.' },
        radius_miles: { type: 'number', description: 'Search radius around the location. Default 10 (0 = only that exact town/development).' },
        min_beds: { type: 'integer' },
        max_beds: { type: 'integer' },
        min_price: { type: 'integer', description: 'GBP, e.g. 250000' },
        max_price: { type: 'integer', description: 'GBP, e.g. 400000' },
        property_type: { type: 'string', enum: ['house', 'apartment', 'bungalow', 'detached', 'semi-detached', 'terraced'] },
        house_type: { type: 'string', description: 'A named house design, e.g. "Lichfield".' },
        schemes: { type: 'array', items: { type: 'string', enum: SCHEMES }, description: 'Buying schemes or offers the home must have.' },
        ready_to_move: { type: 'boolean', description: 'Only homes ready to move into now.' },
        features: { type: 'array', items: { type: 'string' }, description: 'Must-have features, e.g. ["garage", "en suite", "study", "south facing garden"].' },
        sort: { type: 'string', enum: ['price_asc', 'price_desc', 'beds_desc', 'distance'] },
        limit: { type: 'integer', description: 'How many cards to show (default 6, max 12).' },
      },
    },
  },
  {
    name: 'get_home_details',
    description:
      "Everything about one home, read live from its page: price, status, offers, description, key features, energy features, every room's dimensions, floor plans, nearest show home, sales phone and hours, and the development's area information (schools, transport, shops). Use it for any question about a specific home.",
    input_schema: { type: 'object', properties: { home_id: { type: 'string' } }, required: ['home_id'] },
  },
  {
    name: 'get_development',
    description: 'Information about a development (a site with several homes): location, price range, offers, about the area (schools, transport, shops), opening hours, phone, and the homes for sale there.',
    input_schema: { type: 'object', properties: { name_or_id: { type: 'string' } }, required: ['name_or_id'] },
  },
  {
    name: 'search_site_info',
    description:
      "Search the website's information pages (buying schemes like Part Exchange and Deposit Boost, stamp duty, the buying process, reservations, warranties, FAQs). Use for general questions that aren't about one specific home.",
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'list_areas',
    description: 'Counties and towns where homes are for sale, with counts. Use when the customer asks where homes are available or gives a location that returned nothing.',
    input_schema: { type: 'object', properties: {} },
  },
];

export function toFilters(input = {}) {
  return {
    location: input.location,
    radiusMiles: input.radius_miles,
    minBeds: input.min_beds,
    maxBeds: input.max_beds,
    minPrice: input.min_price,
    maxPrice: input.max_price,
    propertyType: input.property_type,
    houseType: input.house_type,
    schemes: input.schemes,
    readyToMove: input.ready_to_move,
    features: input.features,
    sort: input.sort,
    limit: input.limit,
  };
}

/** Full details shaped for the chat UI's detail card. */
export function detailCard(d, index) {
  if (!d) return null;
  const listed = index.getHome(d.id) || {};
  return {
    id: d.id,
    title: [d.houseType, d.beds ? `${d.beds} bedroom ${listed.style || listed.propertyType || 'home'}` : null].filter(Boolean).join(' · '),
    plotNo: d.plotNo,
    houseType: d.houseType,
    beds: d.beds,
    price: d.price,
    priceText: d.priceText,
    address: d.address || listed.address,
    development: d.developmentName || listed.developmentName,
    developmentUrl: d.developmentUrl || listed.developmentUrl,
    badges: [...new Set([...(listed.statusMessages || []), ...(d.schemes || listed.tags || [])])].slice(0, 5),
    description: d.description,
    keyFeatures: d.keyFeatures || [],
    energyFeatures: d.energyFeatures || [],
    rooms: d.rooms || [],
    floorPlans: d.floorPlans || [],
    images: (d.images?.length ? d.images : [listed.image]).filter(Boolean).slice(0, 6),
    nearestShowHome: d.nearestShowHome,
    salesPhone: d.salesPhone,
    salesHours: d.salesHours,
    url: d.url || listed.url,
    source: d.source,
    fetchedAt: d.fetchedAt,
  };
}

/** Runs a tool and returns { result (for Claude), ui (for the widget) }. */
export async function runTool(name, input, { index }) {
  switch (name) {
    case 'search_homes': {
      const filters = toFilters(input);
      const res = await searchHomes(index, filters);
      return { result: { ...res, results: res.results.map(({ image, ...c }) => c) }, ui: { homes: res.results, filters, total: res.total } };
    }
    case 'get_home_details': {
      const d = await getHomeDetails(index, input.home_id);
      if (!d) return { result: { error: `No home with id "${input.home_id}". Use an id from search results.` } };
      const dev = index.getDevelopment(d.developmentId || index.getHome(d.id)?.developmentId);
      const { images, floorPlans, ...rest } = d;
      return {
        result: {
          ...rest,
          imageCount: images?.length || 0,
          floorPlanFloors: floorPlans?.map((f) => f.floor),
          development: dev && developmentSummary(dev, index, { homes: false }),
        },
        ui: { home: detailCard(d, index) },
      };
    }
    case 'get_development': {
      const dev = index.getDevelopment(input.name_or_id);
      if (!dev) return { result: { error: `No development matching "${input.name_or_id}".`, suggestion: 'Try search_homes with it as the location.' } };
      const homes = index.homes.filter((h) => h.developmentId === dev.id).map((h) => toCard(h));
      return { result: developmentSummary(dev, index), ui: { homes, total: homes.length } };
    }
    case 'search_site_info': {
      const hits = searchInfo(index, input.query);
      return { result: hits.length ? { passages: hits } : { passages: [], note: 'Nothing on the information pages matched. Suggest contacting the sales team.' } };
    }
    case 'list_areas':
      return { result: { areas: listAreas(index).slice(0, 40) } };
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

function developmentSummary(dev, index, { homes = true } = {}) {
  const hours = (dev.openingHours || []).filter((h) => h.opens && !/closed/i.test(h.opens));
  return {
    id: dev.id,
    name: dev.name,
    url: dev.url,
    address: dev.address,
    status: dev.status,
    priceFrom: dev.priceFrom,
    priceTo: dev.priceTo,
    bedrooms: dev.bedsSummary,
    schemes: dev.schemes,
    keyFeatures: dev.keyFeatures,
    highlights: dev.highlights?.slice(0, 8),
    description: dev.description?.slice(0, 800),
    aboutTheArea: dev.about?.slice(0, 1600),
    salesPhone: dev.salesPhone,
    salesHours: dev.salesHours,
    marketingSuiteOpening: hours.length ? hours.map((h) => `${h.day} ${h.opens}-${h.closes}`) : 'By appointment / closed (see description)',
    ...(homes ? { homesForSale: index.homes.filter((h) => h.developmentId === dev.id).map(({ id, plotNo, houseType, beds, price, statusMessages, tags }) => ({ id, plotNo, houseType, beds, price, offers: [...(statusMessages || []), ...(tags || [])] })) } : {}),
  };
}
