// Pipeline orchestrator.
//
//   Research (collect -> draft) -> Editor (EN) -> Fact-Checker -> Translator (KA)
//     -> Georgian Grammar Checker -> Publish / Reject
//
// Stages are independent modules with one signature (StageCtx -> result), and each one reads its
// work from D1 by article status, so they can run together or in separate invocations.
//
// Two scheduling modes (PIPELINE_MODE):
//   staged (default, fits Workers Free): five cron triggers, one slice of the pipeline each, so every
//     invocation gets its own CPU, subrequest and D1-query budget. An article drafted at :01 is
//     published at :03.
//   single (Workers Paid): one trigger runs every stage in order, every five minutes.

import type { Env } from '../types';
import { nowIso } from '../time';
import { ensureSchema } from '../db-init';
import { loadBudget } from './budget';
import { flushEvents, logEvent, mark, readConfig, type StageCtx } from './context';
import { editStage } from './editor';
import { factCheckStage } from './factcheck';
import { kaGrammarStage } from './kagrammar';
import { DEFAULT_MODEL, LlmBudgetError, createLlm, type Llm } from './llm';
import { publishStage } from './publish';
import { collectStage, researchStage } from './research';
import { translateStage } from './translate';

const STAGES = {
  collect: (c: StageCtx) => collectStage(c, 0),
  collect2: (c: StageCtx) => collectStage(c, 1), // second collect of a staged 5-minute slot
  research: researchStage,
  edit: editStage,
  fact_check: factCheckStage,
  translate: translateStage,
  ka_grammar: kaGrammarStage,
  publish: publishStage,
} satisfies Record<string, (ctx: StageCtx) => Promise<Record<string, unknown>>>;

/** Stages that call Gemini. When the daily budget is used up (or paced out) they skip and their queue waits. */
const LLM_STAGES: ReadonlySet<string> = new Set(['research', 'edit', 'fact_check', 'translate', 'ka_grammar']);

export type StageName = keyof typeof STAGES;
export const STAGE_NAMES = Object.keys(STAGES) as StageName[];

/** The full pipeline in order (used by the single trigger and by POST /api/run). */
export const PIPELINE_ORDER: StageName[] = ['collect', 'research', 'edit', 'fact_check', 'translate', 'ka_grammar', 'publish'];

/** Staged mode: cron expression -> stages. These five expressions must match wrangler.jsonc. */
export const STAGED_CRONS: Record<string, StageName[]> = {
  '*/5 * * * *': ['collect'], //                 :00  poll sources
  '1-59/5 * * * *': ['research', 'edit'], //     :01  draft + copy-edit
  '2-59/5 * * * *': ['fact_check', 'translate'], // :02  verify, translate to Georgian
  '3-59/5 * * * *': ['ka_grammar', 'publish'], //   :03  Georgian grammar check, publish
  '4-59/5 * * * *': ['collect2'], //             :04  poll the next slice of sources
};

export function stagesForCron(mode: string | undefined, cron: string): StageName[] {
  if (mode === 'single') return PIPELINE_ORDER;
  return STAGED_CRONS[cron] ?? PIPELINE_ORDER;
}

// A run of one scope starts every 5 minutes, so a 'running' row older than this is dead: the invocation was stopped
// (CPU limit, restart) before it could finish. Keeping the window under the interval lets the next trigger take over.
const LOCK_WINDOW_MS = 4 * 60_000;
// Repeating passes (PER_TOPIC_PER_RUN in single mode) must end well before the next 5-minute run starts.
const PASS_BUDGET_MS = 3 * 60_000;
const LANES = 9; // the eight topics plus the separate Georgia lane
const cfg_repeats = (ctx: StageCtx): boolean => ctx.cfg.mode === 'single' && ctx.cfg.perTopicPerRun > 0;
const maxPasses = (ctx: StageCtx): number => Math.min(10, Math.ceil((LANES * ctx.cfg.perTopicPerRun) / ctx.cfg.maxArticlesPerRun));
const STALE_AFTER_MS = 24 * 3600_000; // unpublished drafts older than this are dropped as stale
const LOG_RETENTION_MS = 30 * 86_400_000;

export interface RunOptions {
  trigger: 'cron' | 'manual';
  /** Stages to run, in order. Defaults to the whole pipeline. */
  stages?: StageName[];
  now?: number;
  /** Test seam. `undefined` builds the Gemini client from env; `null` means "no LLM". */
  llm?: Llm | null;
}

export interface RunResult {
  runId: string;
  status: 'ok' | 'error' | 'skipped';
  note?: string;
  stages: Record<string, unknown>;
  ms: number;
}

