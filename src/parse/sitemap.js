/** Returns the <loc> entries of a sitemap or sitemap index, with lastmod when present. */
export function parseSitemap(xml) {
  const out = [];
  const re = /<(url|sitemap)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[2])?.[1];
    if (!loc) continue;
    out.push({ loc: decode(loc), lastmod: /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[2])?.[1] || null, kind: m[1] });
  }
  return out;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
