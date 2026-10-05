// Daily Gemini call budget. Keeps the pipeline under a free-tier (or any chosen) allowance.
//
// Google counts requests per model per day and resets at midnight Pacific time. This budget does the same:
// every HTTP request to Gemini (including a retry) is counted per model in the llm_usage table, and a request is
// refused once the model's budget is used up. The budget is also *paced*: by a given time of the quota day only
// that share of it (plus a small burst) may be spent, so a busy morning cannot use up the allowance and leave the
// evening with nothing. A refused call is not an error: the stage skips and its articles wait in the queue.
//
// GEMINI_DAILY_CALLS     budget for GEMINI_MODEL      (0 or unset = unlimited)
// GEMINI_DAILY_CALLS_KA  budget for GEMINI_MODEL_KA   (0 or unset = unlimited)

import type { Env } from '../types';

export interface Budget {
  /** May one more request to this model be sent right now? */
  allow(model: string): boolean;
  /** Count one request (call this right before sending it). */
  record(model: string): void;
  /** Write the requests counted since the last flush. */
  flush(): Promise<void>;
  snapshot(): { day: string; used: Record<string, number>; limits: Record<string, number> };
}

/** The quota day Google uses (Pacific time) and how much of it has passed (0..1). */
export function quotaDay(now: number): { day: string; fraction: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { day: `${get('year')}-${get('month')}-${get('day')}`, fraction: Math.min(1, minutes / 1440) };
}

/** How many requests may have been spent by now: the elapsed share of the day, plus a burst big enough for one full cycle. */
export const pacedLimit = (limit: number, fraction: number): number => Math.min(limit, Math.floor(limit * fraction) + Math.max(6, Math.ceil(limit * 0.05)));

const whole = (v: string | undefined): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
};

/** Build the budget for this run, or null when no budget is configured. One D1 query. */
export async function loadBudget(env: Env, now: number, mainModel: string): Promise<Budget | null> {
  const mainLimit = whole(env.GEMINI_DAILY_CALLS);
  const kaModel = env.GEMINI_MODEL_KA && env.GEMINI_MODEL_KA !== mainModel ? env.GEMINI_MODEL_KA : null;
  const kaLimit = kaModel ? whole(env.GEMINI_DAILY_CALLS_KA) : 0;
  if (!mainLimit && !kaLimit) return null;

  const limitOf = (model: string): number => (kaModel && model === kaModel ? kaLimit : mainLimit);
  const { day, fraction } = quotaDay(now);
  const { results } = await env.DB.prepare(`SELECT model, calls FROM llm_usage WHERE day = ?1`).bind(day).all<{ model: string; calls: number }>();
  const used = new Map(results.map((r) => [r.model, r.calls]));
  let pending = new Map<string, number>();
  const total = (model: string): number => (used.get(model) ?? 0) + (pending.get(model) ?? 0);

  return {
    allow(model) {
      const limit = limitOf(model);
      return limit === 0 || total(model) < pacedLimit(limit, fraction);
    },
    record(model) {
      pending.set(model, (pending.get(model) ?? 0) + 1);
    },
    async flush() {
      if (pending.size === 0) return;
      const batch = pending;
      pending = new Map();
      for (const [model, n] of batch) used.set(model, (used.get(model) ?? 0) + n);
      await env.DB.batch(
        [...batch].map(([model, n]) =>
          env.DB.prepare(`INSERT INTO llm_usage (day, model, calls) VALUES (?1, ?2, ?3) ON CONFLICT(day, model) DO UPDATE SET calls = calls + excluded.calls`).bind(day, model, n),
        ),
      );
    },
    snapshot() {
      const models = new Set([...used.keys(), ...pending.keys(), mainModel, ...(kaModel ? [kaModel] : [])]);
      return {
        day,
        used: Object.fromEntries([...models].map((m) => [m, total(m)])),
        limits: Object.fromEntries([...models].map((m) => [m, limitOf(m)])),
      };
    },
  };
}
