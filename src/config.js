import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  root,
  port: num(process.env.PORT, 3000),

  // The website the assistant reads. Any site with the same page structure works.
  siteUrl: (process.env.SITE_URL || 'https://www.dwh.co.uk').replace(/\/+$/, ''),
  siteName: process.env.SITE_NAME || 'David Wilson Homes',
  assistantName: process.env.ASSISTANT_NAME || 'HomeFinder AI',

  dataDir: process.env.DATA_DIR || path.join(root, 'data'),

  // Polite crawling
  userAgent:
    process.env.CRAWL_USER_AGENT ||
    'HomeFinderAI/1.0 (+https://github.com/ahmad0187/homefinder-ai; portfolio demo)',
  crawlDelayMs: num(process.env.CRAWL_DELAY_MS, 1000),
  crawlConcurrency: num(process.env.CRAWL_CONCURRENCY, 2),
  detailTtlHours: num(process.env.DETAIL_TTL_HOURS, 24),
  refreshHours: num(process.env.REFRESH_HOURS, 24),

  // AI
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',

  // Optional free UK place-name lookup (postcodes.io, no key). Off = only towns/postcodes found on the site.
  geocode: (process.env.GEOCODE || 'on') !== 'off',

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  showImages: (process.env.SHOW_IMAGES || 'on') !== 'off',
};
