import * as cheerio from 'cheerio';

export const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** "From £774,995" → 774995. Returns null if there is no £ amount. */
export function parsePrice(text) {
  const m = /£\s?([\d,]+(?:\.\d+)?)\s*(k|m)?/i.exec(text || '');
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (m[2]?.toLowerCase() === 'k') n *= 1_000;
  if (m[2]?.toLowerCase() === 'm') n *= 1_000_000;
  return Number.isFinite(n) ? n : null;
}

/** "5 bed house" / "5 bedrooms" / "2 bedroom apartment" → { beds, propertyType } */
export function parseBeds(text) {
  const t = clean(text).toLowerCase();
  const m = /(\d+)\s*(?:-|to)?\s*(\d+)?\s*bed(?:room)?s?\b/.exec(t);
  const type = /apartment|flat/.test(t)
    ? 'apartment'
    : /bungalow/.test(t)
      ? 'bungalow'
      : /house|home/.test(t)
        ? 'house'
        : null;
  return { beds: m ? Number(m[1]) : null, bedsMax: m?.[2] ? Number(m[2]) : null, propertyType: type };
}

/** Parses the site's single-quoted JS object meta tags: {'price': '774995','pageType': 'Plot'} */
export function parseLooseObject(content) {
  const out = {};
  if (!content) return out;
  const re = /['"]([\w]+)['"]\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(content))) out[m[1]] = clean(m[2]);
  return out;
}

export function meta($, name) {
  return $(`meta[name="${name}"]`).attr('content') ?? null;
}

export function jsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some pages have trailing commas; a failed block is skipped, not fatal.
    }
  });
  return out;
}

export function absolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url.trim(), base).href;
  } catch {
    return null;
  }
}

/** Lazy images list several widths separated by "|". Pick the one closest to `want` px. */
export function pickImage(dataSrc, base, want = 600) {
  if (!dataSrc) return null;
  const options = dataSrc
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  let best = options[0];
  let bestDiff = Infinity;
  for (const o of options) {
    const w = Number(/[?&]w=(\d+)/.exec(o)?.[1] || 0);
    const diff = Math.abs(w - want);
    if (w && diff < bestDiff) {
      best = o;
      bestDiff = diff;
    }
  }
  return absolute(best, base);
}

export const unique = (arr) => [...new Set(arr.filter(Boolean))];

export function load(html) {
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]), style, noscript, svg, form').remove();
  return $;
}

/** Splits a "dev001889-ashlawn-gardens/plot-218-h6325218" style URL into its parts. */
export function idsFromUrl(url) {
  const p = new URL(url).pathname.split('/').filter(Boolean);
  const devSlug = p.find((s) => /^dev-?\d+/i.test(s)) || null;
  const devId = devSlug ? devSlug.match(/^dev-?(\d+)/i)[1] : null;
  const plotSlug = p.find((s) => /^plot-/i.test(s)) || null;
  const plotNo = plotSlug ? plotSlug.match(/^plot-([^-]+)/i)[1] : null;
  return {
    devSlug,
    devId: devId ? `dev${devId}` : null,
    plotSlug,
    plotNo,
    homeId: devId && plotNo ? `dev${devId}-${plotNo}`.toLowerCase() : null,
  };
}
