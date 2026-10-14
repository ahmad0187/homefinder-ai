import { describe, it, expect, beforeAll } from 'vitest';
import { searchHomes, searchInfo, listAreas } from '../src/index/search.js';
import { crawlSite, getHomeDetails } from '../src/crawl/crawler.js';
import { SiteIndex } from '../src/index/store.js';
import { crawledIndex, fakeSite, tempIndex, SITE } from './helpers.js';

process.env.GEOCODE = 'off';
const offline = { online: false };

describe('crawler', () => {
  it('reads the sitemap, every development and the information pages', async () => {
    const site = fakeSite();
    const index = tempIndex();
    const r = await crawlSite(index, { fetcher: site.fetcher(), content: true });
    expect(r).toMatchObject({ developments: 1, homes: 3, infoPages: 1, errors: [] });
    expect(site.calls[0]).toBe(`${SITE}/robots.txt`);

    // Saved to disk and loads back the same.
    const reloaded = new SiteIndex({ dataDir: index.dataDir }).load();
    expect(reloaded.stats()).toMatchObject({ developments: 1, homes: 3, infoPages: 1 });
  });

  it('can also read every home page for full details', async () => {
    const { index } = await crawledIndex({ details: true });
    const h = index.getHome('dev000101-12');
    expect(h.hasDetails).toBe(true);
    expect(h.style).toBe('semi-detached');
    expect(h.featureText).toMatch(/study/);
  });

  it('never fetches pages robots.txt disallows or other websites', async () => {
    const site = fakeSite();
    const f = site.fetcher();
    await expect(f.get(`${SITE}/search-results/?q=x`)).rejects.toThrow(/robots/);
    await expect(f.get('https://evil.example/')).rejects.toThrow(/configured site/);
  });

  it('records failed pages and carries on', async () => {
    const site = fakeSite({ [`${SITE}/new-homes/dev000101-willow-brook/`]: undefined });
    const index = tempIndex();
    const r = await crawlSite(index, { fetcher: site.fetcher() });
    expect(r.errors).toHaveLength(1);
    expect(r.homes).toBe(0);
  });
});

describe('searching homes', () => {
  let index;
  beforeAll(async () => {
    ({ index } = await crawledIndex());
  });

  it('filters by town, bedrooms and budget', async () => {
    const r = await searchHomes(index, { location: 'Oakford', minBeds: 3, maxPrice: 300000 }, offline);
    expect(r.total).toBe(1);
    expect(r.results[0]).toMatchObject({ id: 'dev000101-12', price: 289995, development: 'Willow Brook', town: 'Oakford' });
    expect(r.location).toMatchObject({ label: 'Oakford', matchedBy: 'town' });
  });

  it('matches counties, postcodes and development names', async () => {
    expect((await searchHomes(index, { location: 'Exampleshire' }, offline)).total).toBe(3);
    expect((await searchHomes(index, { location: 'OX9' }, offline)).total).toBe(3);
    expect((await searchHomes(index, { location: 'willow brook' }, offline)).total).toBe(3);
  });

  it("says when it doesn't know a place", async () => {
    const r = await searchHomes(index, { location: 'Atlantis' }, offline);
    expect(r.total).toBe(0);
    expect(r.notes[0]).toMatch(/couldn't find "Atlantis"/);
  });

  it('filters by offers, ready to move and property type', async () => {
    expect((await searchHomes(index, { schemes: ['part exchange'] })).results.map((h) => h.id)).toEqual(['dev000101-7', 'dev000101-12', 'dev000101-30']);
    expect((await searchHomes(index, { schemes: ['deposit boost'] })).results.map((h) => h.id)).toEqual(['dev000101-12']);
    expect((await searchHomes(index, { readyToMove: true })).results.map((h) => h.id)).toEqual(['dev000101-12']);
    expect((await searchHomes(index, { propertyType: 'apartment' })).results.map((h) => h.id)).toEqual(['dev000101-7']);
  });

  it("is honest when a filter can't be checked yet", async () => {
    const r = await searchHomes(index, { propertyType: 'detached' });
    expect(r.total).toBe(0);
    expect(r.notes[0]).toMatch(/haven't been checked for style/);
  });

  it('sorts and limits', async () => {
    const r = await searchHomes(index, { sort: 'price_desc', limit: 2 });
    expect(r.results.map((h) => h.price)).toEqual([415000, 289995]);
    expect(r.total).toBe(3);
    expect(r.priceRange).toEqual({ min: 199995, max: 415000 });
  });

  it('lists the areas with homes', () => {
    expect(listAreas(index)).toEqual([{ county: 'Exampleshire', towns: ['Oakford'], developments: 1, homes: 3 }]);
  });

  it('finds answers on the information pages', () => {
    const hits = searchInfo(index, 'How does part exchange work?');
    expect(hits[0]).toMatchObject({ title: 'Part Exchange', url: `${SITE}/buying-guides/part-exchange/` });
  });
});

describe('live home details', () => {
  it('reads the page live, then serves it from the cache', async () => {
    const { index, site } = await crawledIndex();
    const fetcher = site.fetcher();
    const first = await getHomeDetails(index, 'dev000101-12', { fetcher });
    expect(first).toMatchObject({ source: 'live', houseType: 'Hazel', beds: 3 });
    expect(first.rooms).toHaveLength(3);
    const second = await getHomeDetails(index, 'dev000101-12', { fetcher });
    expect(second.source).toBe('cache');
    expect(index.getHome('dev000101-12').hasDetails).toBe(true);
  });

  it('falls back to the list information if the page cannot be read', async () => {
    const { index } = await crawledIndex();
    const broken = fakeSite({ [`${SITE}/new-homes/dev000101-willow-brook/plot-30-h1000030/`]: undefined }).fetcher();
    const d = await getHomeDetails(index, 'dev000101-30', { fetcher: broken });
    expect(d).toMatchObject({ source: 'list', houseType: 'Oak', price: 415000 });
    expect(d.note).toMatch(/could not be loaded/);
    expect(await getHomeDetails(index, 'nope-1', { fetcher: broken })).toBeNull();
  });
});

describe('postcode enrichment', () => {
  it('adds county, district and region from postcodes.io', async () => {
    const { enrichLocations } = await import('../src/geo/geocode.js');
    const devs = [{ address: { postcode: 'LE18 3AE', county: null } }, { address: { postcode: 'CV22 5PT', county: 'Warwickshire' } }];
    const fetchImpl = async (url, opts) => ({
      ok: true,
      json: async () => ({
        result: JSON.parse(opts.body).postcodes.map((pc) => ({
          query: pc,
          result: pc.startsWith('LE')
            ? { admin_county: 'Leicestershire', admin_district: 'Oadby and Wigston', region: 'East Midlands', latitude: 52.6, longitude: -1.1 }
            : { admin_county: 'Warwickshire', admin_district: 'Rugby', region: 'West Midlands' },
        })),
      }),
    });
    expect(await enrichLocations(devs, { fetchImpl, online: true })).toBe(2);
    expect(devs[0].address).toMatchObject({ county: 'Leicestershire', district: 'Oadby and Wigston', region: 'East Midlands' });
    expect(devs[1].address.county).toBe('Warwickshire');
  });
});
