import { config } from '../config.js';
import { parseRobots, isAllowed } from './robots.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FetchError extends Error {
  constructor(message, url, status) {
    super(message);
    this.url = url;
    this.status = status;
  }
}

/**
 * A polite fetcher for one website: obeys robots.txt, identifies itself,
 * spaces requests out, and retries temporary errors with backoff.
 */
export class PoliteFetcher {
  constructor({ siteUrl = config.siteUrl, userAgent = config.userAgent, delayMs = config.crawlDelayMs, fetchImpl = fetch } = {}) {
    this.siteUrl = siteUrl;
    this.userAgent = userAgent;
    this.delayMs = delayMs;
    this.fetchImpl = fetchImpl;
    this.robots = null;
    this.nextSlot = 0;
    this.requests = 0;
  }

  async loadRobots() {
    if (this.robots) return this.robots;
    try {
      const res = await this.fetchImpl(new URL('/robots.txt', this.siteUrl), { headers: { 'user-agent': this.userAgent } });
      this.robots = res.ok ? parseRobots(await res.text()) : [];
    } catch {
      this.robots = [];
    }
    return this.robots;
  }

  /** Reserves the next request slot so concurrent callers still respect the delay. */
  async waitTurn() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.delayMs;
    if (slot > now) await sleep(slot - now);
  }

  async get(url, { retries = 3, timeoutMs = 20000 } = {}) {
    if (new URL(url).origin !== new URL(this.siteUrl).origin) throw new FetchError('Only the configured site can be crawled', url, 0);
    const robots = await this.loadRobots();
    if (!isAllowed(robots, this.userAgent, url)) throw new FetchError('Blocked by robots.txt', url, 0);

    for (let attempt = 0; ; attempt++) {
      await this.waitTurn();
      this.requests++;
      let res;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'user-agent': this.userAgent, accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new FetchError(err?.name === 'TimeoutError' ? 'Timed out' : 'Could not connect', url, 0);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(retryAfter || 2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new FetchError(`HTTP ${res.status}`, url, res.status);
      return { url: res.url || url, text: await res.text() };
    }
  }
}
