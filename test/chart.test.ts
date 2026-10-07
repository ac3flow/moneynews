import { describe, expect, it } from 'vitest';
import { groundChart, groundCharts, groundTranslatedChart, groundTranslatedCharts } from '../src/pipeline/chart';
import { ChartData } from '../src/pipeline/schemas';

const SOURCE = 'Broadcom is lining up a $60 billion financing package. Revenue could reach $115 billion in fiscal 2027 and $230 billion in 2028. Rate 4.25 percent, flows 1,200 million.';
const chart = (items: { label: string; value: number }[], extra: Record<string, unknown> = {}) => ChartData.parse({ title: 'Broadcom AI revenue forecast', unit: '$ billion', items, ...extra });

describe('groundChart (English chart from Research)', () => {
  it('keeps a chart whose values and label numbers all appear in the source text', () => {
    const c = chart([{ label: 'Fiscal 2027', value: 115 }, { label: 'Fiscal 2028', value: 230 }]);
    expect(groundChart(c, SOURCE)).toEqual(c);
  });

  it('matches figures however they are written: 4.250 and 1,200', () => {
    expect(groundChart(chart([{ label: 'Rate', value: 4.25 }, { label: 'Flows', value: 1200 }]), SOURCE)).not.toBeNull();
  });

  it('drops a chart with a value the sources never state, even if only one bar is invented', () => {
    expect(groundChart(chart([{ label: 'Fiscal 2027', value: 115 }, { label: 'Fiscal 2029', value: 460 }]), SOURCE)).toBeNull();
  });

  it('drops a chart whose label or title carries an invented number', () => {
    expect(groundChart(chart([{ label: 'Fiscal 2031', value: 115 }, { label: 'Fiscal 2028', value: 230 }]), SOURCE)).toBeNull();
    expect(groundChart(chart([{ label: 'A', value: 115 }, { label: 'B', value: 230 }], { title: 'Outlook 2040' }), SOURCE)).toBeNull();
  });

  it('drops duplicate labels, and passes nothing through', () => {
    expect(groundChart(chart([{ label: 'Same', value: 115 }, { label: 'same', value: 230 }]), SOURCE)).toBeNull();
    expect(groundChart(null, SOURCE)).toBeNull();
    expect(groundChart(undefined, SOURCE)).toBeNull();
  });

  it('a negative bar is judged by its magnitude', () => {
    expect(groundChart(chart([{ label: 'Down', value: -60 }, { label: 'Up', value: 115 }]), SOURCE)).not.toBeNull();
  });
});

describe('ChartData validation', () => {
  const item = (label: string, value: number, target?: number) => ({ label, value, ...(target === undefined ? {} : { target }) });
  const ok = (c: Record<string, unknown>) => ChartData.safeParse({ title: 'Title', ...c }).success;

  it('defaults to a bar chart and needs finite numbers', () => {
    expect(ChartData.parse({ title: 'Title', items: [item('a', 1), item('b', 2)] }).type).toBe('bar');
    expect(ok({ items: [item('a', 1)] })).toBe(false); // a bar chart compares at least two
    expect(ok({ items: Array.from({ length: 9 }, (_, i) => item(`l${i}`, i)) })).toBe(false);
    expect(ok({ items: [item('a', Number.POSITIVE_INFINITY), item('b', 2)] })).toBe(false);
  });

  it('asks each type for the data it needs', () => {
    const three = [item('a', 3), item('b', 2), item('c', 1)];
    expect(ok({ type: 'line', items: three })).toBe(true);
    expect(ok({ type: 'line', items: three.slice(0, 2) })).toBe(false); // a trend needs three points
    expect(ok({ type: 'area', items: three })).toBe(true);
    expect(ok({ type: 'donut', items: three.slice(0, 2) })).toBe(true);
    expect(ok({ type: 'treemap', items: three })).toBe(true);
    expect(ok({ type: 'treemap', items: [item('a', 3), item('b', 0), item('c', 1)] })).toBe(false);
    expect(ok({ type: 'radar', items: three })).toBe(true);
    expect(ok({ type: 'radar', items: three.slice(0, 2) })).toBe(false);
  });

  it('a funnel only shrinks, a waterfall may fall, shares and radar cannot be negative', () => {
    expect(ok({ type: 'funnel', items: [item('a', 90), item('b', 60), item('c', 20)] })).toBe(true);
    expect(ok({ type: 'funnel', items: [item('a', 60), item('b', 90), item('c', 20)] })).toBe(false);
    expect(ok({ type: 'waterfall', items: [item('Start', 100), item('Cut', -30), item('Gain', 12)] })).toBe(true);
    expect(ok({ type: 'donut', items: [item('a', 60), item('b', -5)] })).toBe(false);
  });

  it('gauge and radial show exactly one value, bullet needs a target for each', () => {
    expect(ok({ type: 'gauge', max: 100, items: [item('Score', 72)] })).toBe(true);
    expect(ok({ type: 'gauge', items: [item('a', 1), item('b', 2)] })).toBe(false);
    expect(ok({ type: 'radial', unit: '%', items: [item('Done', 40)] })).toBe(true);
    expect(ok({ type: 'bullet', items: [item('Sales', 80, 100)] })).toBe(true);
    expect(ok({ type: 'bullet', items: [item('Sales', 80)] })).toBe(false);
  });

  it('an unknown type is refused', () => {
    expect(ok({ type: 'pie3d', items: [item('a', 1), item('b', 2)] })).toBe(false);
  });
});

