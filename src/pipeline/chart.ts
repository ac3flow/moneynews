// Guards for the optional per-story chart. The chart is LLM output, so it only reaches the
// database if every number in it can be traced back to the text it was drawn from.

import { digitsPreserved } from './numbers';
import type { ChartData } from './schemas';

/** Numeric tokens of a text with thousands separators removed: "1,200" -> "1200", "4.25" -> "4.25". */
const numberTokens = (s: string): string[] => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));

/** "1.50" and "1.5" are the same figure. */
const canon = (n: string): string => {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : n;
};

const MONTH_NAMES = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];

/**
 * A timeline date is accepted when the sources state it: the ISO date itself, or its day, its month
 * (by name, or in a numeric date such as 31/12) and its year. A year the text leaves out is accepted if it is the current or a
 * neighbouring year, because "31 December" in a news item means the coming one.
 */
function dateStated(date: string, text: string, known: Set<string>, nowYear: number): boolean {
  if (text.includes(date)) return true;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dayOk = known.has(canon(String(d)));
  const monthOk = new RegExp(`\\b(?:${MONTH_NAMES[m - 1]})\\b`, 'i').test(text) || new RegExp(`\\b0?${m}[./-]0?${d}\\b|\\b0?${d}[./-]0?${m}\\b`).test(text);
  const yearOk = known.has(canon(String(y))) || Math.abs(y - nowYear) <= 1;
  return dayOk && monthOk && yearOk;
}

/**
 * The English chart written by the Research agent. Kept only when every bar value, target and scale
 * maximum, every timeline date, and every number written inside a label or the title, appears in
 * `sourceText` (the cited items plus the draft). Beyond that, a chart must make sense for its type.
 */
export function groundChart(chart: ChartData | null | undefined, sourceText: string, nowMs: number = Date.now()): ChartData | null {
  if (!chart) return null;
  const known = new Set(numberTokens(sourceText).map(canon));
  const stated = (n: number): boolean => known.has(canon(String(Math.abs(n))));
  const timeline = chart.type === 'timeline';
  const nowYear = new Date(nowMs).getUTCFullYear();

  const labels = new Set<string>();
  for (const item of chart.items) {
    if (timeline) {
      if (!item.date || !dateStated(item.date, sourceText, known, nowYear)) return null; // a date the sources never state
    } else if (!stated(item.value)) return null; // a value the sources never state
    if (item.target != null && !stated(item.target)) return null;
    labels.add(item.label.toLowerCase());
  }
  if (chart.max != null && !stated(chart.max)) return null;
  if (labels.size !== chart.items.length) return null; // duplicate labels
  for (const text of [chart.title, chart.unit, ...chart.items.map((i) => i.label)]) {
    if (!numberTokens(text).every((n) => known.has(canon(n)))) return null; // an invented year or figure
  }

  // Shape rules that need the numbers, not just their count.
  const percent = chart.unit.trim() === '%';
  const total = chart.items.reduce((s, i) => s + i.value, 0);
  switch (chart.type) {
    case 'gauge':
    case 'radial': {
      const top = chart.max ?? (percent ? 100 : null); // a scale is either stated or "percent"
      const value = chart.items[0]?.value ?? 0;
      if (top == null || value > top) return null;
      break;
    }
    case 'donut':
      if (percent && total > 100.5) return null; // shares of a whole cannot exceed it
      break;
    case 'radar':
      if (chart.max != null && chart.items.some((i) => i.value > (chart.max ?? 0))) return null;
      break;
    default:
      break;
  }
  return chart;
}

/**
 * The Georgian chart written by the Translator. Same type, scale, items in the same order,
 * identical values and targets, and any digits inside labels or the title unchanged.
 */
export function groundTranslatedChart(en: ChartData, ka: ChartData | null | undefined): ChartData | null {
  if (!ka || ka.type !== en.type || (ka.max ?? null) !== (en.max ?? null) || ka.items.length !== en.items.length) return null;
  if (!digitsPreserved(en.title, ka.title)) return null;
  for (const [i, item] of en.items.entries()) {
    const k = ka.items[i];
    if (!k || k.value !== item.value || (k.date ?? null) !== (item.date ?? null) || (k.target ?? null) !== (item.target ?? null) || !digitsPreserved(item.label, k.label)) return null;
  }
  return ka;
}
