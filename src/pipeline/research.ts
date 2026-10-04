// Research Agent: collect -> pool -> cluster -> draft. `collectStage` and `researchStage` are separate
// stages so they can run in separate cron invocations (see run.ts).
//
//  1. Poll a round-robin slice of the registry's feeds (FEEDS_PER_RUN per run).
//  2. Add new items to a rolling pool (feed_items), de-duplicated by normalised URL.
//  3. Cluster the pool by event, in code. A cluster is worth drafting only if it can
//     pass the Fact-Checker's double-sourcing rule (>= 2 independent non-social
//     publishers, or one primary/official source). Corroborating items often arrive in
//     different runs, which is why the pool exists. Most runs end here with no LLM call.
//  4. Ask the LLM to draft one briefing per top cluster, using only the cluster's text.
//     Source links are attached from the items, never taken from the model's output.

import { FEEDS, articleCategoryFor, type FeedRef } from '../registry/sources';
import { resolveSource } from '../registry/trust';
import { SLOT_MS, nowIso } from '../time';
import type { FeedItemRow } from '../types';
import { citationFromItem, linksFromCitations } from './citations';
import { groundChart } from './chart';
import { clusterItems } from './cluster';
import { logEvent, mark, type StageCtx } from './context';
import { importanceScore } from './importance';
import { fetchFeed, sha, type RawItem } from './feeds';
import { RESEARCH_SYSTEM } from './prompts';
import { ResearchOutput } from './schemas';
import { scoreArticle, type Citation } from './scoring';

const MAX_ITEM_AGE_MS = 72 * 3600_000; // ignore very old feed items on ingest
const POOL_WINDOW_MS = 36 * 3600_000; // how long an unused item stays eligible
const POOL_LIMIT = 240; // newest unused items considered for clustering; titles only, so the rows stay small (clustering CPU grows with this)
const MAX_OFFERS = 3; // times an item may be sent to the LLM without becoming an article
const MAX_ITEMS_PER_CLUSTER = 6;
const BASELINE_AGE_MS = 7 * 86_400_000; // first sight of a page feed: mark existing links as old news

/**
 * Stride-interleave so every collect mixes categories; each feed is polled every `groups` ticks,
 * where groups = ceil(feeds / perRun). `tick` is any counter that advances by 1 per collect.
 */
export function selectFeedBatch<T>(feeds: T[], tick: number, perRun: number): T[] {
  const groups = Math.max(1, Math.ceil(feeds.length / perRun));
  const slot = tick % groups;
  return feeds.filter((_, i) => i % groups === slot);
}

export interface ClusterEval {
  citations: Citation[];
  independent: number;
  best: number;
  hasPrimary: boolean;
  eligible: boolean;
  priority: number;
}

