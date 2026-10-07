import { z } from 'zod';
import { ARTICLE_CATEGORIES } from '../types';

// Shared field rules for the briefing text. The Research agent writes these fields,
// the Editor rewrites them, so both validate against the same limits.
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');

// `scale` loosens the length limits for Georgian, whose words and case endings run longer.
const fields = (scale: number) =>
  z.object({
    headline: text(10, Math.round(180 * scale)),
    summary: text(30, Math.round(600 * scale)),
    what_happened: text(40, Math.round(1800 * scale)),
    why_it_matters: text(20, Math.round(1200 * scale)),
    /** One fact per line, "Label: value". */
    figures_dates: optionalText(Math.round(1200 * scale)),
    /** Comma-separated organisations / markets / countries. */
    affected_entities: optionalText(Math.round(500 * scale)),
    risks_uncertainty: text(10, Math.round(1200 * scale)),
  });

/**
 * Optional per-story graphs. The Research agent picks the types that fit what the sources state:
 *   bar / column     2+ comparable values (sideways / upright)       line / area  3+ values over time, oldest first
 *   donut / pie      2+ parts of a whole                              treemap      3+ parts, sized by value
 *   funnel           3+ shrinking stages                              waterfall    a start value, then signed changes
 *   gauge            one value on a scale (`max`)                     radial       one percentage
 *   waffle           one percentage drawn as 100 squares              bullet       values against a `target`
 *   radar            3+ metrics on one scale                          rose         3+ values as petals of a Nightingale rose
 *   parliament       2+ parties with whole seat or vote counts        slope        2+ items with a value `to` a later value (`series` names the two moments)
 *   grouped          2+ items, each with `values` for every `series`  stacked      the same data as parts of each item's total
 *   timeline         2+ dated events or deadlines, oldest first (each item has a `date`)
 *   gantt            2+ periods with a start `date` and an `end` date, earliest start first
 *   network          3+ nodes (organisations, people, markets the sources name) joined by `links` that index the nodes
 * A malformed chart is dropped (`.catch(null)`) rather than sinking the whole briefing.
 */
export const CHART_TYPES = [
  'bar', 'column', 'line', 'area', 'donut', 'pie', 'treemap', 'funnel', 'waterfall', 'gauge', 'radial', 'waffle', 'bullet', 'radar', 'rose', 'parliament',
  'slope', 'grouped', 'stacked', 'timeline', 'gantt', 'network',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Fewest items each type needs to say anything. gauge, radial and waffle show exactly one value. */
export const MIN_CHART_ITEMS: Record<ChartType, number> = {
  bar: 2, column: 2, line: 3, area: 3, donut: 2, pie: 2, treemap: 3, funnel: 3, waterfall: 3, gauge: 1, radial: 1, waffle: 1, bullet: 1, radar: 3, rose: 3, parliament: 2,
  slope: 2, grouped: 2, stacked: 2, timeline: 2, gantt: 2, network: 3,
};

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NON_NEGATIVE: readonly ChartType[] = ['donut', 'pie', 'treemap', 'funnel', 'radar', 'rose', 'parliament', 'gauge', 'radial', 'waffle'];

export const ChartData = z
  .object({
    type: z.enum(CHART_TYPES).default('bar'),
    title: z.string().trim().min(2).max(90),
    unit: z.string().trim().max(24).default(''),
    /** Top of the scale for gauge, radial and radar (a gauge in % needs none). */
    max: z.number().finite().positive().nullish(),
    /** slope: the two moments compared ("2025", "2026"). grouped and stacked: one name per kind of value. */
    series: z.array(z.string().trim().min(1).max(30)).max(4).nullish(),
    items: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(70),
          /** Most types. For a slope, the earlier value. */
          value: z.number().finite().optional(),
          target: z.number().finite().nullish(),
          /** Timeline and gantt: the day the event happens or happened, or the period starts, YYYY-MM-DD. */
          date: z.string().regex(ISO_DATE).nullish(),
          /** Gantt only: the day the period ends. */
          end: z.string().regex(ISO_DATE).nullish(),
          /** Slope only: the later value. */
          to: z.number().finite().nullish(),
          /** Grouped and stacked only: one value per entry of `series`. */
          values: z.array(z.number().finite()).max(4).nullish(),
        }),
      )
      .min(1)
      .max(8),
    /** Network only: edges between items, by position (the first item is 0). */
    links: z.array(z.object({ from: z.number().int().min(0).max(7), to: z.number().int().min(0).max(7), label: z.string().trim().max(30).default('') })).max(10).nullish(),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const n = c.items.length;
    if (n < MIN_CHART_ITEMS[c.type]) fail(`${c.type} needs at least ${MIN_CHART_ITEMS[c.type]} items`);
    switch (c.type) {
      case 'timeline':
      case 'gantt': {
        if (c.items.some((i) => !i.date)) fail(`${c.type} items each need a date`);
        if (c.items.some((x, i) => i > 0 && (x.date ?? '') < (c.items[i - 1]?.date ?? ''))) fail(`${c.type} items must run oldest first`);
        if (c.type === 'gantt' && c.items.some((i) => !i.end || i.end < (i.date ?? ''))) fail('gantt items each need an end date on or after the start');
        return;
      }
      case 'network': {
        const links = c.links ?? [];
        if (links.length < 1) fail('network needs at least one link');
        const seen = new Set<string>();
        for (const l of links) {
          if (l.from >= n || l.to >= n || l.from === l.to) fail('network links must join two different items');
          const key = [l.from, l.to].sort().join('-');
          if (seen.has(key)) fail('network links must not repeat');
          seen.add(key);
        }
        return;
      }
      case 'grouped':
      case 'stacked': {
        const k = c.series?.length ?? 0;
        if (k < 2) fail(`${c.type} needs two to four series`);
        if (c.items.some((i) => !i.values || i.values.length !== k || i.values.some((v) => v < 0))) fail(`${c.type} items each need one non-negative value per series`);
        return;
      }
      default:
        break;
    }
    if (c.items.some((i) => i.value === undefined)) fail(`${c.type} items each need a value`);
    if (c.type === 'slope') {
      if (c.series?.length !== 2) fail('slope needs two series names');
      if (c.items.some((i) => i.to == null)) fail('slope items each need a "to" value');
    }
    if ((c.type === 'gauge' || c.type === 'radial' || c.type === 'waffle') && n !== 1) fail(`${c.type} shows exactly one value`);
    const values = c.items.map((i) => i.value ?? 0);
    if (NON_NEGATIVE.includes(c.type) && values.some((v) => v < 0)) fail(`${c.type} cannot show negative values`);
    if (c.type === 'waffle' && (c.unit.trim() !== '%' || values.some((v) => v > 100))) fail('waffle shows a percentage');
    if (c.type === 'treemap' && values.some((v) => v === 0)) fail('treemap sizes must be above zero');
    if (c.type === 'funnel' && values.some((v, i) => i > 0 && v > (values[i - 1] ?? 0))) fail('funnel stages must not grow');
    if (c.type === 'bullet' && c.items.some((i) => i.target == null)) fail('bullet items each need a target');
    if (c.type === 'parliament' && (values.some((v) => !Number.isInteger(v) || v <= 0) || values.reduce((t, v) => t + v, 0) > 1000)) fail('parliament needs whole positive counts');
  })
  // Past validation every item has a value (the unused one of a timeline, gantt, network, grouped or stacked chart is zero).
  .transform((c) => ({ ...c, items: c.items.map((i) => ({ ...i, value: i.value ?? 0 })) }));