describe('groundChart by type', () => {
  const TEXT = 'Revenue was $10 billion in 2024, $12 billion in 2025 and $15 billion in 2026. Margin fell 3 points. Target is 20. Gauge max 50. Completion 40%. Shares: 60% cloud and 40% devices.';
  const g = (c: Record<string, unknown>) => groundChart(ChartData.parse({ title: 'Revenue', unit: '$ billion', ...c }), TEXT);
  const item = (label: string, value: number, target?: number) => ({ label, value, ...(target === undefined ? {} : { target }) });

  it('keeps a line over periods when every value and year is stated', () => {
    expect(g({ type: 'line', items: [item('2024', 10), item('2025', 12), item('2026', 15)] })).not.toBeNull();
    expect(g({ type: 'line', items: [item('2024', 10), item('2025', 12), item('2027', 15)] })).toBeNull(); // 2027 is invented
  });

  it('keeps a waterfall with a negative step judged by magnitude', () => {
    expect(g({ type: 'waterfall', unit: '', items: [item('Start', 10), item('Margin change', -3), item('Later', 15)] })).not.toBeNull();
  });

  it('a gauge needs a stated scale, or the percent unit', () => {
    expect(g({ type: 'gauge', unit: '', max: 50, items: [item('Level', 20)] })).not.toBeNull(); // 50 and 20 are stated
    expect(g({ type: 'gauge', unit: '', max: 80, items: [item('Level', 20)] })).toBeNull(); // 80 is not
    expect(g({ type: 'gauge', unit: '', items: [item('Level', 20)] })).toBeNull(); // no scale at all
    expect(g({ type: 'gauge', unit: '%', items: [item('Completion', 40)] })).not.toBeNull(); // a percent is its own scale
    expect(g({ type: 'gauge', unit: '', max: 20, items: [item('Level', 50)] })).toBeNull(); // value above the scale
  });

  it('a bullet target and a donut total are checked', () => {
    expect(g({ type: 'bullet', unit: '', items: [item('Sales', 15, 20)] })).not.toBeNull();
    expect(g({ type: 'bullet', unit: '', items: [item('Sales', 15, 25)] })).toBeNull(); // target 25 not stated
    expect(g({ type: 'donut', unit: '%', items: [item('Cloud', 60), item('Devices', 40)] })).not.toBeNull();
    expect(groundChart(ChartData.parse({ title: 'Shares', unit: '%', type: 'donut', items: [item('Cloud', 60), item('Devices', 40), item('Other', 40)] }), TEXT)).toBeNull(); // 140% of a whole
  });
});