/** The article category a cluster most likely belongs to: the hint most of its items carry from the feeds that found them. */
export function hintOf(items: FeedItemRow[]): string | null {
  const tally = new Map<string, number>();
  for (const i of items) if (i.category_hint) tally.set(i.category_hint, (tally.get(i.category_hint) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Even if every claim is backed, can these sources reach the publish threshold? A cluster of two unknown blogs is
 * "double-sourced" but cannot score high enough, so drafting it would only spend model calls on a story that is rejected.
 */
export const canReachThreshold = (ev: ClusterEval, threshold: number): boolean =>
  scoreArticle(ev.citations, { total: 10, supported: 10, contradicted: 0 }, threshold).decision === 'publish';

/**
 * Choose the clusters to draft. Priority decides, but a topic with few recent stories gets a lift (4 for none,
 * 2 for one, 1.3 for two, and so on), and every pick counts against its topic, so a busy news day in one area cannot push
 * everything else off the site. `counts` is the number of stories per article category in the last 24 hours.
 */
export function pickClusters<T extends { items: FeedItemRow[]; ev: ClusterEval }>(candidates: T[], counts: Map<string, number>, n: number): T[] {
  const left = [...candidates];
  const have = new Map(counts);
  const picked: T[] = [];
  while (picked.length < n && left.length) {
    let at = 0;
    let top = Number.NEGATIVE_INFINITY;
    left.forEach((c, i) => {
      const h = hintOf(c.items);
      const score = c.ev.priority + (h ? 4 / (1 + (have.get(h) ?? 0)) : 0);
      if (score > top) {
        top = score;
        at = i;
      }
    });
    const [choice] = left.splice(at, 1) as [T];
    picked.push(choice);
    const h = hintOf(choice.items);
    if (h) have.set(h, (have.get(h) ?? 0) + 1);
  }
  return picked;
}

export function evaluateCluster(items: FeedItemRow[], now: number): ClusterEval {
  const citations = items.map(citationFromItem);
  const solid = citations.filter((c) => !c.social);
  const independent = new Set(solid.map((c) => c.key)).size;
  const best = solid.reduce((m, c) => Math.max(m, c.weight), 0);
  const hasPrimary = best >= 5;
  const newest = items.reduce((m, i) => Math.max(m, Date.parse(i.published_at)), 0);
  const ageHours = Math.max(0, (now - newest) / 3600_000);
  const priority = (hasPrimary ? 3 : 0) + independent + best / 5 + (items.some((i) => i.georgia) ? 0.5 : 0) + Math.max(0, 1 - ageHours / 12);
  return { citations, independent, best, hasPrimary, eligible: solid.length > 0 && (independent >= 2 || hasPrimary), priority };
}

// ─── collect ────────────────────────────────────────────────────────────────

interface IngestRow {
  id: string;
  source_id: string;
  source_name: string;
  feed_id: string;
  title: string;
  url: string;
  snippet: string;
  published_at: string;
  fetched_at: string;
  via_social: number;
  georgia: number;
  category_hint: string | null;
  image: string | null;
}

/**
 * The feeds this tick may poll: search feeds only for the providers WEB_SEARCH allows, and one GDELT query at most
 * (GDELT asks for one request every five seconds; the registry spaces them so the round-robin rarely needs this).
 */
export function pollable(batch: FeedRef[], allowed: ReadonlySet<string>): FeedRef[] {
  let gdelt = 0;
  return batch.filter((f) => {
    if (f.kind !== 'search') return true;
    if (!f.provider || !allowed.has(f.provider)) return false;
    return f.provider !== 'gdelt' || ++gdelt <= 1;
  });
}

const COLLECT_GROUP = 6; // feeds fetched, parsed and stored together; a run cut short keeps the groups it finished

async function collect(ctx: StageCtx, scheduled: FeedRef[]): Promise<{ polled: number; failed: number; fetched: number; inserted: number; searches: number; searchResults: number }> {
  const { env, now, cfg } = ctx;
  const batch = pollable(scheduled, cfg.webSearch);

  const pageFeedIds = batch.filter((f) => f.kind === 'page').map((f) => f.id);
  const known = new Set<string>();
  if (pageFeedIds.length) {
    const { results } = await env.DB.prepare(`SELECT DISTINCT feed_id FROM feed_items WHERE feed_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(pageFeedIds))
      .all<{ feed_id: string }>();
    for (const r of results) known.add(r.feed_id);
  }

  const cutoff = now - MAX_ITEM_AGE_MS;
  const fetchedAt = nowIso(now);
  const seen = new Set<string>();
  let failed = 0;
  let searchResults = 0;
  let fetched = 0;
  let inserted = 0;

  // Workers Free gives each cron run ~10 ms of CPU, so the work is cut into small groups: each is fetched in
  // parallel, parsed, and written before the next starts. A run that is stopped partway has still stored what it did.
  for (let g = 0; g < batch.length; g += COLLECT_GROUP) {
    const group = batch.slice(g, g + COLLECT_GROUP);
    const settled = await Promise.allSettled(group.map((f) => fetchFeed(f, now, cutoff)));
    const rows = new Map<string, IngestRow>();

    for (let i = 0; i < group.length; i++) {
      const feed = group[i] as FeedRef;
      const res = settled[i] as PromiseSettledResult<RawItem[]>;
      if (res.status === 'rejected') {
        failed++;
        logEvent(ctx, { articleId: null, stage: 'feed', outcome: 'error', detail: { feed: feed.id, url: feed.url, error: String(res.reason?.message ?? res.reason) } });
        continue;
      }
      const baseline = feed.kind === 'page' && !known.has(feed.id);
      for (const it of res.value) {
        let published = Date.parse(it.published);
        if (baseline) published = now - BASELINE_AGE_MS;
        else if (published < cutoff) continue;
        else if (published > now) published = now;
        const id = await sha(it.url);
        if (seen.has(id)) continue;
        seen.add(id);
        // A search result is credited to the publisher it came from (a registered outlet, or just its domain), not to the search.
        const found = feed.kind === 'search' ? resolveSource(it.url) : null;
        if (found) searchResults++;
        rows.set(id, {
          id,
          source_id: found ? found.key : feed.source.id,
          source_name: found ? found.name : feed.source.name,
          feed_id: feed.id,
          title: it.title,
          url: it.url,
          snippet: it.snippet,
          published_at: nowIso(published),
          fetched_at: fetchedAt,
          via_social: found ? 0 : feed.source.social ? 1 : 0,
          georgia: (feed.georgia ?? feed.source.georgia) ? 1 : 0,
          category_hint: feed.hint ? articleCategoryFor(feed.hint) : null,
          image: it.image ?? null,
        });
      }
    }

    fetched += rows.size;
    if (rows.size) inserted += await storeItems(env, [...rows.values()], fetchedAt);
    await mark(ctx, `collect ${Math.min(g + COLLECT_GROUP, batch.length)}/${batch.length} feeds, ${inserted} new items`);
  }
  return { polled: batch.length, failed, fetched, inserted, searches: batch.filter((f) => f.kind === 'search').length, searchResults };
}

/** Add new items to the pool (one statement), then their pictures (one more, only when there are any). Returns the number of new items. */
async function storeItems(env: StageCtx['env'], list: IngestRow[], fetchedAt: string): Promise<number> {
  const out = await env.DB.prepare(
    `INSERT OR IGNORE INTO feed_items (id, source_id, source_name, feed_id, title, url, snippet, published_at, fetched_at, via_social, georgia, category_hint)
     SELECT json_extract(value,'$.id'), json_extract(value,'$.source_id'), json_extract(value,'$.source_name'), json_extract(value,'$.feed_id'),
            json_extract(value,'$.title'), json_extract(value,'$.url'), json_extract(value,'$.snippet'), json_extract(value,'$.published_at'),
            json_extract(value,'$.fetched_at'), json_extract(value,'$.via_social'), json_extract(value,'$.georgia'), json_extract(value,'$.category_hint')
     FROM json_each(?1)`,
  )
    .bind(JSON.stringify(list))
    .run();
  const inserted = out.meta.changes ?? 0;
  // Pictures only for items that are new; an INSERT OR IGNORE keeps the first one seen.
  if (inserted > 0 && list.some((x) => x.image)) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO item_images (item_id, url)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.image') FROM json_each(?1)
       WHERE json_extract(value,'$.image') IS NOT NULL AND json_extract(value,'$.id') IN (SELECT id FROM feed_items WHERE fetched_at = ?2)`,
    )
      .bind(JSON.stringify(list.filter((x) => x.image).map((x) => ({ id: x.id, image: x.image }))), fetchedAt)
      .run();
  }
  return inserted;
}

// ─── draft ──────────────────────────────────────────────────────────────────

interface Candidate {
  cid: string;
  items: FeedItemRow[];
  ev: ClusterEval;
}

/**
 * Collect: poll this tick's slice of the registry and add new items to the pool. No LLM.
 * In staged mode it runs twice per 5-minute slot (phase 0 at :00, phase 1 at :04), so the
 * counter advances by 2 per slot and every feed is still visited on a regular cycle.
 */
export async function collectStage(ctx: StageCtx, phase = 0): Promise<Record<string, unknown>> {
  const { now, cfg } = ctx;
  const perSlot = cfg.mode === 'staged' ? 2 : 1;
  const tick = Math.floor(now / SLOT_MS) * perSlot + (perSlot === 2 ? phase : 0);
  const batch = selectFeedBatch(FEEDS, tick, cfg.feedsPerRun);
  return { ...(await collect(ctx, batch)), cycleTicks: Math.max(1, Math.ceil(FEEDS.length / cfg.feedsPerRun)) };
}

/** Research: cluster the pool and have the LLM draft briefings for clusters that can pass the gates. */
export async function researchStage(ctx: StageCtx): Promise<Record<string, unknown>> {
  const { env, now, cfg } = ctx;

  // Clustering reads titles only, so the pool query leaves out the (long) snippets; the few items that
  // end up in a cluster get theirs in one more query below.
  const { results: pool } = await env.DB.prepare(
    `SELECT id, source_id, source_name, feed_id, title, url, NULL AS snippet, published_at, fetched_at, via_social, georgia, category_hint, offered_count, article_id
     FROM feed_items WHERE article_id IS NULL AND offered_count < ?1 AND published_at >= ?2
     ORDER BY published_at DESC LIMIT ?3`,
  )
    .bind(MAX_OFFERS, nowIso(now - POOL_WINDOW_MS), POOL_LIMIT)
    .all<FeedItemRow>();

  const { results: recent } = await env.DB.prepare(`SELECT category, COUNT(*) AS n FROM articles WHERE created_at >= ?1 AND status != 'rejected' GROUP BY category`)
    .bind(nowIso(now - 24 * 3600_000))
    .all<{ category: string; n: number }>();
  const eligible = clusterItems(pool)
    .map((items) => ({ items, ev: evaluateCluster(items, now) }))
    .filter((c) => c.ev.eligible && canReachThreshold(c.ev, cfg.publishThreshold))
    .sort((a, b) => b.ev.priority - a.ev.priority);
  const clusters = pickClusters(eligible, new Map(recent.map((r) => [r.category, r.n])), cfg.maxArticlesPerRun)
    .map(
      (c, i): Candidate => ({
        cid: `c${i + 1}`,
        // keep the most credible items if a cluster is large
        items: [...c.items].sort((a, b) => citationFromItem(b).weight - citationFromItem(a).weight).slice(0, MAX_ITEMS_PER_CLUSTER),
        ev: c.ev,
      }),
    );

  const summary = { pool: pool.length, eligibleClusters: clusters.length };
  if (clusters.length === 0) return { ...summary, skipped: 'no cluster can meet the double-sourcing rule yet' };
  if (!ctx.llm) return { ...summary, skipped: 'GEMINI_API_KEY not configured' };

  const { results: extras } = await env.DB.prepare(
    `SELECT f.id, f.snippet, m.url AS image FROM feed_items f LEFT JOIN item_images m ON m.item_id = f.id WHERE f.id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify(clusters.flatMap((c) => c.items.map((i) => i.id))))
    .all<{ id: string; snippet: string | null; image: string | null }>();
  const extraOf = new Map(extras.map((r) => [r.id, r]));
  for (const c of clusters)
    for (const i of c.items) {
      i.snippet = extraOf.get(i.id)?.snippet ?? null;
      i.image_url = extraOf.get(i.id)?.image ?? null;
    }

  const payload = {
    clusters: clusters.map((c) => ({
      cluster_id: c.cid,
      category_hint: c.items.find((i) => i.category_hint)?.category_hint ?? null,
      items: c.items.map((i) => ({
        id: i.id,
        source: citationFromItem(i).name,
        published_at: i.published_at,
        title: i.title,
        snippet: (i.snippet ?? '').slice(0, 500),
      })),
    })),
  };

  const out = await ctx.llm.json({ system: RESEARCH_SYSTEM, user: JSON.stringify(payload), schema: ResearchOutput, label: 'research' });

  const byCid = new Map(clusters.map((c) => [c.cid, c]));
  const statements: D1PreparedStatement[] = [];
  const used = new Set<string>();
  const created: string[] = [];
  const ts = nowIso(now);

  for (const b of out.briefings) {
    const cand = byCid.get(b.cluster_id);
    if (!cand) continue;
    const members = new Map(cand.items.map((i) => [i.id, i]));
    const ids = [...new Set(b.used_item_ids)].filter((id) => members.has(id));
    const items = ids.map((id) => members.get(id) as FeedItemRow);
    const ev = evaluateCluster(items, now);
    if (items.length === 0 || !ev.eligible || !canReachThreshold(ev, cfg.publishThreshold)) {
      logEvent(ctx, { articleId: null, stage: 'research', outcome: 'skipped', detail: { cluster: b.cluster_id, reason: 'cited items cannot meet the double-sourcing rule or reach the publish threshold' } });
      continue;
    }
    if (created.length >= cfg.maxArticlesPerRun) break;

    const id = `a_${(await sha([...ids].sort().join(','))).slice(0, 16)}`;
    const georgia = b.georgia_related || items.some((i) => i.georgia) ? 1 : 0;
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO articles (id, headline, summary, what_happened, why_it_matters, figures_dates, affected_entities, risks_uncertainty,
           category, georgia_related, source_links, trust_score, grammar_checked, fact_checked, status, published_at, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,0,0,'raw_research',NULL,?12,?12)`,
      ).bind(id, b.headline, b.summary, b.what_happened, b.why_it_matters, b.figures_dates, b.affected_entities, b.risks_uncertainty, b.category, georgia, JSON.stringify(linksFromCitations(ev.citations)), ts),
      env.DB.prepare(`UPDATE feed_items SET article_id = ?1 WHERE article_id IS NULL AND id IN (SELECT value FROM json_each(?2))`).bind(id, JSON.stringify(ids)),
      env.DB.prepare(`INSERT OR IGNORE INTO article_importance (article_id, score, llm, publishers, created_at) VALUES (?1,?2,?3,?4,?5)`).bind(
        id,
        importanceScore({ llm: b.importance, publishers: ev.independent, primary: ev.hasPrimary, georgia: georgia === 1 }),
        b.importance,
        ev.independent,
        ts,
      ),
    );
    // The optional chart is kept only if every number in it is stated by the cited items or the draft.
    const chart = groundChart(
      b.chart,
      // the day each item was published counts as stated: a story about something launched today may date it so
      [...items.map((i) => `${i.title}\n${i.snippet ?? ''}\n${i.published_at.slice(0, 10)}`), b.headline, b.summary, b.what_happened, b.figures_dates].join('\n'),
      now,
    );
    if (chart) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO article_charts (article_id, lang, data, created_at) VALUES (?1, 'en', ?2, ?3)`).bind(id, JSON.stringify(chart), ts));
    } else if (b.chart) {
      logEvent(ctx, { articleId: id, stage: 'research', outcome: 'skipped', detail: { reason: 'chart_not_grounded' } });
    }
    // The story's picture is the one that came with its most credible cited source.
    const lead = [...items].sort((a, b) => citationFromItem(b).weight - citationFromItem(a).weight).find((i) => i.image_url);
    if (lead?.image_url) {
      const c = citationFromItem(lead);
      statements.push(
        env.DB.prepare(`INSERT OR IGNORE INTO article_images (article_id, url, credit, credit_url, weight, created_at) VALUES (?1,?2,?3,?4,?5,?6)`).bind(id, lead.image_url, c.name, lead.url, c.weight, ts),
      );
    }
    ids.forEach((i) => used.add(i));
    created.push(id);
    logEvent(ctx, { articleId: id, stage: 'research', outcome: 'ok', detail: { sources: ev.citations.map((c) => ({ name: c.name, weight: c.weight })), independent: ev.independent } });
  }

  // Everything offered but not used counts as an offer, so stale clusters stop being re-sent.
  const offered = clusters.flatMap((c) => c.items.map((i) => i.id)).filter((id) => !used.has(id));
  if (offered.length) {
    statements.push(env.DB.prepare(`UPDATE feed_items SET offered_count = offered_count + 1 WHERE article_id IS NULL AND id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(offered)));
  }
  if (statements.length) await env.DB.batch(statements);

  return { ...summary, drafted: created.length };
}
