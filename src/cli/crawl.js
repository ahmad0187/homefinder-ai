#!/usr/bin/env node
// Builds the assistant's index by reading the website itself.
//   npm run crawl                 developments + homes for sale (about 3 minutes)
//   npm run crawl -- --details    also read every home's own page (rooms, features…)
//   npm run crawl -- --content    also read buying-guide / offers / FAQ pages
//   npm run crawl -- --limit 5    quick test on the first 5 developments
import { config } from '../config.js';
import { SiteIndex } from '../index/store.js';
import { crawlSite } from '../crawl/crawler.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) || 0 : 0;

const index = new SiteIndex().load();
console.log(`Reading ${config.siteUrl} (one request every ${config.crawlDelayMs}ms, ${config.crawlConcurrency} at a time)…`);

try {
  const result = await crawlSite(index, { details: flag('details'), content: flag('content'), limit, log: (m) => console.log(m) });
  console.log('\nDone:', JSON.stringify({ ...result, errors: result.errors.length }, null, 2));
  if (result.errors.length) {
    console.log('Pages that failed (first 10):');
    for (const e of result.errors.slice(0, 10)) console.log(`  ${e.error}  ${e.url}`);
  }
} catch (err) {
  console.error(`\nCrawl failed: ${err.message}${err.url ? ` (${err.url})` : ''}`);
  process.exitCode = 1;
}
