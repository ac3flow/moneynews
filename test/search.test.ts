import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBingNews, parseGdelt, unwrapBingLink } from '../src/pipeline/feeds';
import { readConfig } from '../src/pipeline/context';
import { collectStage, pollable, selectFeedBatch } from '../src/pipeline/research';
import { FEEDS, type FeedRef } from '../src/registry/sources';
import type { Env } from '../src/types';
import { makeEnv, rows } from './helpers';

const NOW = Date.parse('2026-10-04T08:00:00Z');
const bingLink = (real: string) => `http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc&amp;url=${encodeURIComponent(real).replace(/%/g, '%')}&amp;c=1&amp;mkt=en-us`;
const bingItem = (title: string, real: string, extra = '') => `<item><title>${title}</title><link>${bingLink(real)}</link><description>Snippet for ${title}</description><pubDate>Sun, 04 Oct 2026 06:30:00 GMT</pubDate><News:Source>Whoever</News:Source>${extra}</item>`;
const bingXml = (...items: string[]) => `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news"><channel><title>x</title>${items.join('')}</channel></rss>`;

describe('Bing News results', () => {
  it("unwraps Bing's tracking link to the publisher's own address", () => {
    expect(unwrapBingLink(bingLink('https://www.reuters.com/markets/story-1/'))).toBe('https://www.reuters.com/markets/story-1/');
    expect(unwrapBingLink('https://www.ft.com/content/abc')).toBe('https://www.ft.com/content/abc'); // already direct
    expect(unwrapBingLink('http://www.bing.com/news/apiclick.aspx?ref=x')).toBeNull(); // no target inside
    expect(unwrapBingLink('http://www.bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)')).toBeNull();
    expect(unwrapBingLink('not a url')).toBeNull();
  });

  it('turns an RSS answer into items: publisher link, snippet, time and picture, without aggregator copies', () => {
    const xml = bingXml(
      bingItem('Port strike widens', 'https://www.reuters.com/world/port-strike?utm_source=bing', '<News:Image>https://www.reuters.com/img/port.jpg</News:Image>'),
      bingItem('Same story on MSN', 'https://www.msn.com/en-us/news/other/port-strike/ar-AA1'),
      bingItem('Yahoo copy', 'https://finance.yahoo.com/news/port-strike.html'),
      bingItem('A small trade paper', 'https://smalltrade.example/news/port-strike'),
      '<item><title>No link at all</title></item>',
    );
    const items = parseBingNews(xml, NOW);
    expect(items.map((i) => i.url)).toEqual(['https://www.reuters.com/world/port-strike', 'https://smalltrade.example/news/port-strike']);
    expect(items[0]).toMatchObject({ title: 'Port strike widens', snippet: 'Snippet for Port strike widens', published: '2026-10-04T06:30:00.000Z', image: 'https://www.reuters.com/img/port.jpg' });
    expect(items[1]?.image).toBeUndefined();
  });

  it('an empty or blocked answer is simply no items', () => {
    expect(parseBingNews('<html>captcha</html>', NOW)).toEqual([]);
    expect(parseBingNews(bingXml(), NOW)).toEqual([]);
  });
});

describe('GDELT results', () => {
  const json = (articles: unknown[]) => JSON.stringify({ articles });

  it('turns an article list into items with real URLs, times and pictures', () => {
    const items = parseGdelt(
      json([
        { url: 'https://www.ft.com/content/1', title: 'Tariffs rattle exporters', seendate: '20261004T031500Z', socialimage: 'https://www.ft.com/i.jpg', domain: 'ft.com' },
        { url: 'https://news.google.com/rss/articles/x', title: 'Aggregator', seendate: '20261004T031500Z' },
        { url: 'https://example.org/b', title: 'No time given' },
        { url: 'https://example.org/c', title: '' },
      ]),
      NOW,
    );
    expect(items.map((i) => i.url)).toEqual(['https://www.ft.com/content/1', 'https://example.org/b']);
    expect(items[0]).toMatchObject({ published: '2026-10-04T03:15:00.000Z', image: 'https://www.ft.com/i.jpg', snippet: '' });
    expect(items[1]?.published).toBe(new Date(NOW).toISOString());
  });

  it('a rate-limit message or any other plain text is simply no items', () => {
    expect(parseGdelt('Please limit requests to one every 5 seconds.', NOW)).toEqual([]);
    expect(parseGdelt('{"articles": "nope"}', NOW)).toEqual([]);
    expect(parseGdelt('', NOW)).toEqual([]);
  });
});

