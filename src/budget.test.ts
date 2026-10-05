import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadBudget, pacedLimit, quotaDay } from '../src/pipeline/budget';
import { LlmBudgetError, createLlm, resetModelFallbacks } from '../src/pipeline/llm';
import { runPipeline } from '../src/pipeline/run';
import { insertArticle, makeEnv, rows } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  resetModelFallbacks();
});

const MAIN = 'gemini-3.5-flash-lite';
// 23:30 Pacific on 2026-10-05 (PDT = UTC-7): the quota day is almost over, so pacing allows almost the whole budget.
const LATE = Date.parse('2026-10-06T06:30:00.000Z');
// 00:00 Pacific on 2026-10-05
const MIDNIGHT = Date.parse('2026-10-05T07:00:00.000Z');

describe('quota day and pacing', () => {
  it('follows Pacific time, where Google resets its quota', () => {
    expect(quotaDay(MIDNIGHT)).toEqual({ day: '2026-10-05', fraction: 0 });
    expect(quotaDay(MIDNIGHT - 60_000).day).toBe('2026-10-04');
    expect(quotaDay(MIDNIGHT + 12 * 3600_000).fraction).toBe(0.5);
  });

  it('allows a burst at the start of the day and the whole budget at its end', () => {
    expect(pacedLimit(800, 0)).toBe(40);
    expect(pacedLimit(800, 0.5)).toBe(440);
    expect(pacedLimit(800, 1)).toBe(800);
    expect(pacedLimit(10, 0)).toBe(6); // always room for one full six-request cycle
    expect(pacedLimit(4, 0)).toBe(4); // never above the budget itself
  });
});

describe('loadBudget', () => {
  it('is null when no budget is configured, so nothing changes by default', async () => {
    expect(await loadBudget(makeEnv(), LATE, MAIN)).toBeNull();
    expect(await loadBudget(makeEnv({ GEMINI_DAILY_CALLS: '0' }), LATE, MAIN)).toBeNull();
  });

  it('counts requests per model, saves them, and a later run sees them', async () => {
    const env = makeEnv({ GEMINI_DAILY_CALLS: '3', GEMINI_MODEL_KA: 'ka-model', GEMINI_DAILY_CALLS_KA: '2' });
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS llm_usage (day TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, model))`).run();
    const b = (await loadBudget(env, LATE, MAIN))!;
    for (let i = 0; i < 3; i++) {
      expect(b.allow(MAIN)).toBe(true);
      b.record(MAIN);
    }
    expect(b.allow(MAIN)).toBe(false);
    expect(b.allow('ka-model')).toBe(true); // separate allowance
    b.record('ka-model');
    await b.flush();
    expect(rows<{ model: string; calls: number }>(env, `SELECT model, calls FROM llm_usage ORDER BY model`)).toEqual([
      { model: 'ka-model', calls: 1 },
      { model: MAIN, calls: 3 },
    ]);

    const again = (await loadBudget(env, LATE + 60_000, MAIN))!;
    expect(again.allow(MAIN)).toBe(false);
    expect(again.snapshot().used).toEqual({ [MAIN]: 3, 'ka-model': 1 });
    // a new quota day starts from zero
    expect((await loadBudget(env, LATE + 3600_000, MAIN))!.allow(MAIN)).toBe(true);
  });
});

describe('Gemini client with a budget', () => {
  const schema = z.object({ ok: z.boolean() });
  const okReply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] }), { status: 200 });
  const fakeBudget = (limits: Record<string, number>) => {
    const used: Record<string, number> = {};
    return {
      used,
      allow: (m: string) => (used[m] ?? 0) < (limits[m] ?? 0),
      record: (m: string) => void (used[m] = (used[m] ?? 0) + 1),
      flush: async () => {},
      snapshot: () => ({ day: 'x', used, limits }),
    };
  };

  it('stops sending once the budget is spent', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => (urls.push(url), okReply())) as unknown as typeof fetch;
    const budget = fakeBudget({ [MAIN]: 2 });
    const llm = createLlm({ GEMINI_API_KEY: 'k' } as never, fetchImpl, budget)!;
    await llm.json({ system: 's', user: 'u', schema, label: 't' });
    await llm.json({ system: 's', user: 'u', schema, label: 't' });
    await expect(llm.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toBeInstanceOf(LlmBudgetError);
    expect(urls).toHaveLength(2);
  });

  it('counts a retry as a request', async () => {
    const replies = [new Response('{"candidates":[{"content":{"parts":[{"text":"not json"}]},"finishReason":"STOP"}]}', { status: 200 }), okReply()];
    const fetchImpl = (async () => replies.shift()) as unknown as typeof fetch;
    const budget = fakeBudget({ [MAIN]: 10 });
    const llm = createLlm({ GEMINI_API_KEY: 'k' } as never, fetchImpl, budget)!;
    await llm.json({ system: 's', user: 'u', schema, label: 't' });
    expect(budget.used[MAIN]).toBe(2);
  });

  it('sends a Georgian request to the default model once the Georgian model is out of budget', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => (urls.push(url), okReply())) as unknown as typeof fetch;
    const budget = fakeBudget({ [MAIN]: 5, 'ka-model': 1 });
    const llm = createLlm({ GEMINI_API_KEY: 'k', GEMINI_MODEL_KA: 'ka-model' } as never, fetchImpl, budget)!;
    await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'ka-model' });
    await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'ka-model' });
    expect(urls[0]).toContain('/models/ka-model:');
    expect(urls[1]).toContain(`/models/${MAIN}:`);
  });
});

describe('pipeline with a spent budget', () => {
  it('skips the Gemini stages, calls nothing, and leaves the stories queued', async () => {
    const env = makeEnv({ GEMINI_API_KEY: 'k', GEMINI_DAILY_CALLS: '800' });
    insertArticle(env, { id: 'queued', status: 'raw_research' });
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS llm_usage (day TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, model))`).run();
    await env.DB.prepare(`INSERT INTO llm_usage (day, model, calls) VALUES (?1, ?2, 800)`).bind(quotaDay(LATE).day, MAIN).run();
    const fetchSpy = vi.fn(async () => okReplyForPipeline());
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runPipeline(env, { trigger: 'manual', stages: ['research', 'edit'], now: LATE });
    expect(r.status).toBe('ok');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((r.stages.edit as Record<string, unknown>).skipped).toMatch(/budget/);
    expect(rows<{ status: string }>(env, `SELECT status FROM articles`)).toEqual([{ status: 'raw_research' }]);
    expect((r.stages.gemini as { used: Record<string, number> }).used[MAIN]).toBe(800);
  });
});

function okReplyForPipeline(): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }), { status: 200 });
}
