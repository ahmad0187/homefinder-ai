import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** "This elegant detached home…" → "detached". Used to filter by home style. */
export function propertyStyle(...texts) {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (/\bapartment|\bflat\b|maisonette/.test(t)) return 'apartment';
  if (/bungalow/.test(t)) return 'bungalow';
  if (/semi[- ]detached/.test(t)) return 'semi-detached';
  if (/end[- ]terrace|mid[- ]terrace|terraced|townhouse|town house/.test(t)) return 'terraced';
  if (/\bdetached/.test(t)) return 'detached';
  return null;
}

/**
 * The assistant's knowledge of the site: developments, homes for sale and information pages.
 * Built by the crawler, saved as JSON, and enriched with full home details as they are read.
 */
export class SiteIndex {
  constructor({ dataDir = config.dataDir } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'index.json');
    this.detailsDir = path.join(dataDir, 'details');
    this.reset();
  }

  reset() {
    this.site = config.siteUrl;
    this.builtAt = null;
    this.developments = [];
    this.homes = [];
    this.content = [];
    this.details = new Map();
    this.devById = new Map();
    this.homeById = new Map();
  }

  get isEmpty() {
    return this.homes.length === 0;
  }

  load() {
    this.reset();
    if (fs.existsSync(this.file)) {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.site = raw.site;
      this.builtAt = raw.builtAt;
      this.developments = raw.developments || [];
      this.content = raw.content || [];
      this.setHomes(raw.homes || []);
    }
    if (fs.existsSync(this.detailsDir)) {
      for (const f of fs.readdirSync(this.detailsDir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(this.detailsDir, f), 'utf8'));
          if (d?.id) this.details.set(d.id, d);
        } catch {
          // A corrupt cache file is simply re-fetched later.
        }
      }
    }
    this.reindex();
    for (const d of this.details.values()) this.mergeDetail(d);
    return this;
  }

  /** Builds the index from crawled development pages (each lists its homes for sale). */
  setFromDevelopments(devs, { content = this.content } = {}) {
    this.developments = devs.map(({ homes, ...dev }) => ({ ...dev, homeCount: homes?.length || 0 }));
    const homes = [];
    for (const dev of devs) {
      for (const h of dev.homes || []) {
        if (!h.id) continue;
        homes.push({
          ...h,
          developmentId: dev.id,
          developmentName: dev.name,
          developmentUrl: dev.url,
          address: dev.address?.line || null,
          town: dev.address?.town || null,
          county: dev.address?.county || null,
          postcode: dev.address?.postcode || null,
          lat: dev.lat,
          lng: dev.lng,
          developmentSchemes: dev.schemes || [],
        });
      }
    }
    this.setHomes(homes);
    this.content = content;
    this.builtAt = new Date().toISOString();
    this.reindex();
    for (const d of this.details.values()) this.mergeDetail(d);
  }

  setHomes(homes) {
    const seen = new Map();
    for (const h of homes) seen.set(h.id, h);
    this.homes = [...seen.values()];
  }

  reindex() {
    this.devById = new Map(this.developments.map((d) => [d.id, d]));
    this.homeById = new Map(this.homes.map((h) => [h.id, h]));
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.file + '.tmp';
    const homes = this.homes.map(({ details, featureText, style, ...h }) => h);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ site: this.site, builtAt: this.builtAt, developments: this.developments, homes, content: this.content }),
    );
    fs.renameSync(tmp, this.file);
  }

  saveDetail(detail) {
    if (!detail?.id) return;
    fs.mkdirSync(this.detailsDir, { recursive: true });
    fs.writeFileSync(path.join(this.detailsDir, `${detail.id}.json`), JSON.stringify(detail));
    this.details.set(detail.id, detail);
    this.mergeDetail(detail);
  }

  /** Full details sharpen search (style, features) and keep price/status current. */
  mergeDetail(d) {
    let h = this.homeById.get(d.id);
    if (!h) {
      // A home that is on the sitemap but not on its development's list yet.
      const dev = this.devById.get(d.developmentId) || {};
      h = {
        id: d.id,
        url: d.url,
        plotNo: d.plotNo,
        developmentId: d.developmentId,
        developmentName: d.developmentName || dev.name || null,
        developmentUrl: d.developmentUrl,
        town: dev.address?.town || null,
        county: dev.address?.county || null,
        postcode: dev.address?.postcode || null,
        statusMessages: [],
        tags: [],
        developmentSchemes: dev.schemes || [],
      };
      this.homes.push(h);
      this.homeById.set(h.id, h);
    }
    h.houseType = d.houseType || h.houseType;
    h.beds = d.beds ?? h.beds;
    if (d.price) h.price = d.price;
    h.priceText = d.priceText || h.priceText;
    h.address = d.address || h.address;
    h.lat = d.lat ?? h.lat;
    h.lng = d.lng ?? h.lng;
    h.status = d.status || h.status;
    h.available = d.available ?? h.available;
    h.image = h.image || d.images?.[0] || null;
    h.schemes = d.schemes;
    h.style = propertyStyle(d.description, d.keyFeatures?.join(' '));
    h.featureText = [d.description, ...(d.keyFeatures || []), ...(d.highlights || []), ...(d.energyFeatures || []), ...(d.rooms || []).map((r) => r.room)]
      .filter(Boolean)
      .join(' · ')
      .toLowerCase();
    h.hasDetails = true;
    h.detailsFetchedAt = d.fetchedAt;
  }

  getHome(id) {
    return this.homeById.get(String(id || '').toLowerCase()) || null;
  }

  getDevelopment(idOrName) {
    const q = String(idOrName || '').toLowerCase().trim();
    if (!q) return null;
    return (
      this.devById.get(q) ||
      this.developments.find((d) => d.name?.toLowerCase() === q) ||
      this.developments.find((d) => d.name?.toLowerCase().includes(q) || q.includes(d.name?.toLowerCase())) ||
      null
    );
  }

  stats() {
    return {
      builtAt: this.builtAt,
      developments: this.developments.length,
      homes: this.homes.length,
      withDetails: this.homes.filter((h) => h.hasDetails).length,
      infoPages: this.content.length,
    };
  }
}
