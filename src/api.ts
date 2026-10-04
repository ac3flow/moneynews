import { tierOf, type TierId } from './registry/sources';
import { resolveSource } from './registry/trust';
import { ensureSchema } from './db-init';
import { PIPELINE_ORDER, STAGE_NAMES, runPipeline, type StageName } from './pipeline/run';
import { parseLinks } from './pipeline/citations';
import { SLOT_MS, TBILISI_OFFSET_MIN, TIMEZONE, dayRangeUtc, formatSlot, isDate, nextSlot, nowIso, parseSlotMinute, slotRangeUtc, tbilisiDate } from './time';
import { parseCharts } from './pipeline/schemas';
import { stockPhotoFor } from './stock-photos';
import { IMPORTANCE_DECAY_PER_HOUR, fallbackImportance } from './pipeline/importance';
import { ARTICLE_CATEGORIES, type ArticleRow, type Env } from './types';

// ─── tabs ───────────────────────────────────────────────────────────────────
export const TABS = [
  { id: 'top10', label: 'Top 10' },
  { id: 'all', label: 'All' },
  { id: 'georgia', label: 'Georgia Focus' },
  { id: 'ai-tech', label: 'AI & Tech', category: 'AI & Tech' },
  { id: 'economics', label: 'Economics', category: 'Economics' },
  { id: 'crypto', label: 'Crypto', category: 'Crypto' },
  { id: 'real-estate', label: 'Real Estate', category: 'Real Estate' },
  { id: 'global-trade', label: 'Global Trade', category: 'Global Trade' },
  { id: 'geopolitics', label: 'Geopolitics', category: 'Geopolitics' },
  { id: 'vc-startups', label: 'VC & Startups', category: 'VC & Startups' },
] as const;

const PUBLISHED = `status = 'published' AND fact_checked = 1`;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// ─── response helpers ───────────────────────────────────────────────────────
const SECURITY = { 'x-content-type-options': 'nosniff' };

function json(data: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...SECURITY },
  });
}
const fail = (status: number, error: string): Response => json({ error }, status);

// ─── shaping ────────────────────────────────────────────────────────────────
export const LANGS = ['en', 'ka'] as const;
export type Lang = (typeof LANGS)[number];

/** Georgian columns joined in from article_translations (present only for lang=ka queries). */
interface KaColumns {
  k_headline?: string | null;
  k_summary?: string | null;
  k_what_happened?: string | null;
  k_why_it_matters?: string | null;
  k_figures_dates?: string | null;
  k_affected_entities?: string | null;
  k_risks_uncertainty?: string | null;
}
/** The picture a source supplied, joined in from article_images. */
interface ImageColumns {
  img_url?: string | null;
  img_credit?: string | null;
  img_credit_url?: string | null;
  img_weight?: number | null;
  imp_score?: number | null;
}
type Row = ArticleRow & KaColumns & ImageColumns;

/** SOURCE_PHOTOS: 'all' shows the picture a source supplied, 'primary' only one from an official source, 'off' never (stock photos only). */
export type PhotoPolicy = 'all' | 'primary' | 'off';
export const photoPolicy = (env: Pick<Env, 'SOURCE_PHOTOS'>): PhotoPolicy => {
  const v = (env.SOURCE_PHOTOS ?? 'all').trim().toLowerCase();
  return v === 'primary' || v === 'off' ? v : 'all';
};

export interface ImageDto {
  url: string;
  /** Who to credit: the publisher, or the photographer for a stock photo. */
  credit: string;
  /** Where the picture came from: the source's article, or the photo's Wikimedia Commons page. */
  credit_url: string;
  /** 'source' came with one of the story's sources, 'stock' is a public-domain photo chosen by topic. */
  kind: 'source' | 'stock';
}

export interface ArticleDto {
  lang: Lang;
  id: string;
  headline: string;
  summary: string;
  what_happened: string;
  why_it_matters: string;
  figures: { label: string; value: string }[];
  affected_entities: string[];
  risks_uncertainty: string;
  category: string;
  georgia_related: boolean;
  sources: { title: string; url: string; name: string; tier: TierId }[];
  /** 0-100: how much the story matters. Ranks the Top 10 and the front page. */
  importance: number;
  fact_checked: boolean;
  image: ImageDto;
  /** ISO-8601 UTC. The client renders it in Asia/Tbilisi. */
  published_at: string | null;
  rank?: number;
}

