// How much a story matters, as one 0-100 number used to rank the front page and the Top 10. It is not the trust
// score: a well-sourced footnote can be trustworthy and unimportant. Three signals the pipeline already has:
//   the Research agent's own judgement of the story's reach and consequences (the largest part),
//   how many independent publishers report it (a story everyone covers is a bigger story),
//   whether an official source announced it, and whether it concerns Georgia, which is who the site is for.

const COVERAGE = [0, 10, 40, 65, 85, 100];
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export interface ImportanceInput {
  /** 0-100, from the Research agent. */
  llm: number;
  /** Independent, non-social publishers among the story's sources. */
  publishers: number;
  /** An official or primary source is among them. */
  primary: boolean;
  georgia: boolean;
}

export function importanceScore(i: ImportanceInput): number {
  const coverage = COVERAGE[clamp(Math.round(i.publishers), 0, COVERAGE.length - 1)] ?? 0;
  const raw = 0.55 * clamp(i.llm, 0, 100) + 0.3 * coverage + (i.primary ? 8 : 0) + (i.georgia ? 7 : 0);
  return Math.round(clamp(raw, 0, 100));
}

/** Stories older than the importance column get a stand-in from their trust score, so they still sort sensibly. */
export const fallbackImportance = (trustScore: number): number => Math.round(clamp(trustScore, 0, 100) * 0.6);

/** Importance points a story loses per hour of age when ranking "what matters now". */
export const IMPORTANCE_DECAY_PER_HOUR = 0.8;
