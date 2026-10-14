import { clean, parsePrice, parseBeds, parseLooseObject, meta, jsonLd, absolute, pickImage, unique, load, idsFromUrl } from './util.js';

const PHONE_RE = /\b0\d{3}\s?\d{3}\s?\d{4}\b|\b0\d{4}\s?\d{6}\b/;

/** Reads one home's page: everything a buyer might ask about it. */
export function parsePlot(html, url) {
  const $ = load(html);
  const ids = idsFromUrl(url);
  const plotMeta = parseLooseObject(meta($, 'plot'));
  const product = jsonLd($).find((x) => x?.['@type'] === 'Product') || {};
  const crumbs = jsonLd($).find((x) => x?.['@type'] === 'BreadcrumbList');
  const devCrumb = crumbs?.itemListElement?.find((i) => /\/dev-?\d+[^/]*\/?$/i.test(i.item || ''));

  const header = $('.marketing-header').first();
  const headings = header.find('h1, h2').map((_, el) => clean($(el).text())).get();
  const details = header.find('.marketing-header__details .icon-list__item').map((_, el) => clean($(el).text())).get();
  const bedsLine = details.find((d) => /bed/i.test(d)) || '';
  const priceLine = details.find((d) => d.includes('£')) || '';
  const bedsInfo = parseBeds(bedsLine);

  const [lat, lng] = ($('[data-area-lat-lng]').attr('data-area-lat-lng') || '').split(',').map(Number);

  const rooms = [];
  const floorPlans = [];
  $('section.tabs .tabs__navigation-item').each((_, item) => {
    const floor = clean($(item).find('.tabs__navigation-text').first().text());
    $(item)
      .find('floor-plan')
      .each((__, fp) => {
        const img = absolute($(fp).attr('floor-plan-image'), url);
        if (img) floorPlans.push({ floor, image: img });
        try {
          for (const r of JSON.parse($(fp).attr('details') || '[]')) {
            rooms.push({ floor, room: clean(r.room), metric: clean(r.metric), imperial: clean(r.imperial) });
          }
        } catch {
          // A malformed floor plan shouldn't lose the rest of the page.
        }
      });
  });

  const images = unique(
    $('.carousel img, .marketing-header img')
      .map((_, el) => pickImage($(el).attr('data-src') || $(el).attr('src'), url, 800))
      .get()
      .filter((src) => src && !/[?&]w=10(&|$)/.test(src)),
  ).slice(0, 12);

  const priceFromLd = Number(product.offers?.price);
  const price = Number(plotMeta.price) || (Number.isFinite(priceFromLd) && priceFromLd) || parsePrice(priceLine);
  const contactText = clean($('.contact-console').first().text());

  return {
    id: ids.homeId,
    url,
    developmentId: ids.devId,
    developmentUrl: devCrumb?.item || (ids.devSlug ? new URL(`/new-homes/${ids.devSlug}/`, url).href : null),
    developmentName: devCrumb?.name || null,
    plotNo: ids.plotNo || clean(headings[0]).replace(/^plot\s*/i, ''),
    houseType: headings[1] || null,
    address: clean(header.find('.address').first().text()) || null,
    beds: bedsInfo.beds,
    propertyType: bedsInfo.propertyType,
    price: price || null,
    priceText: priceLine || null,
    status: plotMeta.plotSaleStatus || null,
    available: product.offers?.availability ? /InStock/i.test(product.offers.availability) : null,
    offerBanner: plotMeta.bannerMessage || null,
    schemes: details.filter((d) => d !== bedsLine && d !== priceLine),
    keyFeatures: header.find('.feature-list__item').map((_, el) => clean($(el).text())).get(),
    highlights: unique($('.carousel-item__banner-text').map((_, el) => clean($(el).text())).get()),
    description: clean(header.find('.marketing-copy__content').first().text()) || clean(product.description) || null,
    energyFeatures: unique($('.l-icons__icon-title').map((_, el) => clean($(el).text())).get()),
    rooms,
    floorPlans,
    images,
    nearestShowHome: clean($('.nearest-showhome__text').first().text()) || null,
    salesPhone: PHONE_RE.exec(contactText)?.[0]?.replace(/\s/g, '') || null,
    salesHours: /Mon[^|]{0,30}\d(?:am|pm)\s*-\s*\d+(?:am|pm)/i.exec(contactText)?.[0] || null,
    lat: Number.isFinite(lat) && lat ? lat : null,
    lng: Number.isFinite(lng) && lng ? lng : null,
    fetchedAt: new Date().toISOString(),
  };
}