export function parseFigures(s: string | null): { label: string; value: string }[] {
  return (s ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      return i > 0 && i < 60 ? { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : { label: '', value: line };
    });
}

function imageOf(r: Row, policy: PhotoPolicy): ImageDto {
  const ok = policy === 'all' || (policy === 'primary' && (r.img_weight ?? 0) >= 5);
  if (ok && r.img_url && /^https:\/\//i.test(r.img_url) && r.img_credit_url && /^https?:\/\//i.test(r.img_credit_url)) {
    return { url: r.img_url, credit: r.img_credit ?? resolveSource(r.img_credit_url).name, credit_url: r.img_credit_url, kind: 'source' };
  }
  const s = stockPhotoFor(r.id, r.category, !!r.georgia_related);
  return { url: s.url, credit: `${s.author} / Wikimedia Commons`, credit_url: s.page, kind: 'stock' };
}

export function toDto(r: Row, rank?: number, lang: Lang = 'en', photos: PhotoPolicy = 'all'): ArticleDto {
  // For lang=ka the joined translation replaces the English text; everything else is shared.
  const ka = lang === 'ka' && r.k_headline != null;
  const v = ka
    ? {
        headline: r.k_headline ?? r.headline,
        summary: r.k_summary ?? r.summary,
        what_happened: r.k_what_happened ?? r.what_happened,
        why_it_matters: r.k_why_it_matters ?? r.why_it_matters,
        figures_dates: r.k_figures_dates ?? null,
        affected_entities: r.k_affected_entities ?? null,
        risks_uncertainty: r.k_risks_uncertainty ?? '',
      }
    : r;
  const dto: ArticleDto = {
    lang: ka ? 'ka' : 'en',
    id: r.id,
    headline: v.headline,
    summary: v.summary,
    what_happened: v.what_happened,
    why_it_matters: v.why_it_matters,
    figures: parseFigures(v.figures_dates),
    affected_entities: (v.affected_entities ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    risks_uncertainty: v.risks_uncertainty ?? '',
    category: (ARTICLE_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'General', // stories filed under a removed topic show as General
    georgia_related: !!r.georgia_related,
    // Only http(s) links ever leave the API, whatever is stored.
    sources: parseLinks(r.source_links)
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => ({
        title: l.title,
        url: l.url,
        name: resolveSource(l.url).name,
        tier: tierOf(l.trust_score, l.trust_score < 2),
      })),
    importance: r.imp_score ?? fallbackImportance(r.trust_score),
    fact_checked: !!r.fact_checked,
    image: imageOf(r, photos),
    published_at: r.published_at,
  };
  if (rank !== undefined) dto.rank = rank;
  return dto;
}

// ─── GET /api/articles ──────────────────────────────────────────────────────
export interface ListQuery {
  lang: Lang;
  tab: string;
  date?: string;
  slot?: number;
  limit: number;
  /** Text search over headline and summary. */
  q?: string;
  before?: { at: string; id: string };
}

export function parseListQuery(sp: URLSearchParams): ListQuery | { error: string } {
  const tab = sp.get('tab') ?? 'all';
  if (!TABS.some((t) => t.id === tab)) return { error: `unknown tab "${tab}"` };

  const lang = sp.get('lang') ?? 'en';
  if (!LANGS.includes(lang as Lang)) return { error: `lang must be one of ${LANGS.join(', ')}` };

  const q: ListQuery = { lang: lang as Lang, tab, limit: DEFAULT_LIMIT };
  const date = sp.get('date');
  if (date) {
    if (!isDate(date)) return { error: 'date must be YYYY-MM-DD (Asia/Tbilisi)' };
    q.date = date;
  }
  const time = sp.get('time');
  if (time) {
    const slot = parseSlotMinute(time);
    if (slot === null) return { error: 'time must be HH:MM, 24-hour (Asia/Tbilisi)' };
    q.slot = slot;
  }
  const text = (sp.get('q') ?? '').trim();
  if (text) {
    if (text.length < 2) return { error: 'q must be at least 2 characters' };
    q.q = text.slice(0, 80);
  }
  const limit = sp.get('limit');
  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (!Number.isFinite(n) || n < 1) return { error: 'limit must be a positive integer' };
    q.limit = Math.min(n, MAX_LIMIT);
  }
  const before = sp.get('before');
  if (before) {
    const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([A-Za-z0-9_-]{1,64})$/.exec(before);
    if (!m) return { error: 'before must be a cursor returned by this API' };
    q.before = { at: m[1] as string, id: m[2] as string };
  }
  return q;
}