describe('groundTranslatedChart (Georgian chart from the Translator)', () => {
  const en = chart([{ label: 'Fiscal 2027', value: 115 }, { label: 'Fiscal 2028', value: 230 }]);
  const ka = (items: { label: string; value: number }[], title = 'Broadcom-ის AI შემოსავლის პროგნოზი') => ChartData.parse({ title, unit: 'მლრდ $', items });

  it('accepts same items, same order, same values, same digits', () => {
    const k = ka([{ label: '2027 ფისკალური წელი', value: 115 }, { label: '2028 ფისკალური წელი', value: 230 }]);
    expect(groundTranslatedChart(en, k)).toEqual(k);
  });

  it('rejects a changed type, scale or target', () => {
    const gaugeEn = ChartData.parse({ type: 'gauge', title: 'Level', unit: '', max: 50, items: [{ label: 'Level', value: 20 }] });
    const gaugeKa = (over: Record<string, unknown>) => ChartData.parse({ type: 'gauge', title: 'დონე', unit: '', max: 50, items: [{ label: 'დონე', value: 20 }], ...over });
    expect(groundTranslatedChart(gaugeEn, gaugeKa({}))).not.toBeNull();
    expect(groundTranslatedChart(gaugeEn, gaugeKa({ max: 60 }))).toBeNull();
    expect(groundTranslatedChart(gaugeEn, gaugeKa({ type: 'radial', unit: '%' }))).toBeNull();
    const bulletEn = ChartData.parse({ type: 'bullet', title: 'Sales', items: [{ label: 'Sales', value: 15, target: 20 }] });
    const bulletKa = (target: number) => ChartData.parse({ type: 'bullet', title: 'გაყიდვები', items: [{ label: 'გაყიდვები', value: 15, target }] });
    expect(groundTranslatedChart(bulletEn, bulletKa(20))).not.toBeNull();
    expect(groundTranslatedChart(bulletEn, bulletKa(25))).toBeNull();
  });

  it('rejects a changed value, a different item count, or a changed year', () => {
    expect(groundTranslatedChart(en, ka([{ label: '2027', value: 116 }, { label: '2028', value: 230 }]))).toBeNull();
    expect(groundTranslatedChart(en, ka([{ label: '2027', value: 115 }, { label: '2028', value: 230 }, { label: 'x', value: 1 }]))).toBeNull();
    expect(groundTranslatedChart(en, ka([{ label: '2027', value: 115 }, { label: '2029', value: 230 }]))).toBeNull();
    expect(groundTranslatedChart(en, null)).toBeNull();
  });
});

describe('timeline charts (dated events for stories without comparable numbers)', () => {
  const NOW = Date.parse('2026-10-03T12:00:00Z');
  const ESMA = 'ESMA launched a consultation on the reporting framework for third-country CCPs. Responses are due by 31 December 2026, and the final report follows on 15 March 2027.';
  const tl = (items: { label: string; date: string }[], extra: Record<string, unknown> = {}) => ChartData.parse({ type: 'timeline', title: 'Consultation timeline', items, ...extra });

  it('parses dated items, turns the missing value into zero, and keeps the order rules', () => {
    const c = tl([{ label: 'Consultation opens', date: '2026-10-02' }, { label: 'Responses due', date: '2026-12-31' }]);
    expect(c.items.map((i) => i.value)).toEqual([0, 0]);
    const ok = (items: unknown[]) => ChartData.safeParse({ type: 'timeline', title: 'Title', items }).success;
    expect(ok([{ label: 'a', date: '2026-10-02' }])).toBe(false); // one event is not a timeline
    expect(ok([{ label: 'a', date: '2026-12-31' }, { label: 'b', date: '2026-10-02' }])).toBe(false); // oldest first
    expect(ok([{ label: 'a', date: '2026-10-02' }, { label: 'b' }])).toBe(false);
    expect(ok([{ label: 'a', date: '31 December 2026' }, { label: 'b', date: '2026-12-31' }])).toBe(false); // ISO only
    expect(ok([{ label: 'a', date: '2026-10-02' }, { label: 'b', date: '2026-10-02' }])).toBe(true); // same day is fine
  });

  it('other types still need a value', () => {
    expect(ChartData.safeParse({ type: 'bar', title: 'Title', items: [{ label: 'a', value: 1 }, { label: 'b' }] }).success).toBe(false);
  });

  it('keeps dates the sources state, in words, in ISO form or as the day the item was published', () => {
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-12-31' }, { label: 'Final report', date: '2027-03-15' }]), ESMA, NOW)).not.toBeNull();
    expect(groundChart(tl([{ label: 'Consultation opens', date: '2026-10-02' }, { label: 'Responses due', date: '2026-12-31' }]), `${ESMA}\n2026-10-02`, NOW)).not.toBeNull();
    expect(groundChart(tl([{ label: 'Opens', date: '2026-10-02' }, { label: 'Due', date: '2026-12-31' }]), 'Responses are due 31/12 and it opens 2/10.', NOW)).not.toBeNull();
  });

  it('drops a date the sources never give', () => {
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-12-30' }, { label: 'Final report', date: '2027-03-15' }]), ESMA, NOW)).toBeNull(); // wrong day
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-11-30' }, { label: 'Final report', date: '2027-03-15' }]), ESMA, NOW)).toBeNull(); // 30 is not stated
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-12-31' }, { label: 'Final report', date: '2027-04-15' }]), ESMA, NOW)).toBeNull(); // wrong month
    expect(groundChart(tl([{ label: 'Responses due', date: '2031-12-31' }, { label: 'Final report', date: '2031-12-31' }]), ESMA, NOW)).toBeNull(); // a year nobody mentioned and far away
    expect(groundChart(tl([{ label: 'Day 99', date: '2026-12-31' }, { label: 'Final report', date: '2027-03-15' }]), ESMA, NOW)).toBeNull(); // an invented number in a label
  });

  it('accepts the coming year when the text leaves the year out, but not an unrelated month', () => {
    const text = 'Responses are due by 31 December and the final report follows on 15 March.';
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-12-31' }, { label: 'Final report', date: '2027-03-15' }]), text, NOW)).not.toBeNull();
    expect(groundChart(tl([{ label: 'Responses due', date: '2026-11-15' }, { label: 'Final report', date: '2027-03-15' }]), text, NOW)).toBeNull();
  });

  it('the Georgian timeline keeps every date', () => {
    const en = tl([{ label: 'Responses due', date: '2026-12-31' }, { label: 'Final report', date: '2027-03-15' }]);
    const ka = (a: string, b: string) => ChartData.parse({ type: 'timeline', title: 'კონსულტაციის ვადები', items: [{ label: 'პასუხების ვადა', date: a }, { label: 'საბოლოო ანგარიში', date: b }] });
    expect(groundTranslatedChart(en, ka('2026-12-31', '2027-03-15'))).not.toBeNull();
    expect(groundTranslatedChart(en, ka('2026-12-30', '2027-03-15'))).toBeNull();
  });
});

