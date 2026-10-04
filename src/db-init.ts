import { SCHEMA_STATEMENTS } from './schema';
import type { Env } from './types';

// Creates the tables on first use, so a fresh D1 database works without anyone running schema.sql.
// Every statement is CREATE ... IF NOT EXISTS, so repeating it is harmless. One batch per isolate.
const ready = new WeakMap<D1Database, Promise<void>>();

const nameOf = (statement: string): string | undefined => /IF NOT EXISTS\s+(\w+)/i.exec(statement)?.[1];

/** One query when everything exists (the usual case): D1 queries are metered, and each statement of a batch counts. */
async function createMissing(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index')`).all<{ name: string }>();
  const have = new Set(results.map((r) => r.name));
  const missing = SCHEMA_STATEMENTS.filter((s) => {
    const name = nameOf(s);
    return !name || !have.has(name);
  });
  if (missing.length) await env.DB.batch(missing.map((s) => env.DB.prepare(s)));
}

export function ensureSchema(env: Env): Promise<void> {
  let p = ready.get(env.DB);
  if (!p) {
    p = createMissing(env);
    p.catch(() => ready.delete(env.DB)); // a failed attempt must not be cached
    ready.set(env.DB, p);
  }
  return p;
}