describe('which search feeds run', () => {
  const search = FEEDS.filter((f) => f.kind === 'search');
  const gdelt = search.filter((f) => f.provider === 'gdelt');
  const bing = search.filter((f) => f.provider === 'bing');

  it('the registry has both providers, with queries for every topic and https URLs', () => {
    expect(gdelt.length).toBeGreaterThanOrEqual(8);
    expect(bing.length).toBeGreaterThanOrEqual(25);
    for (const f of search) {
      expect(f.url, f.id).toMatch(/^https:\/\//);
      expect(f.query?.length, f.id).toBeGreaterThan(5);
      expect(f.hint, f.id).toBeTruthy();
    }
    for (const hint of ['trade', 'startups', 'marketing', 'real_estate', 'crypto', 'ai_tech', 'economics', 'geopolitics', 'georgia']) {
      expect(search.some((f) => f.hint === hint && f.provider === 'bing'), `bing ${hint}`).toBe(true);
    }
    expect(search.filter((f) => f.georgia).every((f) => f.hint === 'georgia')).toBe(true);
  });

  it('the round-robin never puts two GDELT queries in one collect at the usual settings', () => {
    for (const perRun of [15, 20, 25, 30]) {
      const groups = Math.ceil(FEEDS.length / perRun);
      for (let tick = 0; tick < groups; tick++) expect(selectFeedBatch(FEEDS, tick, perRun).filter((f) => f.provider === 'gdelt').length, `perRun ${perRun} tick ${tick}`).toBeLessThanOrEqual(1);
    }
  });

  it('pollable() drops providers that are switched off and keeps at most one GDELT query', () => {
    const two = [gdelt[0], gdelt[1], bing[0], FEEDS[0]] as FeedRef[];
    expect(pollable(two, new Set(['bing', 'gdelt'])).map((f) => f.id)).toEqual([gdelt[0]?.id, bing[0]?.id, FEEDS[0]?.id]);
    expect(pollable(two, new Set(['bing'])).map((f) => f.id)).toEqual([bing[0]?.id, FEEDS[0]?.id]);
    expect(pollable(two, new Set()).map((f) => f.id)).toEqual([FEEDS[0]?.id]);
  });

  it('WEB_SEARCH picks the providers: both by default, none for "off"', () => {
    const set = (v?: string) => [...readConfig({ WEB_SEARCH: v } as Env).webSearch].sort();
    expect(set()).toEqual(['bing', 'gdelt']);
    expect(set('gdelt')).toEqual(['gdelt']);
    expect(set('Bing, GDELT')).toEqual(['bing', 'gdelt']);
    expect(set('off')).toEqual([]);
    expect(set('')).toEqual([]);
  });
});

describe('collecting search results', () => {
  afterEach(() => vi.unstubAllGlobals());
  const feed = FEEDS.find((f) => f.provider === 'bing' && f.hint === 'trade') as FeedRef;

  const stub = (seen: string[]) =>
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seen.push(url);
      if (url === feed.url)
        return new Response(bingXml(bingItem('Port strike widens', 'https://www.reuters.com/world/port-strike'), bingItem('A small trade paper on the strike', 'https://smalltrade.example/news/port-strike'), bingItem('Aggregated', 'https://www.msn.com/x')), { status: 200 });
      return new Response('nope', { status: 404 });
    });

  it('credits each result to its own publisher, with the topic hint, and leaves out aggregators', async () => {
    const env = makeEnv();
    stub([]);
    const ctx = { env, now: NOW, cfg: readConfig(env), llm: null, events: [] } as never;
    await collectStage(ctx, 0);
    const got = rows<{ source_id: string; source_name: string; feed_id: string; category_hint: string; via_social: number; georgia: number; url: string }>(env, `SELECT * FROM feed_items WHERE feed_id = ? ORDER BY url`, feed.id);
    expect(got.map((r) => [r.source_id, r.source_name, r.url])).toEqual([
      ['smalltrade.example', 'smalltrade.example', 'https://smalltrade.example/news/port-strike'],
      ['reuters', 'Reuters', 'https://www.reuters.com/world/port-strike'],
    ]);
    expect(got.every((r) => r.category_hint === 'Global Trade' && r.via_social === 0 && r.georgia === 0)).toBe(true);
  });

  it('does not ask a search provider that WEB_SEARCH switches off', async () => {
    const env = makeEnv({ WEB_SEARCH: 'gdelt' });
    const seen: string[] = [];
    stub(seen);
    await collectStage({ env, now: NOW, cfg: readConfig(env), llm: null, events: [] } as never, 0);
    expect(seen.some((u) => u.startsWith('https://www.bing.com/'))).toBe(false);
    expect(seen.filter((u) => u.startsWith('https://api.gdeltproject.org/')).length).toBe(1); // one GDELT query per collect
    expect(seen.some((u) => u.includes('federalreserve.gov'))).toBe(true); // ordinary feeds still run
  });
});
