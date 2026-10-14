import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setLiveFetcher } from '../src/crawl/crawler.js';
import { crawledIndex, tempIndex } from './helpers.js';

let app;
beforeAll(async () => {
  const { index, site } = await crawledIndex();
  setLiveFetcher(site.fetcher());
  app = createApp(index);
});
afterAll(() => setLiveFetcher(null));

describe('API', () => {
  it('reports health and index size', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, mode: 'offline', index: { homes: 3, developments: 1 } });
  });

  it('chats and returns home cards with suggestions', async () => {
    const r = await request(app).post('/api/chat').send({ message: 'homes in Oakford with Part Exchange' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('offline');
    expect(r.body.homes).toHaveLength(3);
    expect(r.body.suggestions).toContain('Only with Part Exchange');
  });

  it('keeps the conversation going with context', async () => {
    const first = await request(app).post('/api/chat').send({ message: 'homes in Oakford' });
    const r = await request(app)
      .post('/api/chat')
      .send({
        message: 'tell me about the first one',
        history: [
          { role: 'user', content: 'homes in Oakford' },
          { role: 'assistant', content: first.body.reply },
        ],
        context: { shownHomes: first.body.homes.map(({ id, title, development, town, priceText, price, plotNo, houseType }) => ({ id, title, development, town, priceText, price, plotNo, houseType })), filters: first.body.filters },
      });
    expect(r.status).toBe(200);
    expect(r.body.home.id).toBe(first.body.homes[0].id);
    expect(r.body.focusHomeId).toBe(first.body.homes[0].id);
  });

  it('rejects bad input', async () => {
    expect((await request(app).post('/api/chat').send({ message: '' })).status).toBe(400);
    expect((await request(app).post('/api/chat').send({ message: 'x'.repeat(1001) })).status).toBe(400);
    expect((await request(app).post('/api/chat').send({ message: 'hi', action: { type: 'delete', homeId: '1' } })).status).toBe(400);
  });

  it('returns one home in full', async () => {
    const r = await request(app).get('/api/homes/dev000101-12');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ houseType: 'Hazel', beds: 3 });
    expect(r.body.rooms).toHaveLength(3);
    expect((await request(app).get('/api/homes/nope')).status).toBe(404);
  });

  it('lets other websites embed the widget', async () => {
    const r = await request(app).options('/api/chat').set('Origin', 'https://client-site.example');
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    const js = await request(app).get('/widget.js');
    expect(js.status).toBe(200);
    expect(js.text).toMatch(/window\.HomeFinder/);
  });

  it('explains when the site has not been read yet', async () => {
    const empty = createApp(tempIndex());
    const r = await request(empty).post('/api/chat').send({ message: 'hi' });
    expect(r.body.reply).toMatch(/npm run crawl/);
  });
});
