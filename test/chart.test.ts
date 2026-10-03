import { describe, expect, it } from 'vitest';
import { groundChart, groundTranslatedChart } from '../src/pipeline/chart';
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