/** Tbilisi minute-of-day (0–1439) of published_at. Tbilisi is a fixed UTC+4. */
const MINUTE_OF_DAY = `(CAST(strftime('%H', published_at, '+4 hours') AS INTEGER) * 60 + CAST(strftime('%M', published_at, '+4 hours') AS INTEGER))`;

function filters(q: Pick<ListQuery, 'tab' | 'date' | 'slot'> & { q?: string; lang?: Lang }): { where: string[]; binds: (string | number)[]; bind: (v: string | number) => string } {
  const where: string[] = [PUBLISHED];
  const binds: (string | number)[] = [];
  const bind = (v: string | number): string => {
    binds.push(v);
    return `?${binds.length}`;
  };

  if (q.q) {
    // LIKE with the user's own % and _ escaped. Georgian searches the Georgian text.
    const like = bind(`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const [h, s] = q.lang === 'ka' ? ['t.headline', 't.summary'] : ['a.headline', 'a.summary'];
    where.push(`(${h} LIKE ${like} ESCAPE '\\' OR ${s} LIKE ${like} ESCAPE '\\')`);
  }
  if (q.tab === 'georgia') where.push('georgia_related = 1');
  const cat = TABS.find((t) => t.id === q.tab && 'category' in t);
  if (cat && 'category' in cat) where.push(`category = ${bind(cat.category)}`);

  // Time filters. published_at is stored as UTC ISO-8601.
  if (q.date && q.slot !== undefined) {
    const { start, end } = slotRangeUtc(q.date, q.slot);
    where.push(`published_at >= ${bind(start)} AND published_at < ${bind(end)}`);
  } else if (q.date) {
    const { start, end } = dayRangeUtc(q.date);
    where.push(`published_at >= ${bind(start)} AND published_at < ${bind(end)}`);
  } else if (q.slot !== undefined) {
    where.push(`${MINUTE_OF_DAY} BETWEEN ${bind(q.slot)} AND ${bind(q.slot + SLOT_MS / 60_000 - 1)}`);
  }
  return { where, binds, bind };
}

const KA_COLUMNS = `t.headline AS k_headline, t.summary AS k_summary, t.what_happened AS k_what_happened, t.why_it_matters AS k_why_it_matters,
  t.figures_dates AS k_figures_dates, t.affected_entities AS k_affected_entities, t.risks_uncertainty AS k_risks_uncertainty`;

// Aliased so the picture's columns can never collide with a column the filters name.
const IMG_COLUMNS = 'ai.img_url, ai.img_credit, ai.img_credit_url, ai.img_weight, im.imp_score';
const IMG_JOIN = `LEFT JOIN (SELECT article_id AS img_article_id, url AS img_url, credit AS img_credit, credit_url AS img_credit_url, weight AS img_weight FROM article_images) ai ON ai.img_article_id = a.id
  LEFT JOIN (SELECT article_id AS imp_article_id, score AS imp_score FROM article_importance) im ON im.imp_article_id = a.id`;

/** Georgian reads join the finished translation; a story without one is simply not listed in Georgian. */
function source(lang: Lang): { select: string; from: string } {
  return lang === 'ka'
    ? { select: `a.*, ${KA_COLUMNS}, ${IMG_COLUMNS}`, from: `articles a JOIN article_translations t ON t.article_id = a.id AND t.lang = 'ka' AND t.grammar_checked = 1 ${IMG_JOIN}` }
    : { select: `a.*, ${IMG_COLUMNS}`, from: `articles a ${IMG_JOIN}` };
}

export function buildListSql(q: ListQuery, now: number = Date.now()): { sql: string; binds: (string | number)[] } {
  const { where, binds, bind } = filters(q);
  const { select, from } = source(q.lang);
  if (q.tab === 'top10') {
    // What matters now: importance, minus a little for every hour since publication, so the list turns over
    // without a day-old shock outranking this hour's news. Older stories without an importance row use a stand-in.
    const rank = `COALESCE(im.imp_score, ROUND(trust_score * 0.6)) - ${IMPORTANCE_DECAY_PER_HOUR} * (julianday(${bind(nowIso(now))}) - julianday(published_at)) * 24`;
    return { sql: `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${rank} DESC, published_at DESC, id DESC LIMIT 10`, binds };
  }
  if (q.before) {
    const a = bind(q.before.at);
    const i = bind(q.before.id);
    where.push(`(published_at < ${a} OR (published_at = ${a} AND id < ${i}))`);
  }
  // one extra row tells us whether another page exists
  return { sql: `SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY published_at DESC, id DESC LIMIT ${q.limit + 1}`, binds };
}

async function listArticles(env: Env, sp: URLSearchParams): Promise<Response> {
  const q = parseListQuery(sp);
  if ('error' in q) return fail(400, q.error);
  const { sql, binds } = buildListSql(q);
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Row>();

  const isTop = q.tab === 'top10';
  const page = isTop ? results : results.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextBefore = !isTop && results.length > q.limit && last?.published_at ? `${last.published_at}|${last.id}` : null;

  return json(
    {
      tab: q.tab,
      lang: q.lang,
      timezone: TIMEZONE,
      filter: { date: q.date ?? null, time: q.slot === undefined ? null : formatSlot(q.slot) },
      articles: page.map((r, i) => toDto(r, isTop ? i + 1 : undefined, q.lang, photoPolicy(env))),
      nextBefore,
    },
    200,
    'public, max-age=30, stale-while-revalidate=60',
  );
}

async function getArticle(env: Env, id: string, langParam: string | null): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail(400, 'invalid id');
  const lang = langParam ?? 'en';
  if (!LANGS.includes(lang as Lang)) return fail(400, `lang must be one of ${LANGS.join(', ')}`);
  const { select, from } = source(lang as Lang);
  const row = await env.DB.prepare(`SELECT ${select} FROM ${from} WHERE a.id = ?1 AND ${PUBLISHED}`).bind(id).first<Row>();
  if (!row) return fail(404, 'not found');
  const chartRow = await env.DB.prepare(`SELECT data FROM article_charts WHERE article_id = ?1 AND lang = ?2`).bind(id, lang).first<{ data: string }>();
  const charts = parseCharts(chartRow?.data);
  return json({ article: toDto(row, undefined, lang as Lang, photoPolicy(env)), charts }, 200, 'public, max-age=60');
}

// ─── GET /api/slots ─────────────────────────────────────────────────────────
/** Published-story counts per 5-minute Tbilisi slot for one day: powers the UI's time tape. */
async function slots(env: Env, sp: URLSearchParams): Promise<Response> {
  const tab = sp.get('tab') ?? 'all';
  if (!TABS.some((t) => t.id === tab)) return fail(400, `unknown tab "${tab}"`);
  const date = sp.get('date') ?? tbilisiDate();
  if (!isDate(date)) return fail(400, 'date must be YYYY-MM-DD (Asia/Tbilisi)');

  const { where, binds } = filters({ tab, date });
  const { results } = await env.DB.prepare(`SELECT CAST(${MINUTE_OF_DAY} / 5 AS INTEGER) AS slot, COUNT(*) AS n FROM articles WHERE ${where.join(' AND ')} GROUP BY slot`)
    .bind(...binds)
    .all<{ slot: number; n: number }>();
  return json({ date, timezone: TIMEZONE, slots: Object.fromEntries(results.map((r) => [r.slot, r.n])) }, 200, 'public, max-age=30');
}

// ─── GET /api/meta, /api/status ─────────────────────────────────────────────
async function meta(env: Env): Promise<Response> {
  const [counts, last, run] = await Promise.all([
    env.DB.prepare(`SELECT category, COUNT(*) AS n, SUM(georgia_related) AS g FROM articles WHERE ${PUBLISHED} GROUP BY category`).all<{ category: string; n: number; g: number }>(),
    env.DB.prepare(`SELECT MAX(published_at) AS t FROM articles WHERE ${PUBLISHED}`).first<{ t: string | null }>(),
    // A run that did its work. One that yielded to another run, or was found stopped halfway, says nothing about the site being live.
    env.DB.prepare(`SELECT MAX(finished_at) AS t FROM pipeline_runs WHERE status = 'ok' AND finished_at IS NOT NULL AND COALESCE(stats, '') NOT LIKE '{"skipped"%'`).first<{ t: string | null }>(),
  ]);
  const byCategory: Record<string, number> = Object.fromEntries(ARTICLE_CATEGORIES.map((c) => [c, 0]));
  let total = 0;
  let georgia = 0;
  for (const r of counts.results) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.n;
    total += r.n;
    georgia += r.g ?? 0;
  }
  const now = Date.now();
  return json(
    {
      timezone: TIMEZONE,
      now: nowIso(now),
      nextRunAt: nowIso(nextSlot(now)),
      lastPublishedAt: last?.t ?? null,
      lastRunAt: run?.t ?? null,
      /** False when no Gemini key is configured: the site keeps serving stories but cannot write new ones. */
      writing: !!env.GEMINI_API_KEY,
      counts: { total, georgia, byCategory },
      tabs: TABS.map(({ id, label }) => ({ id, label })),
    },
    200,
    'public, max-age=30',
  );
}

async function status(env: Env): Promise<Response> {
  const since = nowIso(Date.now() - 24 * 3600_000);
  const [run, queue, feedErrors, lastError] = await Promise.all([
    env.DB.prepare(`SELECT run_id, trigger, started_at, finished_at, status, stats FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).first<Record<string, string | null>>(),
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM articles GROUP BY status`).all<{ status: string; n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE stage = 'feed' AND outcome = 'error' AND created_at >= ?1`).bind(since).first<{ n: number }>(),
    // Most recent stage-level failure (e.g. Gemini rejecting the model name), newest first.
    env.DB.prepare(`SELECT stage, detail, created_at FROM pipeline_events WHERE outcome = 'error' AND article_id IS NULL AND stage != 'feed' AND created_at >= ?1 ORDER BY id DESC LIMIT 1`).bind(since).first<{ stage: string; detail: string | null; created_at: string }>(),
  ]);
  let lastErrorOut: { stage: string; at: string; message: string } | null = null;
  if (lastError) {
    let message = 'unknown error';
    try {
      message = String((JSON.parse(lastError.detail ?? '{}') as { error?: string }).error ?? message);
    } catch {
      /* keep the default */
    }
    lastErrorOut = { stage: lastError.stage, at: lastError.created_at, message: message.slice(0, 300) };
  }
  return json({
    ok: run?.status !== 'error',
    llmConfigured: !!env.GEMINI_API_KEY,
    warnings: env.GEMINI_API_KEY ? [] : ['GEMINI_API_KEY is not set, so no new stories can be written. Add it as a Secret in the Worker settings.'],
    lastRun: run ? { startedAt: run.started_at, finishedAt: run.finished_at, status: run.status, trigger: run.trigger } : null,
    articles: Object.fromEntries(queue.results.map((r) => [r.status, r.n])),
    feedErrors24h: feedErrors?.n ?? 0,
    lastError: lastErrorOut,
  });
}

