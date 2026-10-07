import { afterEach, describe, expect, it, vi } from 'vitest';
import { numbersPreserved } from '../src/pipeline/numbers';
import { PIPELINE_ORDER, runPipeline } from '../src/pipeline/run';
import { canReachThreshold, evaluateCluster, hintOf, pickClusters, selectFeedBatch, type ClusterEval } from '../src/pipeline/research';
import { FEEDS } from '../src/registry/sources';
import type { ArticleRow, FeedItemRow } from '../src/types';
import { handleApi } from '../src/api';
import { fakeLlm, insertArticle, kaArticle, makeEnv, rows, rss, stubFeeds } from './helpers';

const NOW = Date.parse('2026-10-03T13:15:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toUTCString();

const FED = 'https://www.federalreserve.gov/feeds/press_all.xml';
const COINDESK = 'https://www.coindesk.com/arc/outboundfeeds/rss/';
const THEBLOCK = 'https://www.theblock.co/rss.xml';
const WIRED = 'https://www.wired.com/feed/rss';
const HN = 'https://news.ycombinator.com/rss';
const NBG = 'https://nbg.gov.ge/en/media/news';

afterEach(() => vi.unstubAllGlobals());

describe('end-to-end pipeline: Research -> Edit -> Fact-Check -> Publish/Reject', () => {
  it('publishes primary-sourced and double-sourced stories and leaves the rest', async () => {
    const env = makeEnv();
    stubFeeds({
      [FED]: rss([{ title: 'Federal Reserve issues FOMC statement holding rates at 4.25 percent', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261003a.htm', pub: hoursAgo(2), desc: 'The Committee decided to maintain the target range at 4.25 percent.' }]),
      [COINDESK]: rss([{ title: 'Bitcoin ETFs record $1.2 billion inflows as price tops $120,000', link: 'https://www.coindesk.com/markets/2026/10/03/bitcoin-etf-inflows', pub: hoursAgo(3) }]),
      [THEBLOCK]: rss([{ title: 'Bitcoin ETF inflows reach $1.2 billion, price tops $120,000', link: 'https://www.theblock.co/post/1/bitcoin-etf-inflows', pub: hoursAgo(1) }]),
      [WIRED]: rss([{ title: 'A single-source gadget review nobody else covered', link: 'https://www.wired.com/story/gadget', pub: hoursAgo(1) }]),
      [HN]: rss([{ title: 'Show HN: a social-only rumour about a merger', link: 'https://obscure-blog.example/rumour', pub: hoursAgo(1) }]),
    });
    const llm = fakeLlm();

    const r = await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    expect(r.status).toBe('ok');
    expect(llm.calls).toEqual(['research', 'edit', 'fact_check', 'translate', 'ka_grammar', 'ka_review']);

    const articles = rows<ArticleRow>(env, `SELECT * FROM articles ORDER BY created_at, id`);
    expect(articles).toHaveLength(2);
    // Georgian version exists, was grammar-checked, and the article was published only after that
    const ka = rows<{ article_id: string; grammar_checked: number; headline: string }>(env, `SELECT * FROM article_translations WHERE lang='ka'`);
    expect(ka).toHaveLength(2);
    for (const t of ka) {
      expect(t.grammar_checked).toBe(1);
      expect(t.headline).toContain('ქართული');
    }
    for (const a of articles) {
      expect(a.status).toBe('published');
      expect(a.grammar_checked).toBe(1);
      expect(a.fact_checked).toBe(1);
      expect(a.published_at).toBe('2026-10-03T13:15:00.000Z');
    }
    const fed = articles.find((a) => a.source_links.includes('federalreserve.gov'));
    const btc = articles.find((a) => a.source_links.includes('coindesk.com'));
    expect(fed?.trust_score).toBe(80); // 40 + 5 + 20 + 15
    expect(btc?.trust_score).toBe(68); // 28 + 20 + 5 + 15
    expect(JSON.parse(btc?.source_links ?? '[]').map((l: { trust_score: number }) => l.trust_score)).toEqual([3.5, 3.5]);

    // used items are linked to their article; unrelated and social-only items stay in the pool
    const used = rows<{ n: number }>(env, `SELECT COUNT(*) n FROM feed_items WHERE article_id IS NOT NULL`)[0]?.n;
    const pooled = rows<{ title: string }>(env, `SELECT title FROM feed_items WHERE article_id IS NULL ORDER BY title`).map((x) => x.title);
    expect(used).toBe(3);
    // Hacker News has no feed any more (it answers HTTP 419), so its rumour is never collected
    expect(pooled).toEqual(['A single-source gadget review nobody else covered']);

    // audit trail: breakdown stored for every fact-check decision, feed failures logged
    const audits = rows<{ detail: string }>(env, `SELECT detail FROM pipeline_events WHERE stage='fact_check' AND outcome='ok'`);
    expect(audits).toHaveLength(2);
    expect(JSON.parse(audits[0]?.detail ?? '{}').breakdown).toBeDefined();
    expect(rows<{ n: number }>(env, `SELECT COUNT(*) n FROM pipeline_events WHERE stage='feed' AND outcome='error'`)[0]?.n).toBeGreaterThan(10);
    expect(rows<{ status: string }>(env, `SELECT status FROM pipeline_runs`)[0]?.status).toBe('ok');
  });

  it('makes no LLM call when nothing can meet the double-sourcing rule', async () => {
    const env = makeEnv();
    stubFeeds({ [WIRED]: rss([{ title: 'Only one tech outlet has this story today', link: 'https://www.wired.com/story/x', pub: hoursAgo(1) }]) });
    const llm = fakeLlm();
    const r = await runPipeline(env, { trigger: 'cron', now: NOW, llm });
    expect(llm.calls).toEqual([]);
    expect((r.stages.research as { skipped: string }).skipped).toMatch(/double-sourcing/);
  });

  it('corroboration can arrive in a later run (rolling pool)', async () => {
    const env = makeEnv();
    const llm = fakeLlm();
    stubFeeds({ [COINDESK]: rss([{ title: 'Ethereum upgrade goes live reducing fees by 40 percent', link: 'https://www.coindesk.com/eth-upgrade', pub: hoursAgo(4) }]) });
    await runPipeline(env, { trigger: 'cron', now: NOW, llm });
    expect(llm.calls).toEqual([]);

    stubFeeds({
      [COINDESK]: rss([{ title: 'Ethereum upgrade goes live reducing fees by 40 percent', link: 'https://www.coindesk.com/eth-upgrade', pub: hoursAgo(4) }]),
      [THEBLOCK]: rss([{ title: 'Ethereum upgrade is live, cutting fees by 40 percent', link: 'https://www.theblock.co/eth-upgrade', pub: hoursAgo(0.2) }]),
    });
    await runPipeline(env, { trigger: 'cron', now: NOW + 5 * 60_000, llm });
    expect(llm.calls[0]).toBe('research');
    expect(rows<{ status: string }>(env, `SELECT status FROM articles`)[0]?.status).toBe('published');
  });

  it('page feeds: links present on first sight are baseline (old news), new links are fresh', async () => {
    const env = makeEnv();
    const page = (links: string[]) => `<html>${links.map((l) => `<a href="/en/media/news/${l}">Headline for ${l} with enough text</a>`).join('')}</html>`;
    stubFeeds({ [NBG]: page(['old-one', 'old-two']) });
    await runPipeline(env, { trigger: 'cron', now: NOW, llm: fakeLlm() });
    const first = rows<{ published_at: string }>(env, `SELECT published_at FROM feed_items WHERE feed_id LIKE 'national-bank%'`);
    expect(first).toHaveLength(2);
    for (const r of first) expect(Date.parse(r.published_at)).toBeLessThan(NOW - 6 * 86_400_000);

    stubFeeds({ [NBG]: page(['old-one', 'old-two', 'brand-new']) });
    await runPipeline(env, { trigger: 'cron', now: NOW + 5 * 60_000, llm: fakeLlm() });
    const fresh = rows<{ url: string; published_at: string }>(env, `SELECT url, published_at FROM feed_items WHERE url LIKE '%brand-new'`);
    expect(fresh).toHaveLength(1);
    expect(Date.parse(fresh[0]?.published_at ?? '')).toBe(NOW + 5 * 60_000);
  });
});

describe('Editor', () => {
  const draft = (id: string) => insertArticle(makeEnvRef, { id, figures_dates: 'Rate: 4.25 percent', summary: 'The rate is 4.25 percent as of 2026.' });
  let makeEnvRef: ReturnType<typeof makeEnv>;

  it('keeps numbers intact check', () => {
    expect(numbersPreserved('Up 4.25% to 1,200 in 2026', 'In 2026, up 4.25% to 1200')).toBe(true);
    expect(numbersPreserved('Up 4.25%', 'Up 4.5%')).toBe(false);
    expect(numbersPreserved('Up 4.25%', 'Up 4.25% and 3 firms')).toBe(false);
    expect(numbersPreserved('Up 4.25% in 2026', 'Up 4.25%')).toBe(false);
  });

  it('retries an edit that changes a number, then rejects after 3 failed attempts', async () => {
    makeEnvRef = makeEnv();
    const env = makeEnvRef;
    draft('a1');
    const llm = fakeLlm({ edit: (input) => ({ articles: input.articles.map((a: any) => ({ ...a, summary: 'The rate is 9.99 percent as of 2026, said officials today.' })) }) });
    for (let i = 0; i < 3; i++) {
      await runPipeline(env, { trigger: 'manual', stages: ['edit'], now: NOW + i * 300_000, llm });
      expect(rows<{ status: string }>(env, `SELECT status FROM articles`)[0]?.status).toBe('raw_research');
    }
    await runPipeline(env, { trigger: 'manual', stages: ['edit'], now: NOW + 3 * 300_000, llm });
    expect(rows<{ status: string }>(env, `SELECT status FROM articles`)[0]?.status).toBe('rejected');
    const why = rows<{ detail: string }>(env, `SELECT detail FROM pipeline_events WHERE stage='edit' AND outcome='rejected'`)[0]?.detail;
    expect(JSON.parse(why ?? '{}').reason).toBe('editor_failed');
  });

  it('an LLM outage does not burn an article\'s attempts', async () => {
    makeEnvRef = makeEnv();
    const env = makeEnvRef;
    draft('a1');
    const down = { calls: [], json: async () => { throw new Error('Gemini 503: overloaded'); } };
    for (let i = 0; i < 6; i++) {
      const r = await runPipeline(env, { trigger: 'manual', stages: ['edit'], now: NOW + i * 300_000, llm: down });
      expect(r.status).toBe('error');
    }
    expect(rows<{ status: string }>(env, `SELECT status FROM articles`)[0]?.status).toBe('raw_research');
    expect(rows<{ n: number }>(env, `SELECT COUNT(*) n FROM pipeline_events WHERE article_id IS NOT NULL`)[0]?.n).toBe(0);
    // ...and once the LLM is back the article is edited normally
    await runPipeline(env, { trigger: 'manual', stages: ['edit'], now: NOW + 9 * 300_000, llm: fakeLlm() });
    expect(rows<{ status: string }>(env, `SELECT status FROM articles`)[0]?.status).toBe('edited');
  });
});

describe('Fact-Checker', () => {
  const edited = (env: ReturnType<typeof makeEnv>, id: string, links: { url: string; trust_score: number }[]) =>
    insertArticle(env, { id, status: 'edited', grammar_checked: 1, source_links: JSON.stringify(links.map((l) => ({ title: 'T', ...l }))) });

  it('rejects a single non-primary source (double-sourcing) and records why', async () => {
    const env = makeEnv();
    edited(env, 'one', [{ url: 'https://www.reuters.com/a', trust_score: 4.5 }]);
    await runPipeline(env, { trigger: 'manual', stages: ['fact_check'], now: NOW, llm: fakeLlm() });
    const a = rows<ArticleRow>(env, `SELECT * FROM articles`)[0];
    expect(a?.status).toBe('rejected');
    expect(a?.fact_checked).toBe(1);
    expect(a?.published_at).toBeNull();
    const d = JSON.parse(rows<{ detail: string }>(env, `SELECT detail FROM pipeline_events WHERE stage='fact_check'`)[0]?.detail ?? '{}');
    expect(d.reasons).toEqual(['not_double_sourced']);
  });

  it('rejects when the sources contradict the article, even with strong sources', async () => {
    const env = makeEnv();
    edited(env, 'bad', [{ url: 'https://www.federalreserve.gov/x', trust_score: 5 }]);
    const llm = fakeLlm({
      fact_check: (i) => ({ results: i.articles.map((a: any) => ({ id: a.id, claims: [{ claim: 'Rate is 5%', verdict: 'contradicted' }, { claim: 'Ok', verdict: 'supported' }] })) }),
    });
    await runPipeline(env, { trigger: 'manual', stages: ['fact_check'], now: NOW, llm });
    expect(rows<ArticleRow>(env, `SELECT * FROM articles`)[0]?.status).toBe('rejected');
  });

  it('never publishes without the LLM: the article waits', async () => {
    const env = makeEnv();
    edited(env, 'wait', [{ url: 'https://www.federalreserve.gov/x', trust_score: 5 }]);
    const r = await runPipeline(env, { trigger: 'manual', stages: ['fact_check'], now: NOW, llm: null });
    expect(r.status).toBe('ok');
    expect(rows<ArticleRow>(env, `SELECT * FROM articles`)[0]?.status).toBe('edited');
  });

  it('a social link adds nothing: Hacker News + one wire still fails double-sourcing', async () => {
    const env = makeEnv();
    edited(env, 's', [{ url: 'https://news.ycombinator.com/item?id=1', trust_score: 1.5 }, { url: 'https://www.reuters.com/a', trust_score: 4.5 }]);
    await runPipeline(env, { trigger: 'manual', stages: ['fact_check'], now: NOW, llm: fakeLlm() });
    expect(rows<ArticleRow>(env, `SELECT * FROM articles`)[0]?.status).toBe('rejected');
  });
});

describe('orchestration', () => {
  it('expires unpublished drafts older than 24h', async () => {
    const env = makeEnv();
    insertArticle(env, { id: 'old', created_at: '2026-10-02T10:00:00.000Z' });
    insertArticle(env, { id: 'new', created_at: '2026-10-03T12:00:00.000Z' });
    await runPipeline(env, { trigger: 'manual', stages: ['research'], now: NOW, llm: null });
    const s = Object.fromEntries(rows<{ id: string; status: string }>(env, `SELECT id, status FROM articles`).map((r) => [r.id, r.status]));
    expect(s).toEqual({ old: 'rejected', new: 'raw_research' });
  });

  it('a second run of the same stages yields; runs of other stages and crashed runs do not block', async () => {
    const env = makeEnv();
    stubFeeds({});
    const full = PIPELINE_ORDER.join('+');
    env.DB.raw.prepare(`INSERT INTO pipeline_runs (run_id, scope, trigger, started_at, status) VALUES ('live',?,'cron',?,'running')`).run(full, new Date(NOW - 60_000).toISOString());
    expect((await runPipeline(env, { trigger: 'cron', now: NOW, llm: null })).status).toBe('skipped');
    // a different scope (staged crons overlap in time) is not blocked
    expect((await runPipeline(env, { trigger: 'cron', stages: ['edit'], now: NOW, llm: null })).status).toBe('ok');
    // a crashed run (older than the lock window) does not block forever
    env.DB.raw.prepare(`UPDATE pipeline_runs SET started_at = ? WHERE run_id = 'live'`).run(new Date(NOW - 3600_000).toISOString());
    expect((await runPipeline(env, { trigger: 'cron', now: NOW + 1000, llm: null })).status).toBe('ok');
  });

  it('closes a run left running past the lock window as an error and keeps how far it got', async () => {
    const env = makeEnv();
    stubFeeds({});
    const raw = env.DB.raw;
    const add = raw.prepare(`INSERT INTO pipeline_runs (run_id, scope, trigger, started_at, status, stats) VALUES (?, 'collect', 'cron', ?, 'running', ?)`);
    add.run('dead', new Date(NOW - 20 * 60_000).toISOString(), JSON.stringify({ progress: 'collect 6/14 feeds, 31 new items' }));
    add.run('live', new Date(NOW - 60_000).toISOString(), JSON.stringify({ progress: 'collect started' }));
    await runPipeline(env, { trigger: 'cron', stages: ['edit'], now: NOW, llm: null });
    const [dead, live] = ['dead', 'live'].map((id) => rows<{ status: string; stats: string; finished_at: string | null }>(env, `SELECT status, stats, finished_at FROM pipeline_runs WHERE run_id = '${id}'`)[0]);
    expect(dead?.status).toBe('error');
    expect(dead?.finished_at).not.toBeNull();
    expect(JSON.parse(dead?.stats ?? '{}')).toMatchObject({ last_progress: 'collect 6/14 feeds, 31 new items' });
    expect(live?.status).toBe('running'); // a run inside the window is still alive
  });

  it('a collect run stores what it found in groups and notes its progress', async () => {
    const env = makeEnv({ FEEDS_PER_RUN: '400' });
    stubFeeds({ [WIRED]: rss([{ title: 'First story from Wired about robots', link: 'https://www.wired.com/story/robots', pub: hoursAgo(1) }]) });
    const r = await runPipeline(env, { trigger: 'manual', stages: ['collect'], now: NOW, llm: null });
    expect(r.status).toBe('ok');
    expect(rows<{ n: number }>(env, `SELECT COUNT(*) n FROM feed_items WHERE source_id LIKE '%wired%'`)[0]?.n).toBeGreaterThan(0);
  });

  it('round-robin feed batches cover every feed exactly once per cycle', () => {
    const per = 10;
    const groups = Math.ceil(FEEDS.length / per);
    const seen = new Map<string, number>();
    for (let slot = 0; slot < groups; slot++) {
      for (const f of selectFeedBatch(FEEDS, slot, per)) seen.set(f.id, (seen.get(f.id) ?? 0) + 1);
    }
    expect(seen.size).toBe(FEEDS.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(selectFeedBatch(FEEDS, 12345, per).length).toBeLessThanOrEqual(per + 1);
  });
});


describe('optional charts', () => {
  const feeds = () =>
    stubFeeds({
      [FED]: rss([{ title: 'Federal Reserve issues FOMC statement holding rates at 4.25 percent', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261003a.htm', pub: hoursAgo(2), desc: 'The Committee decided to maintain the target range at 4.25 percent.' }]),
      [COINDESK]: rss([{ title: 'Bitcoin ETFs record $1.2 billion inflows as price tops $120,000', link: 'https://www.coindesk.com/markets/2026/10/03/bitcoin-etf-inflows', pub: hoursAgo(3) }]),
      [THEBLOCK]: rss([{ title: 'Bitcoin ETF inflows reach $1.2 billion, price tops $120,000', link: 'https://www.theblock.co/post/1/bitcoin-etf-inflows', pub: hoursAgo(1) }]),
    });
  const briefing = (c: any, charts: unknown[]) => ({
    cluster_id: c.cluster_id,
    headline: `Briefing on: ${c.items[0].title}`.slice(0, 150),
    summary: `Summary of the reporting about ${c.items[0].title}.`.slice(0, 300),
    what_happened: `According to the sources, ${c.items[0].title}. ${c.items[0].snippet ?? ''}`.trim().padEnd(60, '.'),
    why_it_matters: 'This could matter for markets and businesses that depend on the outcome.',
    figures_dates: 'Reported rate: 4.25',
    affected_entities: 'Markets, Investors',
    risks_uncertainty: 'Details may change as more information is confirmed.',
    category: 'Crypto',
    georgia_related: false,
    used_item_ids: c.items.map((i: any) => i.id),
    charts,
  });
  const GOOD = { title: 'Bitcoin ETFs', unit: '', items: [{ label: 'Inflows, $ billion', value: 1.2 }, { label: 'Price, $', value: 120000 }] };
  const SECOND_BAR = { type: 'bar', title: 'Rate and inflows', unit: '', items: [{ label: 'Rate', value: 4.25 }, { label: 'Inflows', value: 1.2 }] };
  const GAUGE = { type: 'gauge', title: 'Reported rate', unit: '%', items: [{ label: 'Rate', value: 4.25 }] };
  const INVENTED = { title: 'Invented', unit: '', items: [{ label: 'A', value: 7 }, { label: 'B', value: 9 }] };
  /** Georgian charts: same types, values and order, translated words. */
  const KA = (a: any) => ({
    ...kaArticle(a),
    charts: (a.charts ?? []).map((c: any) => ({ ...c, title: 'ბიტკოინ ETF', items: c.items.map((i: any) => ({ ...i, label: 'ნიშნული' })) })),
  });

  it('stores grounded charts, translates them, and drops an invented one without touching the article', async () => {
    const env = makeEnv();
    feeds();
    const llm = fakeLlm({
      research: (input) => ({ briefings: input.clusters.map((c: any) => briefing(c, [c.items[0].title.includes('Bitcoin') ? GOOD : INVENTED])) }),
      translate: (input) => ({ articles: input.articles.map(KA) }),
    });
    const r = await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    expect(r.status).toBe('ok');

    const articles = rows<ArticleRow>(env, `SELECT * FROM articles`);
    expect(articles.map((a) => a.status)).toEqual(['published', 'published']); // the invented chart cost the Fed story nothing
    const btc = articles.find((a) => a.source_links.includes('coindesk.com'))?.id;
    const charts = rows<{ article_id: string; lang: string; data: string }>(env, `SELECT * FROM article_charts ORDER BY lang`);
    expect(charts.map((c) => [c.article_id, c.lang])).toEqual([[btc, 'en'], [btc, 'ka']]);
    expect(JSON.parse(charts[0]?.data ?? '[]')[0].items.map((i: any) => i.value)).toEqual([1.2, 120000]);
    expect(JSON.parse(charts[1]?.data ?? '[]')[0].title).toBe('ბიტკოინ ETF');
    const skipped = rows<{ detail: string }>(env, `SELECT detail FROM pipeline_events WHERE stage = 'research' AND outcome = 'skipped'`);
    expect(skipped.some((e) => e.detail.includes('chart_not_grounded'))).toBe(true);
  });

  it('keeps several graphs of different types for one story, in both languages', async () => {
    const env = makeEnv();
    feeds();
    const llm = fakeLlm({
      // a second bar repeats a type, and the invented donut states figures the sources never gave: both are dropped
      research: (input) => ({ briefings: input.clusters.map((c: any) => briefing(c, [GOOD, SECOND_BAR, GAUGE, { ...INVENTED, type: 'donut' }])) }),
      translate: (input) => ({ articles: input.articles.map(KA) }),
    });
    await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    const stored = rows<{ lang: string; data: string }>(env, `SELECT lang, data FROM article_charts WHERE article_id = (SELECT id FROM articles WHERE source_links LIKE '%coindesk.com%') ORDER BY lang`);
    expect(stored.map((r) => r.lang)).toEqual(['en', 'ka']);
    for (const r of stored) expect(JSON.parse(r.data).map((c: any) => c.type)).toEqual(['bar', 'gauge']);
    const btc = rows<{ id: string }>(env, `SELECT id FROM articles WHERE source_links LIKE '%coindesk.com%'`)[0]?.id;
    const api = (await (await handleApi(new Request(`https://news.test/api/articles/${btc}?lang=ka`), env)).json()) as { charts: { type: string; title: string }[] };
    expect(api.charts.map((c) => c.type)).toEqual(['bar', 'gauge']);
    expect(api.charts[0]?.title).toBe('ბიტკოინ ETF');
  });

  it('the single "chart" field of an older prompt is still accepted', async () => {
    const env = makeEnv();
    feeds();
    const llm = fakeLlm({
      research: (input) => ({ briefings: input.clusters.map((c: any) => ({ ...briefing(c, []), chart: c.items[0].title.includes('Bitcoin') ? GOOD : null })) }),
    });
    await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    expect(rows<{ lang: string }>(env, `SELECT lang FROM article_charts`).map((c) => c.lang)).toEqual(['en']);
  });

  it('a Georgian chart that changes a value is dropped; the translation itself is still stored', async () => {
    const env = makeEnv();
    feeds();
    const llm = fakeLlm({
      research: (input) => ({ briefings: input.clusters.map((c: any) => briefing(c, c.items[0].title.includes('Bitcoin') ? [GOOD] : [])) }),
      translate: (input) => ({ articles: input.articles.map((a: any) => ({ ...KA(a), charts: a.charts.map(() => ({ title: 'ბიტკოინ ETF', unit: '', items: [{ label: 'ა', value: 1.3 }, { label: 'ბ', value: 120000 }] })) })) }),
    });
    await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    expect(rows<{ n: number }>(env, `SELECT COUNT(*) n FROM article_translations WHERE lang = 'ka'`)[0]?.n).toBe(2);
    expect(rows<{ lang: string }>(env, `SELECT lang FROM article_charts`).map((c) => c.lang)).toEqual(['en']);
  });

  it('a malformed chart from the model is ignored instead of failing the briefing', async () => {
    const env = makeEnv();
    feeds();
    const llm = fakeLlm({ research: (input) => ({ briefings: input.clusters.map((c: any) => briefing(c, [{ title: 'x', items: [{ label: 'only one', value: 1 }] }, 'nonsense'])) }) });
    const r = await runPipeline(env, { trigger: 'manual', now: NOW, llm });
    expect(r.status).toBe('ok');
    expect(rows(env, `SELECT 1 FROM articles WHERE status = 'published'`)).toHaveLength(2);
    expect(rows(env, `SELECT 1 FROM article_charts`)).toHaveLength(0);
  });
});

describe('story pictures', () => {
  const FED_PIC = 'https://www.federalreserve.gov/images/fomc.jpg';
  const COINDESK_PIC = 'https://static.coindesk.com/btc.jpg';
  const feeds = () =>
    stubFeeds({
      [FED]: rss([{ title: 'Federal Reserve issues FOMC statement holding rates at 4.25 percent', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261003a.htm', pub: hoursAgo(2), desc: 'The Committee decided to maintain the target range at 4.25 percent.', image: FED_PIC }]),
      [COINDESK]: rss([{ title: 'Bitcoin ETFs record $1.2 billion inflows as price tops $120,000', link: 'https://www.coindesk.com/markets/2026/10/03/bitcoin-etf-inflows', pub: hoursAgo(3), image: COINDESK_PIC }]),
      [THEBLOCK]: rss([{ title: 'Bitcoin ETF inflows reach $1.2 billion, price tops $120,000', link: 'https://www.theblock.co/post/1/bitcoin-etf-inflows', pub: hoursAgo(1) }]),
    });
  const articlesApi = async (env: ReturnType<typeof makeEnv>) =>
    ((await (await handleApi(new Request('https://news.test/api/articles?limit=50'), env)).json()) as { articles: any[] }).articles;

  it('keeps the picture a feed item came with, credits its publisher, and shows it on the story', async () => {
    const env = makeEnv();
    feeds();
    await runPipeline(env, { trigger: 'manual', now: NOW, llm: fakeLlm() });

    expect(rows<{ n: number }>(env, `SELECT COUNT(*) n FROM item_images`)[0]?.n).toBe(2);
    const pics = rows<{ url: string; credit: string; credit_url: string; weight: number }>(env, `SELECT * FROM article_images ORDER BY weight DESC`);
    expect(pics.map((p) => [p.url, p.credit, p.weight])).toEqual([
      [FED_PIC, 'Fed', 5],
      [COINDESK_PIC, 'CoinDesk', 3.5],
    ]);
    expect(pics[0]?.credit_url).toContain('federalreserve.gov');

    const list = await articlesApi(env);
    const fed = list.find((a) => a.sources.some((x: any) => x.url.includes('federalreserve.gov')));
    expect(fed.image).toEqual({ url: FED_PIC, credit: 'Fed', credit_url: pics[0]?.credit_url, kind: 'source' });
  });

  it('SOURCE_PHOTOS=off shows stock photos only; =primary keeps only official sources', async () => {
    const env = makeEnv();
    feeds();
    await runPipeline(env, { trigger: 'manual', now: NOW, llm: fakeLlm() });
    const kinds = async (e: typeof env) => Object.fromEntries((await articlesApi(e)).map((a) => [a.sources.some((x: any) => x.name === 'Fed') ? 'Fed' : 'CoinDesk', a.image.kind]));

    expect(await kinds({ ...env, SOURCE_PHOTOS: 'off' } as typeof env)).toEqual({ Fed: 'stock', CoinDesk: 'stock' });
    expect(await kinds({ ...env, SOURCE_PHOTOS: 'primary' } as typeof env)).toEqual({ Fed: 'source', CoinDesk: 'stock' });
    expect(await kinds({ ...env, SOURCE_PHOTOS: 'nonsense' } as typeof env)).toEqual({ Fed: 'source', CoinDesk: 'source' });
  });

  it('a story whose sources had no picture gets a public-domain stock photo, credited to its photographer', async () => {
    const env = makeEnv();
    stubFeeds({
      [COINDESK]: rss([{ title: 'Bitcoin ETFs record $1.2 billion inflows as price tops $120,000', link: 'https://www.coindesk.com/markets/2026/10/03/bitcoin-etf-inflows', pub: hoursAgo(3) }]),
      [THEBLOCK]: rss([{ title: 'Bitcoin ETF inflows reach $1.2 billion, price tops $120,000', link: 'https://www.theblock.co/post/1/bitcoin-etf-inflows', pub: hoursAgo(1) }]),
    });
    await runPipeline(env, { trigger: 'manual', now: NOW, llm: fakeLlm() });
    expect(rows(env, `SELECT 1 FROM article_images`)).toHaveLength(0);
    const [a] = await articlesApi(env);
    expect(a.image.kind).toBe('stock');
    expect(a.image.url).toMatch(/^https:\/\/thumb\.wikimedia\.org\//);
    expect(a.image.credit).toMatch(/ \/ Wikimedia Commons$/);
    expect(a.image.credit_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect((await articlesApi(env))[0].image).toEqual(a.image); // the same story keeps the same photo
  });
});

describe('what gets drafted: balanced topics, reachable scores, importance', () => {
  const item = (url: string, hint: string | null = null, title = 'A story'): FeedItemRow =>
    ({ id: url, source_id: new URL(url).hostname, source_name: '', feed_id: 'f', title, url, snippet: null, published_at: new Date(NOW - 3600_000).toISOString(), fetched_at: '', via_social: 0, georgia: 0, category_hint: hint, offered_count: 0, article_id: null }) as FeedItemRow;
  const cand = (priority: number, hint: string | null) => ({ items: [item(`https://x.example/${priority}`, hint)], ev: { priority } as unknown as ClusterEval });

  it('hintOf is the topic most of a cluster\'s items came in under', () => {
    expect(hintOf([item('https://a.example/1', 'Crypto'), item('https://b.example/1', 'Crypto'), item('https://c.example/1', 'Economics')])).toBe('Crypto');
    expect(hintOf([item('https://a.example/1')])).toBeNull();
  });

  it('a topic with few recent stories is lifted, and every pick counts against its topic', () => {
    const cs = [cand(6, 'Geopolitics'), cand(5.5, 'Geopolitics'), cand(4, 'Global Trade'), cand(3.5, 'VC & Startups'), cand(3, null)];
    const picked = pickClusters(cs, new Map([['Geopolitics', 10]]), 3);
    expect(picked.map((c) => c.ev.priority)).toEqual([4, 3.5, 6]); // trade and startups, which have nothing, ahead of a seventh geopolitics story
    // with nothing published anywhere the strongest story leads, and the second pick moves to another topic
    expect(pickClusters([cand(6, 'Geopolitics'), cand(5.5, 'Geopolitics'), cand(5, 'Crypto')], new Map(), 2).map((c) => c.ev.priority)).toEqual([6, 5]);
    expect(pickClusters(cs, new Map(), 0)).toEqual([]);
    expect(pickClusters([], new Map(), 3)).toEqual([]);
  });

  it('priority alone decides between stories with no topic hint, and fewer candidates than slots is fine', () => {
    expect(pickClusters([cand(2, null), cand(7, null), cand(4, null)], new Map(), 5).map((c) => c.ev.priority)).toEqual([7, 4, 2]);
  });

  it('a cluster that cannot reach the publish threshold even with every claim backed is not worth drafting', () => {
    const ev = (...urls: string[]) => evaluateCluster(urls.map((u) => item(u)), NOW);
    const two = ev('https://blog-a.example/acme', 'https://blog-b.example/acme');
    expect(two.eligible).toBe(true); // double-sourced...
    expect(canReachThreshold(two, 60)).toBe(false); // ...but two unknown blogs top out at 51
    expect(canReachThreshold(ev('https://www.coindesk.com/a', 'https://www.theblock.co/a'), 60)).toBe(true); // 68
    expect(canReachThreshold(ev('https://www.federalreserve.gov/a'), 60)).toBe(true); // an official source on its own
    expect(canReachThreshold(ev('https://www.wsj.com/a', 'https://blog-a.example/acme'), 60)).toBe(true);
    expect(canReachThreshold(two, 50)).toBe(true); // it is the threshold that decides
  });

  const BING = FEEDS.find((f) => f.provider === 'bing' && f.hint === 'trade');
  const acme = (domain: string) => `<item><title>Acme Corp announces record quarterly revenue of 4 billion dollars</title><link>http://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(`https://${domain}/acme-record-revenue`)}</link><description>Acme Corp said revenue reached a record 4 billion dollars.</description><pubDate>${hoursAgo(1)}</pubDate></item>`;
  const bingFeed = (...domains: string[]) => stubFeeds({ [BING?.url ?? '']: `<rss><channel>${domains.map(acme).join('')}</channel></rss>` });

  it('two unknown blogs agreeing do not cost a model call, a wire service joining them does', async () => {
    const env = makeEnv();
    bingFeed('blog-a.example', 'blog-b.example');
    const llm = fakeLlm();
    await runPipeline(env, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm });
    expect(rows(env, `SELECT 1 FROM feed_items WHERE feed_id = ?`, BING?.id)).toHaveLength(2);
    expect(llm.calls).toEqual([]);

    const env2 = makeEnv();
    bingFeed('blog-a.example', 'blog-b.example', 'www.reuters.com');
    const llm2 = fakeLlm();
    await runPipeline(env2, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm: llm2 });
    expect(llm2.calls).toEqual(['research']);
    const a = rows<{ source_links: string }>(env2, `SELECT source_links FROM articles`);
    expect(a).toHaveLength(1);
    expect(JSON.parse(a[0]?.source_links ?? '[]').map((l: { url: string }) => new URL(l.url).hostname).sort()).toEqual(['blog-a.example', 'blog-b.example', 'www.reuters.com']);
  });

  const feedsForTwoTopics = () =>
    stubFeeds({
      [FED]: rss([{ title: 'Federal Reserve issues FOMC statement holding rates at 4.25 percent', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261003a.htm', pub: hoursAgo(2), desc: 'The Committee decided to maintain the target range at 4.25 percent.' }]),
      [COINDESK]: rss([{ title: 'Bitcoin ETFs record $1.2 billion inflows as price tops $120,000', link: 'https://www.coindesk.com/markets/2026/10/03/bitcoin-etf-inflows', pub: hoursAgo(3) }]),
      [THEBLOCK]: rss([{ title: 'Bitcoin ETF inflows reach $1.2 billion, price tops $120,000', link: 'https://www.theblock.co/post/1/bitcoin-etf-inflows', pub: hoursAgo(1) }]),
    });
  const seenTitles = (into: string[]) =>
    fakeLlm({ research: (input) => (into.push(...input.clusters.flatMap((c: any) => c.items.map((i: any) => i.title))), { briefings: [] }) });

  it('with one slot, the topic the site has none of beats the stronger story from a topic it has plenty of', async () => {
    const env = makeEnv({ MAX_ARTICLES_PER_RUN: '1' });
    for (let k = 0; k < 3; k++) insertArticle(env, { id: `eco${k}`, category: 'Economics', status: 'published', fact_checked: 1, created_at: new Date(NOW - 3600_000).toISOString() });
    feedsForTwoTopics();
    const seen: string[] = [];
    await runPipeline(env, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm: seenTitles(seen) });
    expect(seen.some((t) => t.includes('Bitcoin'))).toBe(true);
    expect(seen.some((t) => t.includes('Federal Reserve'))).toBe(false);
  });

  it('on a quiet day the stronger (official) story still goes first', async () => {
    const env = makeEnv({ MAX_ARTICLES_PER_RUN: '1' });
    feedsForTwoTopics();
    const seen: string[] = [];
    await runPipeline(env, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm: seenTitles(seen) });
    expect(seen.some((t) => t.includes('Federal Reserve'))).toBe(true);
    expect(seen.some((t) => t.includes('Bitcoin'))).toBe(false);
  });

  it('the agent\'s rating, the publisher count and the official source become each story\'s importance', async () => {
    const env = makeEnv();
    feedsForTwoTopics();
    const llm = fakeLlm({
      research: (input) => ({
        briefings: input.clusters.map((c: any) => ({
          cluster_id: c.cluster_id, headline: `Briefing on: ${c.items[0].title}`.slice(0, 150), summary: `Summary of the reporting about ${c.items[0].title}.`.slice(0, 300),
          what_happened: `According to the sources, ${c.items[0].title}. ${c.items[0].snippet ?? ''}`.trim().padEnd(60, '.'), why_it_matters: 'This could matter for markets and businesses that depend on the outcome.',
          figures_dates: 'Reported rate: 4.25', affected_entities: 'Markets, Investors', risks_uncertainty: 'Details may change as more information is confirmed.',
          category: 'Economics', georgia_related: false, importance: 80, used_item_ids: c.items.map((i: any) => i.id),
        })),
      }),
    });
    await runPipeline(env, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm });
    const imp = rows<{ score: number; llm: number; publishers: number; source_links: string }>(env, `SELECT i.score, i.llm, i.publishers, a.source_links FROM article_importance i JOIN articles a ON a.id = i.article_id`);
    const byLink = (frag: string) => imp.find((r) => r.source_links.includes(frag));
    expect(byLink('federalreserve.gov')).toMatchObject({ llm: 80, publishers: 1, score: 55 }); // 44 + 3 + 8 official
    expect(byLink('coindesk.com')).toMatchObject({ llm: 80, publishers: 2, score: 56 }); // 44 + 12
  });

  it('a missing or nonsense rating from the model counts as middling instead of failing the briefing', async () => {
    const env = makeEnv();
    feedsForTwoTopics();
    await runPipeline(env, { trigger: 'manual', now: NOW, stages: ['collect', 'research'], llm: fakeLlm() }); // the default handler gives no importance
    expect(rows<{ llm: number }>(env, `SELECT llm FROM article_importance`).map((r) => r.llm)).toEqual([50, 50]);
  });
});
