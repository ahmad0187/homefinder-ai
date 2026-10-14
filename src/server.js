import { config } from './config.js';
import { createApp } from './app.js';
import { SiteIndex } from './index/store.js';
import { crawlSite } from './crawl/crawler.js';

const index = new SiteIndex().load();
const app = createApp(index);

app.listen(config.port, () => {
  const s = index.stats();
  console.log(`${config.assistantName} running on http://localhost:${config.port}`);
  console.log(`  Reading: ${config.siteUrl}`);
  console.log(`  AI: ${config.anthropicKey ? `Claude (${config.model})` : 'built-in assistant (set ANTHROPIC_API_KEY for Claude)'}`);
  console.log(s.homes ? `  Index: ${s.homes} homes, ${s.developments} developments, built ${s.builtAt}` : '  Index is empty: run `npm run crawl` first.');
});

// Keep the index fresh: re-read the website in the background once it's older than REFRESH_HOURS.
if (process.env.AUTO_REFRESH !== 'off') {
  let running = false;
  const refresh = async () => {
    const ageH = index.builtAt ? (Date.now() - new Date(index.builtAt).getTime()) / 3600_000 : Infinity;
    if (running || ageH < config.refreshHours) return;
    running = true;
    try {
      const r = await crawlSite(index, { log: () => {} });
      console.log(`Index refreshed: ${r.homes} homes, ${r.developments} developments (${r.seconds}s, ${r.errors.length} errors)`);
    } catch (err) {
      console.error('Background refresh failed:', err.message);
    } finally {
      running = false;
    }
  };
  setInterval(refresh, 30 * 60_000).unref();
  setTimeout(refresh, 15_000).unref();
}