// ─── POST /api/run[/stage] (admin) ──────────────────────────────────────────
async function authorised(req: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_KEY) return false;
  const header = req.headers.get('x-admin-key') ?? /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(header)), crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_KEY))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

// ─── GET /api/admin/events (admin) ──────────────────────────────────────────
/** The audit trail, newest first, so a stage's decisions (what the proofreader quoted, why a story was rejected) can be read. */
async function adminEvents(env: Env, sp: URLSearchParams): Promise<Response> {
  const limit = Math.min(100, Math.max(1, Number.parseInt(sp.get('limit') ?? '30', 10) || 30));
  const { results } = await env.DB.prepare(
    `SELECT id, run_id, article_id, stage, outcome, detail, created_at FROM pipeline_events
     WHERE (?1 IS NULL OR stage = ?1) AND (?2 IS NULL OR outcome = ?2) AND (?3 IS NULL OR article_id = ?3)
     ORDER BY id DESC LIMIT ?4`,
  )
    .bind(sp.get('stage'), sp.get('outcome'), sp.get('article'), limit)
    .all<{ id: number; run_id: string | null; article_id: string | null; stage: string; outcome: string; detail: string | null; created_at: string }>();
  const events = results.map((r) => {
    let detail: unknown = r.detail;
    try {
      detail = r.detail ? JSON.parse(r.detail) : null;
    } catch {
      detail = r.detail?.slice(0, 2000) ?? null;
    }
    return { ...r, detail };
  });
  return json({ events }, 200, 'no-store');
}

