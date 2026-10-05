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

// Georgian function words and headline filler. Case endings are the one thing Georgian headlines never share, so
// words are matched by their first letters (see stem), which makes a stop list over whole words the right tool.
const KA_STOP = new Set('და რომ არის იყო იქნება ამ ეს ის იმ თუ კი ან არ მისი მათი მის მას ასევე შესახებ შემდეგ წინ წლის დღეს გუშინ ახალი ბოლო ყველა როგორც მაგრამ რადგან სადაც ჯერ უკვე კიდევ მხოლოდ'.split(' '));
const isGeorgian = (w: string): boolean => /[\u10d0-\u10ff]/.test(w);

/** Fold plurals so "ETFs" meets "ETF" and "rates" meets "rate". Georgian words keep their first four letters (the root). */
function stem(w: string): string {
  if (isGeorgian(w)) return w.length > 4 ? w.slice(0, 4) : w;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const clean = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/['’]s\b/g, ''); // "29,000" -> "29000"
  for (const raw of clean.split(/[^a-z0-9.%$€£\u10d0-\u10ff]+/)) {
    const bare = raw.replace(/^[.%]+|[.]+$/g, '');
    if (!bare || /^\d{1,2}$/.test(bare) || /^(19|20)\d\d$/.test(bare)) continue; // bare small numbers and years are noise
    if (bare.length < 3 && !/\d/.test(bare)) continue;
    if (isGeorgian(bare) && KA_STOP.has(bare)) continue;
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
  // Tokens become small integers so the counting below runs on typed arrays: this stage has ~10 ms of CPU on Workers Free.
  const intern = new Map<string, number>();
  const toks: number[][] = items.map((i) => {
    const ids: number[] = [];
    for (const t of tokens(i.title)) {
      let id = intern.get(t);
      if (id === undefined) {
        id = intern.size;
        intern.set(t, id);
      }
      ids.push(id);
    }
    return ids;
  });
  const m = intern.size;
  const df = new Int32Array(m);
  for (const ts of toks) for (const t of ts) df[t]!++;
  const weight = new Float64Array(m);
  for (let t = 0; t < m; t++) weight[t] = Math.log(1 + n / (df[t] as number));
  const total = toks.map((ts) => ts.reduce((sum, t) => sum + (weight[t] as number), 0));

  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };

  // Inverted index: only compare items that share a token. `stamp` says which item last touched an accumulator slot.
  const index: number[][] = Array.from({ length: m }, () => []);
  const stamp = new Int32Array(n).fill(-1);
  const shared = new Int32Array(n);
  const sharedWeight = new Float64Array(n);
  const sharedRare = new Int32Array(n);
  for (let j = 0; j < n; j++) {
    const tj = toks[j] as number[];
    const touched: number[] = [];
    for (const t of tj) {
      const d = df[t] as number;
      if (d > GENERIC_DF) continue;
      const seen = index[t] as number[];
      if (seen.length === 0) continue;
      const w = weight[t] as number;
      const rare = d <= RARE_DF ? 1 : 0;
      for (const i of seen) {
        if (stamp[i] === j) {
          shared[i]!++;
          sharedWeight[i]! += w;
          sharedRare[i]! += rare;
        } else {
          stamp[i] = j;
          shared[i] = 1;
          sharedWeight[i] = w;
          sharedRare[i] = rare;
          touched.push(i);
        }
      }
    }
    for (const i of touched) {
      const count = shared[i] as number;
      const old = count >= 3 && count / Math.min(tj.length, (toks[i] as number[]).length) >= 0.4;
      const ratio = (sharedWeight[i] as number) / Math.min(total[j] as number, total[i] as number);
      const weighted = count >= 3 ? ratio >= 0.4 : count === 2 && (sharedRare[i] as number) >= 1 && ratio >= 0.6;
      if (old || weighted) parent[find(j)] = find(i);
    }
    for (const t of tj) (index[t] as number[]).push(j);
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