export async function runPipeline(env: Env, opts: RunOptions): Promise<RunResult> {
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const runId = crypto.randomUUID();
  const started = nowIso(now);
  const stages = opts.stages ?? PIPELINE_ORDER;
  const scope = stages.join('+');

  await ensureSchema(env);

  // Rows left 'running' past the lock window belong to invocations that were stopped; say so instead of leaving them open.
  await env.DB.prepare(
    `UPDATE pipeline_runs SET status = 'error', finished_at = ?2,
       stats = json_object('error', 'run did not finish (stopped before its last step)', 'last_progress', json_extract(stats, '$.progress'))
     WHERE status = 'running' AND started_at < ?1`,
  )
    .bind(nowIso(now - LOCK_WINDOW_MS), nowIso())
    .run();

  // Lock: insert our row, then yield to any earlier live run with the same scope.
  await env.DB.prepare(`INSERT INTO pipeline_runs (run_id, scope, trigger, started_at, status) VALUES (?1, ?2, ?3, ?4, 'running')`).bind(runId, scope, opts.trigger, started).run();
  const earlier = await env.DB.prepare(
    `SELECT run_id FROM pipeline_runs WHERE status = 'running' AND scope = ?4 AND started_at >= ?1 AND (started_at < ?2 OR (started_at = ?2 AND run_id < ?3)) LIMIT 1`,
  )
    .bind(nowIso(now - LOCK_WINDOW_MS), started, runId, scope)
    .first<{ run_id: string }>();
  if (earlier) {
    await env.DB.prepare(`UPDATE pipeline_runs SET status = 'ok', finished_at = ?2, stats = ?3 WHERE run_id = ?1`)
      .bind(runId, nowIso(), JSON.stringify({ skipped: 'another run of the same stages is in progress' }))
      .run();
    return { runId, status: 'skipped', note: 'another run of the same stages is in progress', stages: {}, ms: Date.now() - t0 };
  }

  // The daily Gemini call budget (GEMINI_DAILY_CALLS). Failing to read it must not stop the run, so it fails open.
  const mainModel = env.GEMINI_MODEL || DEFAULT_MODEL;
  const budget = opts.llm === undefined && env.GEMINI_API_KEY ? await loadBudget(env, now, mainModel).catch(() => null) : null;
  const ctx: StageCtx = {
    env,
    runId,
    now,
    cfg: readConfig(env),
    llm: opts.llm === undefined ? createLlm(env, fetch, budget) : opts.llm,
    budget,
    events: [],
  };

  const results: Record<string, unknown> = {};
  let failed = false;
  try {
    if (stages.includes('research')) results.housekeeping = await housekeeping(env, now);
    const runStage = async (name: StageName): Promise<boolean> => {
      // Out of budget for now: skip without calling anything. The articles stay queued and the next slot tries again.
      if (budget && LLM_STAGES.has(name) && !budget.allow(mainModel)) {
        results[name] = { skipped: 'daily Gemini call budget used up for now' };
        return true;
      }
      try {
        await mark(ctx, `${name} started`);
        results[name] = await STAGES[name](ctx);
        await budget?.flush(); // count this stage's requests now, in case a later step is stopped before the final flush
        return true;
      } catch (e) {
        await budget?.flush().catch(() => undefined);
        if (e instanceof LlmBudgetError) {
          results[name] = { skipped: `daily Gemini call budget used up for ${e.model}` };
          return true;
        }
        failed = true;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`stage ${name} failed:`, message);
        results[name] = { error: message };
        // Stage-level failure (LLM outage, D1 error). Deliberately not tied to an article,
        // so it never counts against an article's retry budget.
        logEvent(ctx, { articleId: null, stage: name === 'collect2' ? 'collect' : name, outcome: 'error', detail: { error: message } });
        return false;
      }
    };

    // With a per-topic quota in single mode, one pass only drafts MAX_ARTICLES_PER_RUN stories, so the
    // drafting-to-publishing part of the pipeline repeats until every topic has its share, the queues are
    // empty, a stage fails, or the time budget is spent. Anything left over stays queued for the next run.
    const researchAt = stages.indexOf('research');
    if (cfg_repeats(ctx) && researchAt >= 0) {
      for (const name of stages.slice(0, researchAt)) await runStage(name);
      const tail = stages.slice(researchAt);
      const deadline = t0 + PASS_BUDGET_MS;
      let passes = 0;
      while (passes < maxPasses(ctx) && (passes === 0 || Date.now() < deadline)) {
        passes++;
        let idle = true;
        for (const name of tail) {
          const ok = await runStage(name);
          if (!ok) break;
          if (!('skipped' in (results[name] as Record<string, unknown>))) idle = false;
        }
        if (failed || idle) break;
      }
      results.passes = passes;
    } else {
      for (const name of stages) await runStage(name);
    }
  } finally {
    // One flush per invocation: D1 queries are a metered resource on Workers Free.
    await flushEvents(ctx).catch((e) => console.error('event flush failed:', e));
    await budget?.flush().catch((e) => console.error('budget flush failed:', e));
    if (budget) results.gemini = budget.snapshot();
    await env.DB.prepare(`UPDATE pipeline_runs SET status = ?2, finished_at = ?3, stats = ?4 WHERE run_id = ?1`)
      .bind(runId, failed ? 'error' : 'ok', nowIso(), JSON.stringify(results))
      .run()
      .catch((e) => console.error('run finalise failed:', e));
  }
  return { runId, status: failed ? 'error' : 'ok', stages: results, ms: Date.now() - t0 };
}

async function housekeeping(env: Env, now: number): Promise<Record<string, unknown>> {
  const stale = await env.DB.prepare(`UPDATE articles SET status = 'rejected', updated_at = ?1 WHERE status IN ('raw_research','edited') AND created_at < ?2`)
    .bind(nowIso(now), nowIso(now - STALE_AFTER_MS))
    .run();
  const out: Record<string, unknown> = { expired: stale.meta.changes ?? 0 };

  // Once a day (00:00–00:04 UTC) trim operational logs. Articles and feed items are never deleted.
  const d = new Date(now);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() < 5) {
    const cutoff = nowIso(now - LOG_RETENTION_MS);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM pipeline_events WHERE created_at < ?1`).bind(cutoff),
      env.DB.prepare(`DELETE FROM pipeline_runs WHERE started_at < ?1`).bind(cutoff),
    ]);
    out.pruned = true;
  }
  return out;
}
