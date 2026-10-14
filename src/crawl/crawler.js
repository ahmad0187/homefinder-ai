import pLimit from 'p-limit';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { parseSitemap } from '../parse/sitemap.js';
import { parseDevelopment } from '../parse/development.js';
import { parsePlot } from '../parse/plot.js';
import { parseContentPage } from '../parse/content.js';
import { idsFromUrl } from '../parse/util.js';
import { enrichLocations } from '../geo/geocode.js';

const CONTENT_SITEMAPS = /buying-guides|support|offers|property-guides|range/i;

/**
 * Reads the website itself, starting from its sitemap:
 * 1. every development page (location, offers, and the homes currently for sale),
 * 2. optionally every home's own page (rooms, features, energy, images),
 * 3. optionally the buying-guide / scheme / FAQ pages, so general questions can be answered.
 */
export async function crawlSite(index, { details = false, content = false, limit = 0, fetcher = new PoliteFetcher(), geoFetch = fetch, log = () => {} } = {}) {
  const started = Date.now();
  const run = pLimit(config.crawlConcurrency);
  const errors = [];

  const root = await fetcher.get(new URL('/sitemap.xml', config.siteUrl).href);
  const children = parseSitemap(root.text);
  const pick = (re) => children.filter((c) => re.test(c.loc)).map((c) => c.loc);
  const readSitemap = async (urls) => (await Promise.all(urls.map((u) => fetcher.get(u).then((r) => parseSitemap(r.text)).catch(() => [])))).flat();

  const devSitemaps = children.some((c) => c.kind === 'sitemap') ? pick(/developments|comingsoon/i) : [root.url];
  let devUrls = (await readSitemap(devSitemaps)).map((u) => u.loc).filter((u) => idsFromUrl(u).devSlug && !idsFromUrl(u).plotSlug);
  devUrls = [...new Set(devUrls)];
  if (limit) devUrls = devUrls.slice(0, limit);
  log(`Found ${devUrls.length} developments in the sitemap.`);

  let done = 0;
  const devs = (
    await Promise.all(
      devUrls.map((url) =>
        run(async () => {
          try {
            const page = await fetcher.get(url);
            return parseDevelopment(page.text, url);
          } catch (err) {
            errors.push({ url, error: err.message });
            return null;
          } finally {
            if (++done % 10 === 0 || done === devUrls.length) log(`  developments ${done}/${devUrls.length}`);
          }
        }),
      ),
    )
  ).filter(Boolean);

  const located = await enrichLocations(devs, { fetchImpl: geoFetch });
  if (located) log(`Added county/region for ${located} developments from their postcodes.`);

  let contentPages = index.content;
  if (content) {
    const urls = [...new Set((await readSitemap(pick(CONTENT_SITEMAPS))).map((u) => u.loc))].slice(0, limit ? limit : 400);
    log(`Reading ${urls.length} information pages…`);
    contentPages = (
      await Promise.all(
        urls.map((url) =>
          run(async () => {
            try {
              const page = await fetcher.get(url);
              const parsed = parseContentPage(page.text, url);
              return parsed.passages.length ? parsed : null;
            } catch (err) {
              errors.push({ url, error: err.message });
              return null;
            }
          }),
        ),
      )
    ).filter(Boolean);
  }

  index.setFromDevelopments(devs, { content: contentPages });
  index.save();
  log(`Indexed ${index.developments.length} developments and ${index.homes.length} homes for sale.`);

  if (details) {
    const plotUrls = new Set(index.homes.map((h) => h.url));
    if (!limit) for (const u of await readSitemap(pick(/plots/i))) plotUrls.add(u.loc);
    const urls = [...plotUrls];
    log(`Reading ${urls.length} home pages for full details…`);
    let n = 0;
    await Promise.all(
      urls.map((url) =>
        run(async () => {
          try {
            const page = await fetcher.get(url);
            index.saveDetail(parsePlot(page.text, url));
          } catch (err) {
            errors.push({ url, error: err.message });
          } finally {
            if (++n % 25 === 0 || n === urls.length) log(`  homes ${n}/${urls.length}`);
          }
        }),
      ),
    );
    index.save();
  }

  return { ...index.stats(), requests: fetcher.requests, errors, seconds: Math.round((Date.now() - started) / 1000) };
}

/**
 * Everything about one home, read live from its page so price and availability are current.
 * Falls back to the last saved copy if the site can't be reached.
 */
let liveFetcher = null;
/** One shared fetcher for live reads (keeps robots.txt cached). Tests can swap it. */
export const setLiveFetcher = (f) => (liveFetcher = f);
const getLiveFetcher = () => (liveFetcher ||= new PoliteFetcher({ delayMs: 250 }));

export async function getHomeDetails(index, id, { fetcher = getLiveFetcher(), maxAgeHours = config.detailTtlHours } = {}) {
  const home = index.getHome(id);
  const cached = index.details.get(String(id).toLowerCase());
  if (!home && !cached) return null;
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < maxAgeHours * 3600_000;
  if (fresh) return { ...cached, source: 'cache' };
  try {
    const page = await fetcher.get(home?.url || cached.url, { retries: 1, timeoutMs: 12000 });
    const detail = parsePlot(page.text, home?.url || cached.url);
    if (!detail.id) detail.id = String(id).toLowerCase();
    index.saveDetail(detail);
    return { ...detail, source: 'live' };
  } catch (err) {
    if (cached) return { ...cached, source: 'cache', stale: true };
    // Not reachable and never read: return what the development list said about it.
    return { ...home, source: 'list', note: `Full details could not be loaded right now (${err.message}).` };
  }
}