describe('groundCharts (several graphs per story)', () => {
  const TEXT = 'Broadcom expects AI revenue of $115 billion in 2027 and $230 billion in 2028. Margins 41% and 59%.';
  const bar = chart([{ label: 'Fiscal 2027', value: 115 }, { label: 'Fiscal 2028', value: 230 }]);
  const donut = ChartData.parse({ type: 'donut', title: 'Margin mix', unit: '%', items: [{ label: 'Hardware', value: 41 }, { label: 'Software', value: 59 }] });
  const gauge = ChartData.parse({ type: 'gauge', title: 'Software share', unit: '%', items: [{ label: 'Software', value: 59 }] });
  const invented = ChartData.parse({ type: 'treemap', title: 'Invented split', unit: '', items: [{ label: 'A', value: 7 }, { label: 'B', value: 9 }, { label: 'C', value: 11 }] });

  it('keeps the graphs whose numbers the text states, one per type, and counts the rest as dropped', () => {
    const second = chart([{ label: 'Fiscal 2027', value: 115 }, { label: 'Fiscal 2028', value: 230 }], { title: 'Same type again' });
    const { kept, dropped } = groundCharts([bar, second, donut, invented], TEXT);
    expect(kept.map((c) => c.type)).toEqual(['bar', 'donut']);
    expect(dropped).toBe(2);
  });

  it('keeps at most three graphs', () => {
    const line = ChartData.parse({ type: 'line', title: 'Revenue', unit: '$ billion', items: [{ label: 'a', value: 115 }, { label: 'b', value: 230 }, { label: 'c', value: 115 }] });
    expect(groundCharts([bar, donut, gauge, line], TEXT).kept.map((c) => c.type)).toEqual(['bar', 'donut', 'gauge']);
  });

  it('matches Georgian graphs to English ones by position and leaves out any that changed a value', () => {
    const ka = (c: ChartData, value?: number) => ({ ...c, title: 'ქართული', items: c.items.map((i, k) => ({ ...i, label: i.label.replace(/[A-Za-z]+/g, 'ა'), value: k === 0 && value !== undefined ? value : i.value })) });
    expect(groundTranslatedCharts([bar, donut], [ka(bar), ka(donut)]).map((c) => c.type)).toEqual(['bar', 'donut']);
    expect(groundTranslatedCharts([bar, donut], [ka(bar, 116), ka(donut)]).map((c) => c.type)).toEqual(['donut']);
    expect(groundTranslatedCharts([bar, donut], [ka(bar)]).map((c) => c.type)).toEqual(['bar']);
  });
});

