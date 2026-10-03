// Group pool items that report the same event, so the Fact-Checker's double-sourcing
// rule can be met by items collected in different runs. Cheap and deterministic: it
// runs before any LLM call and decides whether a call is worth making at all.

export interface ClusterInput {
  id: string;
  title: string;
  snippet?: string | null;
}

const STOP = new Set(
  ('a an the and or but of to in on at for from by with as is are was were be been it its this that these those will would could should may might has have had not no new says said say after before over under into out up down more most than about amid per vs via off one two three also just now today us uk ' +
    // words that headlines share without sharing an event
    'who what when how why can his her their they them you your our we he she get take want make look back first last year month day here best top live watch read explained analysis opinion ' +
    'week weekly daily digest update bulletin alert minutes media advisory news latest ' +
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec').split(' '),
);

/** Fold plurals so "ETFs" meets "ETF" and "rates" meets "rate". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const clean = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/['’]s\b/g, ''); // "29,000" -> "29000"
  for (const raw of clean.split(/[^a-z0-9.%$€£]+/)) {
    const bare = raw.replace(/^[.%]+|[.]+$/g, '');
    if (!bare || /^\d{1,2}$/.test(bare) || /^(19|20)\d\d$/.test(bare)) continue; // bare small numbers and years are noise
    if (bare.length < 3 && !/\d/.test(bare)) continue;
    const t = stem(bare);
    if (STOP.has(t)) continue;
    out.add(t);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Same event if they share >= 3 significant title tokens and >= 40% of the shorter title. */
export function sameEvent(a: Set<string>, b: Set<string>): boolean {
  const shared = overlap(a, b);
  if (shared < 3) return false;
  return shared / Math.min(a.size, b.size) >= 0.4;
}

const RARE_DF = 6; // a token in at most this many titles of the pool names a specific thing (a company, a place, a figure)
const GENERIC_DF = 60; // tokens in more titles than this say nothing about which event it is

/**
 * Two publishers rarely word a headline alike, so the rule also uses how distinctive the shared words are:
 * words that are rare in the pool count for more. Three or more shared words need 40% of the shorter
 * headline's weight; exactly two need 60% and at least one of them must be rare ("Stripe", "Parafin").
 */
export function clusterItems<T extends ClusterInput>(items: T[]): T[][] {
  const n = items.length;
  const toks = items.map((i) => tokens(i.title));
  const df = new Map<string, number>();
  for (const ts of toks) for (const t of ts) df.set(t, (df.get(t) ?? 0) + 1);
  const weight = (t: string): number => Math.log(1 + n / (df.get(t) ?? 1));
  const total = toks.map((ts) => [...ts].reduce((s, t) => s + weight(t), 0));

  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };

  // Inverted index: only compare items that share a token (this runs inside a 10 ms CPU budget on Workers Free).
  const index = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const tj = toks[j] as Set<string>;
    const shared = new Map<number, { n: number; w: number; rare: number }>();
    for (const t of tj) {
      if ((df.get(t) ?? 0) > GENERIC_DF) continue;
      const seen = index.get(t);
      if (!seen) continue;
      const w = weight(t);
      const rare = (df.get(t) ?? 0) <= RARE_DF ? 1 : 0;
      for (const i of seen) {
        const s = shared.get(i);
        if (s) {
          s.n++;
          s.w += w;
          s.rare += rare;
        } else shared.set(i, { n: 1, w, rare });
      }
    }
    for (const [i, s] of shared) {
      const old = s.n >= 3 && s.n / Math.min(tj.size, (toks[i] as Set<string>).size) >= 0.4;
      const ratio = s.w / Math.min(total[j] as number, total[i] as number);
      const weighted = s.n >= 3 ? ratio >= 0.4 : s.n === 2 && s.rare >= 1 && ratio >= 0.6;
      if (old || weighted) parent[find(j)] = find(i);
    }
    for (const t of tj) {
      const list = index.get(t);
      if (list) list.push(j);
      else index.set(t, [j]);
    }
  }

  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(item);
    else groups.set(r, [item]);
  });
  return [...groups.values()];
}
