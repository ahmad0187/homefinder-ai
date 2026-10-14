import { clean, parsePrice, parseBeds, parseLooseObject, meta, jsonLd, absolute, pickImage, unique, load, idsFromUrl } from './util.js';

const PHONE_RE = /\b0\d{3}\s?\d{3}\s?\d{4}\b|\b0\d{4}\s?\d{6}\b/;

/** Reads a development page: location, price range, offers, area info and the list of homes for sale. */
export function parseDevelopment(html, url) {
  const $ = load(html);
  const ids = idsFromUrl(url);
  const devMeta = parseLooseObject(meta($, 'development'));
  const ld = jsonLd($);
  const place = ld.find((x) => x?.geo || x?.address) || {};
  const addr = place.address || {};

  const header = $('.marketing-header').first();
  const name = clean($('h1').first().text()) || clean(header.find('h1,h2').first().text()) || devMeta.developmentName;
  const details = header.find('.marketing-header__details .icon-list__item').map((_, el) => clean($(el).text())).get();
  const addressLine = clean(header.find('.address').first().text());

  const [lat, lng] = ($('[data-area-lat-lng]').attr('data-area-lat-lng') || '').split(',').map(Number);
  const geo = place.geo || {};

  let priceFrom = devMeta.fromPrice ? Number(devMeta.fromPrice) : null;
  let priceTo = devMeta.toPrice ? Number(devMeta.toPrice) : null;
  const priceLine = details.find((d) => d.includes('£'));
  if (!priceFrom && priceLine) {
    const all = [...priceLine.matchAll(/£[\d,]+/g)].map((m) => parsePrice(m[0]));
    priceFrom = all[0] ?? null;
    priceTo = all[1] ?? priceFrom;
  }

  const bedsLine = details.find((d) => /bed/i.test(d)) || '';
  const schemes = details.filter((d) => d !== bedsLine && d !== priceLine);

  const about = aboutTheArea($);
  const contactText = clean($('.contact-console').first().text());

  const homes = $('.plot-list__plot')
    .map((_, li) => {
      const a = $(li).find('a.plot').first();
      const href = absolute(a.attr('href'), url);
      if (!href) return null;
      const lines = $(li).find('.plot__features .plot__details').map((__, el) => clean($(el).text())).get();
      const bedsInfo = parseBeds(lines.find((l) => /bed/i.test(l)) || '');
      const priceText = lines.find((l) => l.includes('£')) || '';
      return {
        id: idsFromUrl(href).homeId,
        url: href,
        plotNo: clean(a.find('.plot__heading').text()).replace(/^plot\s*/i, ''),
        houseType: clean(a.find('.plot__sales-name').text()) || null,
        beds: bedsInfo.beds,
        propertyType: bedsInfo.propertyType,
        price: parsePrice(priceText),
        priceText: priceText || null,
        statusMessages: a.find('.plot__status-message').map((__, el) => clean($(el).text())).get(),
        tags: a.find('.plot__details-product-tag').map((__, el) => clean($(el).text())).get(),
        image: pickImage(a.find('img').attr('data-src') || a.find('img').attr('src'), url, 400),
      };
    })
    .get()
    .filter(Boolean);

  const hours = (place.openingHoursSpecification || [])
    .filter((h) => h?.dayOfWeek)
    .map((h) => ({ day: h.dayOfWeek, opens: h.opens, closes: h.closes }));

  return {
    id: ids.devId || (devMeta.developmentID || '').toLowerCase() || null,
    slug: ids.devSlug,
    url,
    name,
    address: {
      line: addressLine || clean(addr.streetAddress),
      street: clean(addr.streetAddress) || null,
      town: clean(addr.addressLocality) || null,
      county: clean(addr.addressRegion) || devMeta.county || null,
      postcode: clean(addr.postalCode) || /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.exec(addressLine)?.[0] || null,
    },
    lat: Number.isFinite(lat) && lat ? lat : Number(geo.latitude) || null,
    lng: Number.isFinite(lng) && lng ? lng : Number(geo.longitude) || null,
    priceFrom,
    priceTo,
    status: devMeta.developmentStatus || null,
    bedsSummary: bedsLine || null,
    schemes,
    keyFeatures: header.find('.feature-list__item').map((_, el) => clean($(el).text())).get(),
    highlights: unique($('.carousel-item__banner-text').map((_, el) => clean($(el).text())).get()),
    description: clean(header.find('.marketing-copy__content').first().text()) || null,
    about,
    salesPhone: PHONE_RE.exec(contactText)?.[0]?.replace(/\s/g, '') || null,
    sitePhone: place.telephone || null,
    salesHours: /Mon[^|]{0,30}\d(?:am|pm)\s*-\s*\d+(?:am|pm)/i.exec(contactText)?.[0] || null,
    openingHours: hours,
    division: meta($, 'GTM.Site.Division'),
    homes,
    fetchedAt: new Date().toISOString(),
  };
}

function aboutTheArea($) {
  let text = '';
  $('section.tabs .tabs__navigation-item').each((_, el) => {
    const label = clean($(el).find('.tabs__navigation-text').first().text());
    if (/about the area|location/i.test(label)) {
      const t = clean($(el).find('.tabs__content').first().text());
      if (t.length > text.length) text = t;
    }
  });
  return text.replace(/^About the area\s*/i, '').replace(/\bClick here\b\s*/gi, '').slice(0, 2500) || null;
}
