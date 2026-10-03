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
 * Optional per-story chart. The Research agent picks the type that fits the numbers the sources state:
 *   bar       2+ comparable values            line / area  3+ values over time, oldest first
 *   donut     2+ parts of a whole             treemap      3+ parts, sized by value
 *   funnel    3+ shrinking stages             waterfall    a start value, then signed changes
 *   gauge     one value on a scale (`max`)    radial       one percentage
 *   bullet    values against a `target`       radar        3+ metrics on one scale
 *   timeline  2+ dated events or deadlines the sources state, oldest first (each item has a `date`)
 * A malformed chart is dropped (`.catch(null)`) rather than sinking the whole briefing.
 */
export const CHART_TYPES = ['bar', 'line', 'area', 'donut', 'treemap', 'funnel', 'waterfall', 'gauge', 'radial', 'bullet', 'radar', 'timeline'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Fewest items each type needs to say anything. gauge and radial show exactly one value. */
export const MIN_CHART_ITEMS: Record<ChartType, number> = { bar: 2, line: 3, area: 3, donut: 2, treemap: 3, funnel: 3, waterfall: 3, gauge: 1, radial: 1, bullet: 1, radar: 3, timeline: 2 };

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const ChartData = z
  .object({
    type: z.enum(CHART_TYPES).default('bar'),
    title: z.string().trim().min(2).max(90),
    unit: z.string().trim().max(24).default(''),
    /** Top of the scale for gauge, radial and radar (a gauge in % needs none). */
    max: z.number().finite().positive().nullish(),
    items: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(70),
          /** Every type but timeline. */
          value: z.number().finite().optional(),
          target: z.number().finite().nullish(),
          /** Timeline only: the day the event happens or happened, YYYY-MM-DD. */
          date: z.string().regex(ISO_DATE).nullish(),
        }),
      )
      .min(1)
      .max(8),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const n = c.items.length;
    if (n < MIN_CHART_ITEMS[c.type]) fail(`${c.type} needs at least ${MIN_CHART_ITEMS[c.type]} items`);
    if (c.type === 'timeline') {
      if (c.items.some((i) => !i.date)) fail('timeline items each need a date');
      if (c.items.some((x, i) => i > 0 && (x.date ?? '') < (c.items[i - 1]?.date ?? ''))) fail('timeline items must run oldest first');
      return;
    }
    if (c.items.some((i) => i.value === undefined)) fail(`${c.type} items each need a value`);
    if ((c.type === 'gauge' || c.type === 'radial') && n !== 1) fail(`${c.type} shows exactly one value`);
    const values = c.items.map((i) => i.value ?? 0);
    if (['donut', 'treemap', 'funnel', 'radar', 'gauge', 'radial'].includes(c.type) && values.some((v) => v < 0)) fail(`${c.type} cannot show negative values`);
    if (c.type === 'treemap' && values.some((v) => v === 0)) fail('treemap sizes must be above zero');
    if (c.type === 'funnel' && values.some((v, i) => i > 0 && v > (values[i - 1] ?? 0))) fail('funnel stages must not grow');
    if (c.type === 'bullet' && c.items.some((i) => i.target == null)) fail('bullet items each need a target');
  })
  // Past validation every item has a value (a timeline's is unused and zero).
  .transform((c) => ({ ...c, items: c.items.map((i) => ({ ...i, value: i.value ?? 0 })) }));
export type ChartData = z.infer<typeof ChartData>;
const optionalChart = ChartData.nullable().optional().catch(null);

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
        used_item_ids: z.array(z.string()).min(1),
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
  articles: z.array(GeorgianFields.extend({ id: z.string(), chart: optionalChart })).max(10),
});
export type TranslationOutput = z.infer<typeof TranslationOutput>;

export const KaGrammarOutput = z.object({
  articles: z.array(GeorgianFields.extend({ id: z.string(), corrections: z.string().trim().max(800).default('') })).max(10),
});
export type KaGrammarOutput = z.infer<typeof KaGrammarOutput>;