// ─── GET /api/admin/runs (admin) ────────────────────────────────────────────
/** Recent pipeline runs, newest first: which stages ran, how long they took, and what each reported. A run still marked 'running' long after it started died mid-way. */
async function adminRuns(env: Env, sp: URLSearchParams): Promise<Response> {
  const limit = Math.min(100, Math.max(1, Number.parseInt(sp.get('limit') ?? '20', 10) || 20));
  const { results } = await env.DB.prepare(
    `SELECT run_id, scope, trigger, started_at, finished_at, status, stats FROM pipeline_runs
     WHERE (?1 IS NULL OR scope = ?1) AND (?2 IS NULL OR status = ?2)
     ORDER BY started_at DESC LIMIT ?3`,
  )
    .bind(sp.get('scope'), sp.get('status'), limit)
    .all<{ run_id: string; scope: string; trigger: string; started_at: string; finished_at: string | null; status: string; stats: string | null }>();
  const runs = results.map((r) => {
    let stats: unknown = r.stats;
    try {
      stats = r.stats ? JSON.parse(r.stats) : null;
    } catch {
      stats = r.stats?.slice(0, 2000) ?? null;
    }
    return { ...r, ms: r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : null, stats };
  });
  return json({ runs }, 200, 'no-store');
}

// ─── router ─────────────────────────────────────────────────────────────────
export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    await ensureSchema(env);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path === '/api/articles') return await listArticles(env, url.searchParams);
      const one = /^\/api\/articles\/([^/]+)$/.exec(path);
      if (one) return await getArticle(env, decodeURIComponent(one[1] as string), url.searchParams.get('lang'));
      if (path === '/api/slots') return await slots(env, url.searchParams);
      if (path === '/api/meta') return await meta(env);
      if (path === '/api/status') return await status(env);
      if (path === '/api/admin/events') return (await authorised(req, env)) ? await adminEvents(env, url.searchParams) : fail(401, 'unauthorized');
      if (path === '/api/admin/runs') return (await authorised(req, env)) ? await adminRuns(env, url.searchParams) : fail(401, 'unauthorized');
    }

    const run = /^\/api\/run(?:\/([a-z_]+))?$/.exec(path);
    if (run) {
      if (req.method !== 'POST') return fail(405, 'use POST');
      if (!(await authorised(req, env))) return fail(401, 'unauthorized');
      const stage = run[1] as StageName | undefined;
      if (stage && !STAGE_NAMES.includes(stage)) return fail(404, `unknown stage "${stage}" (use ${PIPELINE_ORDER.join(', ')})`);
      return json(await runPipeline(env, { trigger: 'manual', stages: stage ? [stage] : undefined }));
    }

    return fail(404, 'not found');
  } catch (e) {
    console.error('api error:', e);
    return fail(500, 'internal error');
  }
}