describe('more graph types: schema', () => {
  const ok = (c: Record<string, unknown>) => ChartData.safeParse({ title: 'Title', unit: '', ...c }).success;
  const two = [{ label: 'A', value: 1 }, { label: 'B', value: 2 }];

  it('column and pie follow the rules of bar and donut', () => {
    expect(ok({ type: 'column', items: two })).toBe(true);
    expect(ok({ type: 'pie', items: two })).toBe(true);
    expect(ok({ type: 'pie', items: [{ label: 'A', value: -1 }, { label: 'B', value: 2 }] })).toBe(false);
  });

  it('a waffle is one percentage; a rose needs three values; a parliament needs whole positive counts', () => {
    expect(ok({ type: 'waffle', unit: '%', items: [{ label: 'Firms hiring', value: 64 }] })).toBe(true);
    expect(ok({ type: 'waffle', unit: '', items: [{ label: 'x', value: 64 }] })).toBe(false);
    expect(ok({ type: 'waffle', unit: '%', items: [{ label: 'x', value: 140 }] })).toBe(false);
    expect(ok({ type: 'rose', items: [...two, { label: 'C', value: 3 }] })).toBe(true);
    expect(ok({ type: 'rose', items: two })).toBe(false);
    expect(ok({ type: 'parliament', items: [{ label: 'Party A', value: 89 }, { label: 'Party B', value: 61 }] })).toBe(true);
    expect(ok({ type: 'parliament', items: [{ label: 'Party A', value: 89.5 }, { label: 'Party B', value: 61 }] })).toBe(false);
  });

  it('a slope needs two series names and a "to" value for every item', () => {
    expect(ok({ type: 'slope', series: ['2025', '2026'], items: [{ label: 'A', value: 1, to: 2 }, { label: 'B', value: 3, to: 2 }] })).toBe(true);
    expect(ok({ type: 'slope', series: ['2025'], items: [{ label: 'A', value: 1, to: 2 }, { label: 'B', value: 3, to: 2 }] })).toBe(false);
    expect(ok({ type: 'slope', series: ['2025', '2026'], items: [{ label: 'A', value: 1 }, { label: 'B', value: 3, to: 2 }] })).toBe(false);
  });

  it('grouped and stacked need one value per series for every item', () => {
    const items = [{ label: 'North', values: [10, 12] }, { label: 'South', values: [8, 9] }];
    for (const type of ['grouped', 'stacked']) {
      expect(ok({ type, series: ['2025', '2026'], items }), type).toBe(true);
      expect(ok({ type, series: ['2025', '2026', '2027'], items }), type).toBe(false);
      expect(ok({ type, series: ['2025'], items }), type).toBe(false);
    }
  });

  it('a gantt needs periods that end on or after they start, earliest first', () => {
    const p = (label: string, date: string, end: string) => ({ label, date, end });
    expect(ok({ type: 'gantt', items: [p('Consultation', '2026-10-01', '2026-12-31'), p('Review', '2027-01-15', '2027-03-01')] })).toBe(true);
    expect(ok({ type: 'gantt', items: [p('Consultation', '2026-10-01', '2026-09-01'), p('Review', '2027-01-15', '2027-03-01')] })).toBe(false);
    expect(ok({ type: 'gantt', items: [p('Review', '2027-01-15', '2027-03-01'), p('Consultation', '2026-10-01', '2026-12-31')] })).toBe(false);
  });

  it('a network needs three nodes and links between different ones, without repeats', () => {
    const items = [{ label: 'Nvidia' }, { label: 'OpenAI' }, { label: 'Microsoft' }];
    expect(ok({ type: 'network', items, links: [{ from: 0, to: 1, label: 'invests in' }, { from: 2, to: 1 }] })).toBe(true);
    expect(ok({ type: 'network', items, links: [] })).toBe(false);
    expect(ok({ type: 'network', items, links: [{ from: 0, to: 5 }] })).toBe(false);
    expect(ok({ type: 'network', items, links: [{ from: 1, to: 1 }] })).toBe(false);
    expect(ok({ type: 'network', items, links: [{ from: 0, to: 1 }, { from: 1, to: 0 }] })).toBe(false);
  });
});

