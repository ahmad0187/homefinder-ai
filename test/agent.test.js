import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseQuery, parseAmount, chatOffline } from '../src/agent/fallback.js';
import { chatWithClaude, setClient, systemPrompt } from '../src/agent/claude.js';
import { setLiveFetcher } from '../src/crawl/crawler.js';
import { crawledIndex } from './helpers.js';

let index;
beforeAll(async () => {
  const built = await crawledIndex();
  index = built.index;
  setLiveFetcher(built.site.fetcher());
});
afterAll(() => setLiveFetcher(null));

describe('understanding requests (no AI key)', () => {
  it('reads amounts the way people type them', () => {
    expect(parseAmount('£350k')).toBe(350000);
    expect(parseAmount('350,000')).toBe(350000);
    expect(parseAmount('1.2m')).toBe(1200000);
    expect(parseAmount('400 thousand')).toBe(400000);
    expect(parseAmount('350')).toBe(350000);
  });

  it.each([
    ['3 bed house in Rugby under £350k', { minBeds: 3, maxBeds: 3, location: 'Rugby', maxPrice: 350000 }],
    ['at least 4 bedrooms near Leeds', { minBeds: 4, location: 'Leeds' }],
    ['3 or 4 bed between £250k and £320,000', { minBeds: 3, maxBeds: 4, minPrice: 250000, maxPrice: 320000 }],
    ['detached with a garage and a study', { propertyType: 'detached', features: ['garage', 'study'] }],
    ['homes with part exchange ready to move in now', { schemes: ['part exchange'], readyToMove: true }],
    ['2 bed apartment within 15 miles of Bristol', { minBeds: 2, propertyType: 'apartment', radiusMiles: 15, location: 'Bristol' }],
    ['something around £400k in CV22', { minPrice: 340000, maxPrice: 440000, location: 'CV22' }],
    ['cheapest homes in Oakford', { sort: 'price_asc', location: 'Oakford' }],
  ])('%s', (text, expected) => {
    expect(parseQuery(text, index)).toMatchObject(expected);
  });

  it('spots a town named anywhere in the message', () => {
    expect(parseQuery('Oakford 3 beds please', index).location).toBe('Oakford');
  });
});

describe('built-in assistant', () => {
  it('searches and explains the results', async () => {
    const r = await chatOffline({ index, message: '3 bed homes in Oakford under £300k' });
    expect(r.total).toBe(1);
    expect(r.homes[0].id).toBe('dev000101-12');
    expect(r.reply).toMatch(/I found \*\*1 3-bedroom home within 10 miles of Oakford up to £300,000\*\*/);
  });

  it('refines the previous search', async () => {
    const first = await chatOffline({ index, message: 'homes in Oakford' });
    expect(first.total).toBe(3);
    const context = { filters: first.filters, shownHomes: first.homes };
    const second = await chatOffline({ index, message: 'only ones with deposit boost', context });
    expect(second.homes.map((h) => h.id)).toEqual(['dev000101-12']);
    const cheaper = await chatOffline({ index, message: 'show me cheaper ones', context });
    expect(cheaper.homes.every((h) => h.price < 199995)).toBe(true);
  });

  it('suggests what to do when nothing matches', async () => {
    const r = await chatOffline({ index, message: '5 bed homes in Oakford' });
    expect(r.total).toBe(0);
    expect(r.reply).toMatch(/couldn't find any 5-bedroom homes within 10 miles of Oakford/);
    expect(r.reply).toMatch(/3 homes\*\* within 20 miles/);
  });

  it('answers about "the first one" with live details', async () => {
    const first = await chatOffline({ index, message: 'homes in Oakford' });
    const r = await chatOffline({ index, message: 'what are the room sizes of the second one?', context: { shownHomes: first.homes } });
    expect(r.home.id).toBe('dev000101-12');
    expect(r.reply).toMatch(/Kitchen \/ Dining – 5\.6m x 3\.2m/);
  });

  it('opens a home from its card button', async () => {
    const r = await chatOffline({ index, message: 'Tell me about Plot 12', action: { type: 'details', homeId: 'dev000101-12' } });
    expect(r.home).toMatchObject({ id: 'dev000101-12', houseType: 'Hazel', salesPhone: '01234567890' });
    expect(r.reply).toMatch(/all 3 room sizes/);
    expect(r.reply).toMatch(/book on its page/);
    const follow = await chatOffline({ index, message: 'Room sizes', context: { focusHomeId: 'dev000101-12' } });
    expect(follow.home.id).toBe('dev000101-12');
    expect(follow.reply).toMatch(/Bedroom 1/);
  });

  it('answers questions from the information pages', async () => {
    const r = await chatOffline({ index, message: 'What is part exchange?' });
    expect(r.reply).toMatch(/buy your current home/);
    expect(r.sources[0].title).toBe('Part Exchange');
  });

  it('greets and lists areas', async () => {
    expect((await chatOffline({ index, message: 'hello' })).reply).toMatch(/3 bed house in Rugby/);
    expect((await chatOffline({ index, message: 'where do you have homes?' })).reply).toMatch(/Exampleshire/);
  });
});

describe('Claude agent', () => {
  it('lets Claude call the search tool and returns the cards it found', async () => {
    const calls = [];
    setClient({
      messages: {
        create: async (req) => {
          calls.push(req);
          if (calls.length === 1) {
            return {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', id: 't1', name: 'search_homes', input: { location: 'Oakford', min_beds: 3 } }],
            };
          }
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I found 2 homes in Oakford.' }], usage: {} };
        },
      },
    });
    const out = await chatWithClaude({ index, history: [], message: '3+ beds in Oakford', context: {} });
    expect(out.reply).toBe('I found 2 homes in Oakford.');
    expect(out.homes.map((h) => h.id).sort()).toEqual(['dev000101-12', 'dev000101-30']);
    expect(out.toolsUsed).toEqual(['search_homes']);
    const toolResult = calls[1].messages.at(-1).content[0];
    expect(toolResult.type).toBe('tool_result');
    expect(JSON.parse(toolResult.content).total).toBe(2);
    expect(calls[0].tools.map((t) => t.name)).toEqual(['search_homes', 'get_home_details', 'get_development', 'search_site_info', 'list_areas']);
    setClient(undefined);
  });

  it('tells Claude which homes the customer is looking at', () => {
    const p = systemPrompt(index, { shownHomes: [{ id: 'dev000101-12', title: 'Hazel · 3 bed', development: 'Willow Brook', town: 'Oakford', priceText: 'From £289,995' }] });
    expect(p).toMatch(/1\. id=dev000101-12 Hazel · 3 bed at Willow Brook, Oakford From £289,995/);
    expect(p).toMatch(/independent demo/i);
  });
});
