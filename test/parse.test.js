import { describe, it, expect } from 'vitest';
import { parseDevelopment } from '../src/parse/development.js';
import { parsePlot } from '../src/parse/plot.js';
import { parseContentPage, chunk } from '../src/parse/content.js';
import { parseSitemap } from '../src/parse/sitemap.js';
import { parseRobots, isAllowed } from '../src/crawl/robots.js';
import { parsePrice, parseBeds, parseLooseObject, idsFromUrl, pickImage } from '../src/parse/util.js';
import { propertyStyle } from '../src/index/store.js';
import { fx, SITE } from './helpers.js';

describe('helpers', () => {
  it('reads prices, bedrooms and the site meta objects', () => {
    expect(parsePrice('From £774,995')).toBe(774995);
    expect(parsePrice('£1.2m')).toBe(1_200_000);
    expect(parsePrice('Price on request')).toBeNull();
    expect(parseBeds('5 bed house')).toMatchObject({ beds: 5, propertyType: 'house' });
    expect(parseBeds('2 bedroom apartment')).toMatchObject({ beds: 2, propertyType: 'apartment' });
    expect(parseLooseObject("{'price': '774995','plotSaleStatus': 'For Sale'}")).toEqual({ price: '774995', plotSaleStatus: 'For Sale' });
  });

  it('splits plot URLs into ids', () => {
    expect(idsFromUrl(`${SITE}/new-homes/dev001889-ashlawn-gardens/plot-218-h6325218/`)).toMatchObject({
      devId: 'dev001889',
      plotNo: '218',
      homeId: 'dev001889-218',
    });
    expect(idsFromUrl(`${SITE}/new-homes/dev-002596-x/plot-1-h1/`).devId).toBe('dev002596');
  });

  it('picks the image size closest to what the card needs', () => {
    expect(pickImage('/a.jpg?w=83| /a.jpg?w=383| /a.jpg?w=600', SITE, 400)).toBe(`${SITE}/a.jpg?w=383`);
  });

  it('works out the home style from the description', () => {
    expect(propertyStyle('This elegant detached home')).toBe('detached');
    expect(propertyStyle('A semi-detached family home')).toBe('semi-detached');
    expect(propertyStyle('end terrace townhouse')).toBe('terraced');
    expect(propertyStyle('A spacious family home')).toBeNull();
  });
});

describe('development page', () => {
  const dev = parseDevelopment(fx('development.html'), `${SITE}/new-homes/dev000101-willow-brook/`);

  it('reads the location and price range', () => {
    expect(dev).toMatchObject({
      id: 'dev000101',
      name: 'Willow Brook',
      address: { town: 'Oakford', county: 'Exampleshire', postcode: 'OX9 1AB' },
      lat: 52,
      lng: -1,
      priceFrom: 289995,
      priceTo: 415000,
      status: 'For Sale',
      schemes: ['Part Exchange'],
      salesPhone: '01234567890',
    });
    expect(dev.about).toMatch(/Outstanding primary school/);
    expect(dev.openingHours[0]).toEqual({ day: 'Monday', opens: '10:00', closes: '17:00' });
  });

  it('lists every home for sale with type, beds, price and offers', () => {
    expect(dev.homes).toHaveLength(3);
    expect(dev.homes[0]).toMatchObject({
      id: 'dev000101-12',
      plotNo: '12',
      houseType: 'Hazel',
      beds: 3,
      propertyType: 'house',
      price: 289995,
      statusMessages: ['Ready to move into'],
      tags: ['Deposit Boost'],
      image: `${SITE}/-/media/a.jpg?w=383&hash=2`,
    });
    expect(dev.homes[2]).toMatchObject({ beds: 2, propertyType: 'apartment' });
  });
});

describe('home page', () => {
  const p = parsePlot(fx('plot.html'), `${SITE}/new-homes/dev000101-willow-brook/plot-12-h1000012/`);

  it('reads the facts a buyer asks about', () => {
    expect(p).toMatchObject({
      id: 'dev000101-12',
      developmentId: 'dev000101',
      developmentName: 'Willow Brook',
      plotNo: '12',
      houseType: 'Hazel',
      beds: 3,
      price: 289995,
      status: 'For Sale',
      available: true,
      schemes: ['Deposit Boost'],
      lat: 52.001,
      lng: -1.002,
      salesPhone: '01234567890',
    });
    expect(p.keyFeatures).toContain('South facing garden');
    expect(p.energyFeatures).toEqual(['A/B EPC Rating', 'Photovoltaic Panels']);
    expect(p.nearestShowHome).toMatch(/5 minutes away/);
  });

  it('reads every room on every floor', () => {
    expect(p.rooms).toEqual([
      { floor: 'Ground', room: 'Kitchen / Dining', metric: '5600mm x 3200mm', imperial: `18'4" x 10'6"` },
      { floor: 'Ground', room: 'Study', metric: '2500mm x 2100mm', imperial: `8'2" x 6'11"` },
      { floor: 'First', room: 'Bedroom 1', metric: '4100mm x 3300mm', imperial: `13'5" x 10'10"` },
    ]);
    expect(p.floorPlans.map((f) => f.floor)).toEqual(['Ground', 'First']);
  });

  it('skips tiny lazy-load placeholder images', () => {
    expect(p.images).toEqual(['https://www.dwh.co.uk/-/media/p1.jpg?w=375']);
  });
});

describe('information pages, sitemaps and robots.txt', () => {
  it('turns a guide page into passages without the menu or footer', () => {
    const c = parseContentPage(fx('content.html'), `${SITE}/buying-guides/part-exchange/`);
    expect(c.title).toBe('Part Exchange');
    expect(c.passages.join(' ')).toMatch(/buy your current home/);
    expect(c.passages.join(' ')).not.toMatch(/Menu stuff|Footer/);
    expect(chunk('a'.repeat(50) + '\n' + 'b'.repeat(50), 1100)).toHaveLength(1);
  });

  it('reads sitemaps', () => {
    const urls = parseSitemap('<urlset><url><loc>https://x.test/a?b=1&amp;c=2</loc><lastmod>2026-01-01</lastmod></url></urlset>');
    expect(urls).toEqual([{ loc: 'https://x.test/a?b=1&c=2', lastmod: '2026-01-01', kind: 'url' }]);
  });

  it('obeys robots.txt rules, including wildcards', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /customer-portal/\nDisallow: /*?location=\nDisallow: /*_its$\nAllow: /customer-portal/help\n');
    const ua = 'HomeFinderAI/1.0';
    expect(isAllowed(rules, ua, `${SITE}/new-homes/dev1-x/`)).toBe(true);
    expect(isAllowed(rules, ua, `${SITE}/customer-portal/login`)).toBe(false);
    expect(isAllowed(rules, ua, `${SITE}/customer-portal/help`)).toBe(true);
    expect(isAllowed(rules, ua, `${SITE}/new-homes/?location=leeds`)).toBe(false);
    expect(isAllowed(rules, ua, `${SITE}/page_its`)).toBe(false);
  });
});
