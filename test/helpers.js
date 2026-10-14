import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SiteIndex } from '../src/index/store.js';
import { crawlSite } from '../src/crawl/crawler.js';
import { PoliteFetcher } from '../src/crawl/fetcher.js';

const fx = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const SITE = 'https://www.dwh.co.uk';

/** A tiny fictional version of the website, served from memory. */
export function fakeSite(overrides = {}) {
  const dev = fx('development.html');
  const plot = fx('plot.html');
  const pages = {
    [`${SITE}/robots.txt`]: 'User-agent: *\nDisallow: /search-results/\nDisallow: /*?location=\n',
    [`${SITE}/sitemap.xml`]: `<sitemapindex>
      <sitemap><loc>${SITE}/sitemaps/sitemap-dwh-developments.xml</loc></sitemap>
      <sitemap><loc>${SITE}/sitemaps/sitemap-dwh-plots.xml</loc></sitemap>
      <sitemap><loc>${SITE}/sitemaps/sitemap-dwh-support.xml</loc></sitemap></sitemapindex>`,
    [`${SITE}/sitemaps/sitemap-dwh-developments.xml`]: `<urlset><url><loc>${SITE}/new-homes/dev000101-willow-brook/</loc><lastmod>2026-10-01</lastmod></url></urlset>`,
    [`${SITE}/sitemaps/sitemap-dwh-plots.xml`]: `<urlset><url><loc>${SITE}/new-homes/dev000101-willow-brook/plot-12-h1000012/</loc></url></urlset>`,
    [`${SITE}/sitemaps/sitemap-dwh-support.xml`]: `<urlset><url><loc>${SITE}/buying-guides/part-exchange/</loc></url></urlset>`,
    [`${SITE}/new-homes/dev000101-willow-brook/`]: dev,
    [`${SITE}/new-homes/dev000101-willow-brook/plot-12-h1000012/`]: plot,
    [`${SITE}/buying-guides/part-exchange/`]: fx('content.html'),
    ...overrides,
  };
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    const body = pages[u];
    return { ok: body != null, status: body != null ? 200 : 404, url: u, headers: new Headers(), text: async () => body ?? 'not found' };
  };
  return { fetchImpl, calls, pages, fetcher: () => new PoliteFetcher({ fetchImpl, delayMs: 0 }) };
}

export function tempIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homefinder-'));
  return new SiteIndex({ dataDir: dir });
}

/** An index built by crawling the fake site. */
export async function crawledIndex({ details = false } = {}) {
  const site = fakeSite();
  const index = tempIndex();
  await crawlSite(index, { fetcher: site.fetcher(), content: true, details });
  return { index, site };
}

export { fx, SITE };
