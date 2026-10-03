import { describe, expect, it } from 'vitest';
import { FEEDS, SOURCES, SOURCE_CATEGORIES, W, findSourceByHost, findSourceByName, tierOf } from '../src/registry/sources';
import { registrableDomain, resolveSource } from '../src/registry/trust';

describe('source registry', () => {
  it('has the 14 categories (the 13 from the brief plus geopolitics)', () => {
    expect(SOURCE_CATEGORIES.map((c) => c.id)).toEqual([
      'global_news', 'ai_tech', 'education', 'economics', 'georgia', 'investments', 'crypto',
      'marketing', 'real_estate', 'trade', 'banks', 'startups', 'geopolitics', 'management',
    ]);
  });

  it('resolves every source named in every category', () => {
    const missing: string[] = [];
    for (const c of SOURCE_CATEGORIES) for (const n of c.sources) if (!findSourceByName(n)) missing.push(`${c.id}: ${n}`);
    expect(missing).toEqual([]);
  });

  it('has unique ids and sane weights', () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOURCES) {
      expect(s.weight).toBeGreaterThanOrEqual(1);
      expect(s.weight).toBeLessThanOrEqual(5);
      expect(s.weight * 2).toBe(Math.round(s.weight * 2)); // half-point steps
    }
  });

  it('applies the spec trust tiers to the sources it names', () => {
    const w = (n: string) => findSourceByName(n)?.weight;
    for (const n of ['NBG', 'Fed', 'ECB', 'BoE', 'GeoStat', 'Eurostat', 'BLS', 'BEA', 'SEC', 'EBA', 'FINRA', 'Nature', 'Science', 'arXiv', 'SSRN']) expect(w(n)).toBe(5);
    for (const n of ['Reuters', 'AP']) expect(w(n)).toBe(4.5);
    for (const n of ['Bloomberg', 'FT', 'WSJ', 'CNBC', 'The Economist', 'Nikkei Asia', "Barron's"]) expect(w(n)).toBe(4);
    for (const n of ['TechCrunch', 'MIT Tech Review', 'Wired', 'Ars Technica', 'VentureBeat', 'CoinDesk', 'PitchBook', 'Sifted', 'OpenAI News', 'Anthropic News', 'Google AI Blog', 'NVIDIA Newsroom', 'Microsoft Research Blog']) expect(w(n)).toBe(3.5);
    for (const n of ['Hacker News', 'Reddit', 'X']) expect(w(n)).toBeLessThanOrEqual(2);
    expect(findSourceByName('Hacker News')?.social).toBe(true);
  });

  it('feed definitions are well formed and have stable unique ids', () => {
    expect(FEEDS.length).toBeGreaterThan(50);
    expect(new Set(FEEDS.map((f) => f.id)).size).toBe(FEEDS.length);
    for (const f of FEEDS) {
      expect(() => new URL(f.url)).not.toThrow();
      if (f.kind === 'page') expect(() => new RegExp(f.pattern ?? '')).not.toThrow();
      if (f.kind === 'page') expect(f.pattern).toBeTruthy();
    }
    expect(FEEDS.some((f) => f.source.georgia)).toBe(true);
  });

  it('maps weights to tier labels', () => {
    expect(tierOf(5)).toBe('primary');
    expect(tierOf(4.5)).toBe('wire');
    expect(tierOf(4)).toBe('major');
    expect(tierOf(3.5)).toBe('specialist');
    expect(tierOf(3)).toBe('commentary');
    expect(tierOf(2)).toBe('unclassified');
    expect(tierOf(1.5, true)).toBe('social');
    expect(W.PRIMARY).toBe(5);
  });
});

describe('resolveSource', () => {
  it('uses the registry weight and longest-suffix domain match', () => {
    expect(resolveSource('https://www.reuters.com/markets/x').weight).toBe(4.5);
    expect(resolveSource('https://blogs.nvidia.com/blog/x').name).toBe('NVIDIA Newsroom');
    expect(findSourceByHost('education.ec.europa.eu')?.name).toBe('EU Commission Education');
    expect(findSourceByHost('ec.europa.eu')?.name).toBe('Eurostat');
    expect(resolveSource('https://news.ycombinator.com/item?id=1').social).toBe(true);
  });

  it('treats unregistered official hosts as primary', () => {
    for (const u of ['https://www.consilium.europa.eu/x', 'https://www.moh.gov.ge/x', 'https://www.gov.uk/x', 'https://www.imf.int/x']) {
      expect(resolveSource(u).weight).toBe(5);
    }
  });

  it('scores unknown publishers 2.0, or social when found via a social aggregator', () => {
    expect(resolveSource('https://some-random-blog.example/post')).toMatchObject({ weight: 2, social: false, registered: false });
    expect(resolveSource('https://some-random-blog.example/post', { viaSocial: true })).toMatchObject({ weight: 1.5, social: true });
    // a social link to a known publisher is that publisher, not a social signal
    expect(resolveSource('https://www.coindesk.com/x', { viaSocial: true })).toMatchObject({ weight: 3.5, social: false });
  });

  it('rejects non-http(s) and malformed URLs', () => {
    expect(resolveSource('javascript:alert(1)').weight).toBe(0);
    expect(resolveSource('not a url').weight).toBe(0);
    expect(resolveSource('ftp://reuters.com/x').weight).toBe(0);
  });

  it('computes registrable domains', () => {
    expect(registrableDomain('www.news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('blog.example.com')).toBe('example.com');
    expect(registrableDomain('example.ge')).toBe('example.ge');
  });

  it('every feed is https, every page feed has a valid link pattern, and every hint is a known category', () => {
    const ids = new Set(SOURCE_CATEGORIES.map((c) => c.id));
    for (const f of FEEDS) {
      expect(f.url, f.id).toMatch(/^https:\/\//);
      if (f.kind === 'page') expect(() => new RegExp(f.pattern ?? ''), f.id).not.toThrow();
      if (f.hint) expect(ids.has(f.hint), `${f.id} hint ${f.hint}`).toBe(true);
    }
  });

  it('the owner\'s list is in: well-known feeds, Georgian outlets, and weight-only entries', () => {
    const feedHosts = new Set(FEEDS.map((f) => new URL(f.url).host));
    for (const h of ['feeds.bloomberg.com', 'feeds.content.dowjones.io', 'api.axios.com', 'the-decoder.com', 'cryptoslate.com', 'commercialobserver.com', 'sifted.eu', 'netgazeti.ge', 'www.interpressnews.ge']) expect(feedHosts.has(h), h).toBe(true);
    for (const n of ['Netgazeti', 'Interpressnews', 'Georgia Today', 'Imedi News', 'Kvira', 'Liberali', 'Agenda.ge', 'BM.ge', '1TV', 'Rustavi 2', 'Tabula', 'Presa', 'Business Media']) {
      const src = findSourceByName(n);
      expect(src?.georgia, n).toBe(true);
    }
    // outlets that cannot be polled still carry a weight, so a citation of them is judged correctly
    expect(findSourceByHost('www.quartz.com')?.weight).toBe(W.SPECIALIST);
    expect(findSourceByHost('politico.com')?.weight).toBe(W.MAJOR);
    expect(findSourceByHost('export.gov')?.weight).toBe(W.PRIMARY);
  });

  it('partisan broadcasters are weighted as commentary, not as news wires', () => {
    for (const n of ['Imedi News', '1TV', 'Rustavi 2']) expect(findSourceByName(n)?.weight, n).toBe(W.COMMENTARY);
  });
});