export type ChartData = z.infer<typeof ChartData>;
const optionalChart = ChartData.nullable().optional().catch(null);

/** A story carries up to this many graphs, each of a different type, each describing a different part of the story. */
export const MAX_CHARTS = 3;

/** The graphs a model proposed. Each is checked on its own: one that is malformed is dropped without sinking the others. */
const chartList = z
  .array(z.unknown())
  .catch([])
  .transform((list) => list.flatMap((c) => { const r = ChartData.safeParse(c); return r.success ? [r.data] : []; }).slice(0, MAX_CHARTS));

/** The graphs stored for a story: a JSON list, or (stories published before there could be several) a single graph. */
export function parseCharts(stored: string | null | undefined): ChartData[] {
  if (!stored) return [];
  try {
    const raw: unknown = JSON.parse(stored);
    return chartList.parse(Array.isArray(raw) ? raw : [raw]);
  } catch {
    return []; // a chart that no longer parses is simply not shown
  }
}

export const BriefingFields = fields(1);
export type BriefingFields = z.infer<typeof BriefingFields>;

export const GeorgianFields = fields(1.8);
export type GeorgianFields = z.infer<typeof GeorgianFields>;

export const ResearchOutput = z.object({
  briefings: z
    .array(
      BriefingFields.extend({
        cluster_id: z.string(),
        category: z.enum(ARTICLE_CATEGORIES),
        georgia_related: z.boolean(),
        /** 0-100: how much the story matters to readers; a missing or invalid value counts as middling. */
        importance: z.number().min(0).max(100).transform(Math.round).catch(50),
        used_item_ids: z.array(z.string()).min(1),
        /** Up to MAX_CHARTS graphs of different types. `chart` (one graph) is still accepted. */
        charts: chartList,
        chart: optionalChart,
      }),
    )
    .max(10),
});
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export const EditorOutput = z.object({
  articles: z.array(BriefingFields.extend({ id: z.string() })).max(10),
});
export type EditorOutput = z.infer<typeof EditorOutput>;

export const FactCheckOutput = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        claims: z
          .array(
            z.object({
              claim: z.string().max(400),
              verdict: z.enum(['supported', 'unsupported', 'contradicted']),
              source_index: z.number().int().nullable().optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .max(10),
});
export type FactCheckOutput = z.infer<typeof FactCheckOutput>;

export const TranslationOutput = z.object({
  articles: z.array(GeorgianFields.extend({ id: z.string(), charts: chartList, chart: optionalChart })).max(10),
});
export type TranslationOutput = z.infer<typeof TranslationOutput>;

export const KaGrammarOutput = z.object({
  articles: z.array(GeorgianFields.extend({ id: z.string(), corrections: z.string().trim().max(800).default('') })).max(10),
});
export type KaGrammarOutput = z.infer<typeof KaGrammarOutput>;

/** The Georgian Proofreader's verdict. It never rewrites: it approves, or quotes what is wrong. */
export const KaReviewOutput = z.object({
  articles: z
    .array(
      z.object({
        id: z.string(),
        ok: z.boolean(),
        problems: z
          .array(z.object({ field: z.string().trim().max(40), text: z.string().trim().max(240), problem: z.string().trim().max(300) }))
          .max(8)
          .default([]),
      }),
    )
    .max(10),
});
export type KaReviewOutput = z.infer<typeof KaReviewOutput>;
