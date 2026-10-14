import { clean, load, meta } from './util.js';

/** Reads an information page (buying guides, schemes, FAQs) into searchable passages. */
export function parseContentPage(html, url) {
  const $ = load(html);
  $('header, nav, footer, .navigation, .navigation-v2, .footer, .contact-console, .legal, dialog, button').remove();
  const title = clean($('h1').first().text()) || clean($('title').text()).replace(/\s*\|.*$/, '');
  const description = meta($, 'description');
  const root = $('main').length ? $('main') : $('body');

  const blocks = [];
  root.find('h2, h3, h4, p, li, td').each((_, el) => {
    const t = clean($(el).text());
    if (t.length < 3) return;
    const tag = el.tagName.toLowerCase();
    blocks.push(/^h\d$/.test(tag) ? `\n## ${t}\n` : t);
  });

  const text = blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { url, title, description, passages: chunk(text, 1100) };
}

/** Splits text into passages of about `size` characters, keeping each heading with what follows it. */
export function chunk(text, size = 1100) {
  const parts = text.split(/\n(?=## )/);
  const out = [];
  for (const part of parts) {
    let buf = '';
    for (const line of part.split('\n')) {
      if (buf.length + line.length > size && buf.length > 200) {
        out.push(buf.trim());
        buf = '';
      }
      buf += line + '\n';
    }
    if (buf.trim().length > 40) out.push(buf.trim());
  }
  return out;
}