describe('more graph types: grounding', () => {
  const TEXT = 'Nvidia and Microsoft both back OpenAI. Sales rose from 120 million in 2025 to 150 million in 2026; the North region sold 10 and the South 8. The consultation runs from 1 October to 31 December 2026. 64% of firms plan to hire.';
  const parse = (c: Record<string, unknown>) => ChartData.parse({ title: 'Title', unit: '', ...c });

  it('grounds every value of a slope, grouped and stacked chart', () => {
    const slope = parse({ type: 'slope', series: ['2025', '2026'], unit: '$ million', items: [{ label: 'Sales', value: 120, to: 150 }, { label: 'Other', value: 10, to: 8 }] });
    expect(groundChart(slope, TEXT)).not.toBeNull();
    expect(groundChart({ ...slope, items: [{ ...slope.items[0]!, to: 155 }, slope.items[1]!] }, TEXT)).toBeNull();
    const grouped = parse({ type: 'grouped', series: ['2025', '2026'], unit: '$ million', items: [{ label: 'North', values: [120, 150] }, { label: 'South', values: [8, 10] }] });
    expect(groundChart(grouped, TEXT)).not.toBeNull();
    expect(groundChart({ ...grouped, type: 'stacked' }, TEXT)).not.toBeNull();
    expect(groundChart({ ...grouped, items: [{ ...grouped.items[0]!, values: [120, 151] }, grouped.items[1]!] }, TEXT)).toBeNull();
    expect(groundChart({ ...grouped, series: ['2025', '2031'] }, TEXT)).toBeNull(); // a year nobody stated
  });

  it('grounds the dates of a gantt and the names of a network', () => {
    const gantt = parse({ type: 'gantt', items: [{ label: 'Consultation', date: '2026-10-01', end: '2026-12-31' }, { label: 'Review', date: '2027-01-01', end: '2027-02-01' }] });
    expect(groundChart(gantt, TEXT, Date.parse('2026-10-04T00:00:00Z'))).toBeNull(); // the review dates are not in the text
    expect(groundChart({ ...gantt, items: [gantt.items[0]!, { label: 'Close', value: 0, date: '2026-12-31', end: '2026-12-31' }] }, TEXT, Date.parse('2026-10-04T00:00:00Z'))).not.toBeNull();
    const net = parse({ type: 'network', items: [{ label: 'Nvidia' }, { label: 'OpenAI' }, { label: 'Microsoft' }], links: [{ from: 0, to: 1, label: 'backs' }, { from: 2, to: 1, label: 'backs' }] });
    expect(groundChart(net, TEXT)).not.toBeNull();
    expect(groundChart({ ...net, items: [{ label: 'Nvidia', value: 0 }, { label: 'OpenAI', value: 0 }, { label: 'Amazon', value: 0 }] }, TEXT)).toBeNull(); // Amazon is not named
    expect(groundChart({ ...net, links: [{ from: 0, to: 1, label: 'backs 7 firms' }, { from: 2, to: 1, label: 'backs' }] }, TEXT)).toBeNull(); // an invented figure in a link label
  });

  it('a pie in percent cannot exceed 100, and a waffle is a stated percentage', () => {
    expect(groundChart(parse({ type: 'waffle', unit: '%', items: [{ label: 'Firms hiring', value: 64 }] }), TEXT)).not.toBeNull();
    expect(groundChart(parse({ type: 'pie', unit: '%', items: [{ label: 'A', value: 64 }, { label: 'B', value: 64 }] }), TEXT)).toBeNull();
  });

  it('Georgian versions keep series, links, second values and end dates', () => {
    const en = parse({ type: 'network', items: [{ label: 'Nvidia' }, { label: 'OpenAI' }, { label: 'Microsoft' }], links: [{ from: 0, to: 1, label: 'backs' }, { from: 2, to: 1, label: 'backs' }] });
    const ka = (links: { from: number; to: number; label: string }[]) => ({ ...en, title: 'ქართული', items: en.items.map((i) => ({ ...i, label: 'ა' })), links: links.map((l) => ({ ...l, label: 'მხარს უჭერს' })) });
    expect(groundTranslatedChart(en, ka(en.links!))).not.toBeNull();
    expect(groundTranslatedChart(en, ka([{ from: 0, to: 2, label: '' }, { from: 2, to: 1, label: '' }]))).toBeNull(); // a link moved
    const slope = parse({ type: 'slope', series: ['2025', '2026'], items: [{ label: 'A', value: 120, to: 150 }, { label: 'B', value: 10, to: 8 }] });
    const kaSlope = (to: number) => ({ ...slope, title: 'ქართული', series: ['2025', '2026'], items: slope.items.map((i, k) => ({ ...i, label: 'ა', to: k === 0 ? to : i.to })) });
    expect(groundTranslatedChart(slope, kaSlope(150))).not.toBeNull();
    expect(groundTranslatedChart(slope, kaSlope(151))).toBeNull();
  });
});
