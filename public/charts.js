// Small SVG/DOM chart builders. They take ready-made strings (already translated, already formatted)
// and never read story text as markup. Colours come from CSS classes (.f1-.f7 fills, .s1-.s7 strokes,
// .tm1-.tm5 treemap tiles, .hl0-.hl4 heat levels), so light and dark themes need no code here.
// Nothing sets an inline style: the CSP forbids it, and SVG attributes are all these charts need.

import { h, svg } from './dom.js';

const FILLS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
const STROKES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
const r1 = (n) => (Math.round(n * 10) / 10).toString();
const r2 = (n) => (Math.round(n * 100) / 100).toString();
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Round a maximum up to 1, 2, 5 or 10 times a power of ten, so axis labels read cleanly. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// ─── columns over time ──────────────────────────────────────────────────────

/** Columns over time, e.g. stories per hour. items: [{ n, label, tip }]. */
export function columnChart(items, { aria, labelEvery = 6 } = {}) {
  const W = 320;
  const H = 150;
  const pl = 6;
  const pr = 6;
  const pt = 24;
  const pb = 22;
  const step = (W - pl - pr) / items.length;
  const bw = Math.max(2, step - 3);
  const max = Math.max(1, ...items.map((i) => i.n));
  const base = H - pb;
  const peak = items.reduce((p, i, idx) => (i.n > (items[p]?.n ?? 0) ? idx : p), 0);
  const y = (n) => pt + (1 - n / max) * (base - pt);

  const kids = [svg('path', { class: 'grid', d: `M${pl} ${pt}H${W - pr}M${pl} ${((pt + base) / 2).toFixed(0)}H${W - pr}M${pl} ${base}H${W - pr}` })];
  items.forEach((it, i) => {
    const x = pl + i * step + (step - bw) / 2;
    const top = it.n > 0 ? y(it.n) : base - 2;
    kids.push(svg('rect', { class: `col${it.n === 0 ? ' zero' : i === peak ? ' peak' : ''}`, x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: (base - top).toFixed(1), rx: 2 }, svg('title', {}, it.tip)));
    if (i % labelEvery === 0 || i === items.length - 1) kids.push(svg('text', { x: (x + bw / 2).toFixed(1), y: H - 6, 'text-anchor': 'middle' }, it.label));
  });
  if (items[peak] && items[peak].n > 0) {
    const x = pl + peak * step + step / 2;
    kids.push(svg('text', { class: 'val', x: x.toFixed(1), y: (y(items[peak].n) - 6).toFixed(1), 'text-anchor': 'middle' }, String(items[peak].n)));
  }
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── line and area ──────────────────────────────────────────────────────────

/**
 * Line / area chart. labels: one per point. series: [{ values: (number|null)[], cls?: 's1', area?: bool, tip?: (i) => string }].
 * A null value leaves a gap. The scale starts at yMin (0 by default) and ends at yMax or a rounded-up maximum.
 */
export function lineChart({ labels, series, aria, yMin: yMinIn, yMax, fmt = r1, labelEvery, integer = false, W = 340, H = 160 }) {
  const pl = 34;
  const pr = 14;
  const pt = 14;
  const pb = 24;
  const iw = W - pl - pr;
  const ih = H - pt - pb;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  const low = Math.min(0, ...all);
  const yMin = yMinIn ?? (low < 0 ? -niceMax(-low) : 0);
  const top = Math.max(yMin, ...all);
  let hi = yMax ?? (top > yMin ? niceMax(top) : yMin + 1);
  if (integer && yMax == null && hi < 10) hi = Math.max(2, Math.ceil(hi / 2) * 2); // keeps the middle gridline a whole number
  if (hi <= yMin) hi = yMin + 1;
  const n = labels.length;
  const x = (i) => pl + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => pt + (1 - (clamp(v, yMin, hi) - yMin) / (hi - yMin)) * ih;
  const every = labelEvery ?? Math.max(1, Math.ceil(n / 7));
  const fit = Math.max(3, Math.floor(((n < 2 ? iw : iw / (n - 1)) * every) / 5.8));
  const base = pt + ih;

  const kids = [];
  for (const g of [0, 0.5, 1]) {
    const yy = pt + g * ih;
    kids.push(svg('path', { class: 'grid', d: `M${pl} ${yy.toFixed(1)}H${W - pr}` }), svg('text', { x: pl - 6, y: (yy + 3.5).toFixed(1), 'text-anchor': 'end' }, fmt(hi - g * (hi - yMin))));
  }
  labels.forEach((l, i) => {
    if (i % every === 0) kids.push(svg('text', { x: x(i).toFixed(1), y: H - 6, 'text-anchor': 'middle' }, clip(l, fit)));
  });

  series.forEach((s, si) => {
    const cls = s.cls ?? STROKES[si % STROKES.length];
    const runs = [];
    let run = [];
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push([x(i), y(v)]);
    });
    if (run.length) runs.push(run);
    for (const pts of runs) {
      const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');
      if (s.area && pts.length > 1) kids.push(svg('path', { class: `ar ${cls}`, d: `${d}L${pts[pts.length - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z` }));
      if (pts.length > 1) kids.push(svg('path', { class: `ln ${cls}`, d }));
    }
    // hover targets with a tooltip each, and the last point marked and labelled
    let last = -1;
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      last = i;
      kids.push(svg('circle', { class: 'hit', cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: 8 }, svg('title', {}, s.tip ? s.tip(i) : `${labels[i]}: ${fmt(v)}`)));
    });
    if (last >= 0) {
      const v = s.values[last];
      kids.push(svg('circle', { class: `dot ${cls}`, cx: x(last).toFixed(1), cy: y(v).toFixed(1), r: 3.4 }));
      kids.push(svg('text', { class: 'val', x: Math.min(x(last), W - pr - 6).toFixed(1), y: (y(v) - 8).toFixed(1), 'text-anchor': 'middle' }, fmt(v)));
    }
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── donut and radial rings ─────────────────────────────────────────────────

function legendList(parts) {
  return h(
    'ul',
    { class: 'legend' },
    parts.map((it, n) => h('li', {}, svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('rect', { class: FILLS[n % FILLS.length], width: 10, height: 10 })), h('span', { text: it.label, title: it.label }), h('b', { text: it.text ?? String(it.n) }))),
  );
}

/** Donut: items [{ label, n, text }], center { value, label }. Seven slices at most. */
export function donut(items, { center, aria } = {}) {
  const parts = items.filter((i) => i.n > 0).slice(0, 7);
  const total = parts.reduce((s, i) => s + i.n, 0) || 1;
  const R = 36;
  const C = 2 * Math.PI * R;
  let off = 0;
  const segs = parts.map((it, i) => {
    const arc = (it.n / total) * C;
    const len = Math.max(0.5, arc - (parts.length > 1 ? 1.6 : 0));
    const el = svg('circle', { class: `ring ${STROKES[i % STROKES.length]}`, cx: 50, cy: 50, r: R, 'stroke-dasharray': `${r2(len)} ${r2(C - len)}`, 'stroke-dashoffset': r2(-off), transform: 'rotate(-90 50 50)' }, svg('title', {}, `${it.label}: ${it.text ?? it.n}`));
    off += arc;
    return el;
  });
  return h(
    'div',
    { class: 'donut-wrap' },
    svg(
      'svg',
      { class: 'donut', viewBox: '0 0 100 100', role: 'img', 'aria-label': aria },
      svg('circle', { class: 'trk-ring', cx: 50, cy: 50, r: R }),
      segs,
      center ? svg('text', { class: 'c-val', x: 50, y: 52, 'text-anchor': 'middle' }, center.value) : null,
      center?.label ? svg('text', { class: 'c-lbl', x: 50, y: 64, 'text-anchor': 'middle' }, center.label) : null,
    ),
    legendList(parts),
  );
}

/**
 * Radial bars / progress circles: items [{ label, value, max, text }]. One item is a progress circle,
 * up to four are concentric rings.
 */
export function radialBars(items, { center, aria } = {}) {
  const rings = items.slice(0, 4);
  const kids = [];
  rings.forEach((it, i) => {
    const R = 43 - i * 10;
    const C = 2 * Math.PI * R;
    const frac = clamp(it.max > 0 ? it.value / it.max : 0, 0, 1);
    kids.push(svg('circle', { class: 'trk-ring thin', cx: 50, cy: 50, r: R }));
    if (frac > 0) kids.push(svg('circle', { class: `ring thin ${STROKES[i]}`, cx: 50, cy: 50, r: R, 'stroke-linecap': 'round', 'stroke-dasharray': `${r2(frac * C)} ${r2(C)}`, transform: 'rotate(-90 50 50)' }, svg('title', {}, `${it.label}: ${it.text}`)));
  });
  if (center) {
    kids.push(svg('text', { class: 'c-val', x: 50, y: 54, 'text-anchor': 'middle' }, center.value));
    if (rings.length === 1 && center.label) kids.push(svg('text', { class: 'c-lbl', x: 50, y: 66, 'text-anchor': 'middle' }, clip(center.label, 18)));
  }
  return h(
    'div',
    { class: 'donut-wrap' },
    svg('svg', { class: 'donut', viewBox: '0 0 100 100', role: 'img', 'aria-label': aria }, kids),
    rings.length > 1 || !center?.label ? legendList(rings.map((it) => ({ label: it.label, text: it.text }))) : null,
  );
}

// ─── gauge ──────────────────────────────────────────────────────────────────

/** Half-circle gauge. mark: where a threshold sits on the same scale (a short tick across the arc). */
export function gauge(value, max, { text, label, mark, markLabel, aria } = {}) {
  const frac = clamp(max > 0 ? value / max : 0, 0, 1);
  const L = Math.PI * 80;
  const band = frac >= 0.8 ? 's1' : frac >= 0.6 ? 's2' : 's3';
  const kids = [svg('path', { class: 'g-trk', d: 'M20 100A80 80 0 0 1 180 100' })];
  if (frac > 0) kids.push(svg('path', { class: `g-val ${band}`, d: 'M20 100A80 80 0 0 1 180 100', 'stroke-dasharray': `${r2(frac * L)} ${r2(L)}` }));
  if (mark != null && max > 0) {
    const a = Math.PI * (1 - clamp(mark / max, 0, 1));
    const p = (r) => `${r1(100 + Math.cos(a) * r)} ${r1(100 - Math.sin(a) * r)}`;
    kids.push(svg('path', { class: 'g-mark', d: `M${p(68)}L${p(94)}` }, markLabel ? svg('title', {}, markLabel) : null));
  }
  kids.push(svg('text', { class: 'g-num', x: 100, y: 92, 'text-anchor': 'middle' }, text ?? r1(value)));
  if (label) kids.push(svg('text', { class: 'g-lbl', x: 100, y: 114, 'text-anchor': 'middle' }, clip(label, 34)));
  kids.push(svg('text', { class: 'g-end', x: 20, y: 114, 'text-anchor': 'middle' }, '0'), svg('text', { class: 'g-end', x: 180, y: 114, 'text-anchor': 'middle' }, r1(max)));
  return svg('svg', { class: 'gauge', viewBox: '0 0 200 122', role: 'img', 'aria-label': aria }, kids);
}

// ─── horizontal rows: bars, bullets, waterfall, funnel, stacked ─────────────

/** Horizontal bars. items: [{ label, value, text }]. `max` fixes the scale (default: the largest value). */
export function hbars(items, { max, firstAccent = true } = {}) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return h(
    'div',
    { class: 'bars' },
    items.map((it, n) =>
      h(
        'div',
        { class: 'bar-row' },
        h('span', { text: it.label, title: it.label }),
        h('b', { text: it.text ?? String(it.value) }),
        svg(
          'svg',
          { class: 'bar', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
          svg('rect', { class: 'trk', width: 100, height: 8 }),
          svg('rect', { class: it.value < 0 ? 'fneg' : n === 0 && firstAccent ? 'f1' : 'f2', width: Math.min(100, (Math.abs(it.value) / top) * 100).toFixed(1), height: 8 }),
        ),
      ),
    ),
  );
}

/**
 * Bullet chart: a bar for the value against a tick for the target, on a faint scale.
 * items: [{ label, value, target, text, targetText }]. `max` fixes the scale (default: the largest of any value or target, rounded up).
 */
export function bullets(items, { max } = {}) {
  const top = max ?? niceMax(Math.max(1e-9, ...items.flatMap((i) => [Math.abs(i.value), Math.abs(i.target ?? 0)])));
  return h(
    'div',
    { class: 'bars' },
    items.map((it) => {
      const w = (it.value / top) * 100;
      const tx = it.target == null ? null : clamp((it.target / top) * 100, 0, 100);
      const met = it.target != null && it.value >= it.target;
      return h(
        'div',
        { class: 'bar-row' },
        h('span', { text: it.label, title: it.label }),
        h('b', { text: it.text }),
        svg(
          'svg',
          { class: 'bar tall', viewBox: '0 0 100 14', preserveAspectRatio: 'none', role: 'img', 'aria-label': `${it.label}: ${it.text}${it.targetText ? ` / ${it.targetText}` : ''}` },
          svg('rect', { class: 'trk', width: 100, height: 14 }),
          svg('rect', { class: 'trk2', width: Math.min(100, tx ?? 100).toFixed(1), height: 14 }),
          svg('rect', { class: met ? 'f1' : 'f2', y: 4, width: clamp(w, 0, 100).toFixed(1), height: 6 }),
          tx == null ? null : svg('rect', { class: 'tgt', x: clamp(tx - 0.6, 0, 99).toFixed(1), y: 1, width: 1.2, height: 12 }),
        ),
        it.targetText ? h('small', { class: 'tgt-note', text: it.targetText }) : null,
      );
    }),
  );
}

/**
 * Waterfall: the first item is the starting level, each later item a signed change. Rows float between the
 * running totals. items: [{ label, value, text }].
 */
export function waterfall(items) {
  let run = 0;
  const steps = items.map((it, i) => {
    const from = i === 0 ? 0 : run;
    run = i === 0 ? it.value : run + it.value;
    return { ...it, from, to: run, first: i === 0 };
  });
  const lo = Math.min(0, ...steps.flatMap((s) => [s.from, s.to]));
  const hi = Math.max(1e-9, ...steps.flatMap((s) => [s.from, s.to]));
  const span = hi - lo || 1;
  const pos = (v) => ((v - lo) / span) * 100;
  return h(
    'div',
    { class: 'bars' },
    steps.map((s) => {
      const a = pos(Math.min(s.from, s.to));
      const b = pos(Math.max(s.from, s.to));
      const zero = pos(0);
      return h(
        'div',
        { class: 'bar-row' },
        h('span', { text: s.label, title: s.label }),
        h('b', { text: s.text, class: s.first ? '' : s.value < 0 ? 'neg' : 'pos' }),
        svg(
          'svg',
          { class: 'bar', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
          svg('rect', { class: 'trk', width: 100, height: 8 }),
          svg('rect', { class: s.first ? 'f1' : s.value < 0 ? 'fneg' : 'f2', x: a.toFixed(1), width: Math.max(0.8, b - a).toFixed(1), height: 8 }, svg('title', {}, `${s.label}: ${s.text}`)),
          lo < 0 ? svg('rect', { class: 'zero-line', x: clamp(zero - 0.3, 0, 99.4).toFixed(1), width: 0.6, height: 8 }) : null,
        ),
      );
    }),
  );
}

/** Funnel: centered stages that narrow with the value, labels on the left. items: [{ label, value, text }]. */
export function funnel(items, { aria } = {}) {
  const W = 360;
  const rowH = 40;
  const gap = 3;
  const labelW = 124;
  const cx = labelW + (W - labelW) / 2;
  const maxW = W - labelW - 4;
  const top = Math.max(1e-9, ...items.map((i) => i.value));
  const widthOf = (v) => Math.max(10, (v / top) * maxW);
  const kids = [];
  items.forEach((it, i) => {
    const y = i * (rowH + gap);
    const w0 = widthOf(it.value);
    const w1 = items[i + 1] ? Math.min(w0, widthOf(items[i + 1].value)) : w0 * 0.8;
    kids.push(
      svg('polygon', { class: FILLS[Math.min(i, 3)], points: `${r1(cx - w0 / 2)},${y} ${r1(cx + w0 / 2)},${y} ${r1(cx + w1 / 2)},${y + rowH} ${r1(cx - w1 / 2)},${y + rowH}` }, svg('title', {}, `${it.label}: ${it.text}`)),
      svg('text', { class: 'fl', x: 0, y: y + 16 }, svg('title', {}, it.label), clip(it.label, 20)),
      svg('text', { class: 'fv', x: 0, y: y + 33 }, it.text),
    );
  });
  const H = items.length * (rowH + gap) - gap;
  return svg('svg', { class: 'chart funnel', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

/** Stacked horizontal bars. rows: [{ label, parts: number[], text }], legend: one name per part. */
export function stackedBars(rows, legend) {
  const max = Math.max(1e-9, ...rows.map((r) => r.parts.reduce((s, n) => s + n, 0)));
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'bars' },
      rows.map((r) => {
        let x = 0;
        const segs = r.parts.map((n, i) => {
          const w = (n / max) * 100;
          const el = n > 0 ? svg('rect', { class: FILLS[i % 4], x: r2(x), width: Math.max(0, w - 0.5).toFixed(2), height: 10 }, svg('title', {}, `${r.label} · ${legend[i]}: ${n}`)) : null;
          x += w;
          return el;
        });
        return h('div', { class: 'bar-row' }, h('span', { text: r.label, title: r.label }), h('b', { text: r.text ?? String(r.parts.reduce((s, n) => s + n, 0)) }), svg('svg', { class: 'bar tall', viewBox: '0 0 100 10', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, svg('rect', { class: 'trk', width: 100, height: 10 }), segs));
      }),
    ),
    h(
      'ul',
      { class: 'legend row' },
      legend.map((name, i) => h('li', {}, svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('rect', { class: FILLS[i % 4], width: 10, height: 10 })), h('span', { text: name }))),
    ),
  );
}

/** One stacked bar with a legend. items: [{ label, n, text }]. */
export function splitBar(items) {
  const parts = items.slice(0, 5);
  const total = parts.reduce((s, i) => s + i.n, 0) || 1;
  let x = 0;
  const segs = parts.map((it, n) => {
    const w = (it.n / total) * 100;
    const r = svg('rect', { class: FILLS[n], x: x.toFixed(2), width: Math.max(0, w - 0.6).toFixed(2), height: 14 });
    x += w;
    return r;
  });
  return h('div', {}, svg('svg', { class: 'splitbar', viewBox: '0 0 100 14', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, segs), legendList(parts));
}

// ─── treemap ────────────────────────────────────────────────────────────────

/** Squarified treemap layout: items [{ a }] sorted by area, in the rectangle (x, y, w, h). */
function squarify(items, x, y, w, hgt) {
  const out = [];
  let row = [];
  const rest = [...items];
  const worst = (cells, side) => {
    const s = cells.reduce((t, c) => t + c.a, 0);
    const hi = Math.max(...cells.map((c) => c.a));
    const lo = Math.min(...cells.map((c) => c.a));
    return Math.max((side * side * hi) / (s * s), (s * s) / (side * side * lo));
  };
  const place = () => {
    const s = row.reduce((t, c) => t + c.a, 0);
    if (w >= hgt) {
      const cw = s / hgt;
      let yy = y;
      for (const c of row) {
        const ch = c.a / cw;
        out.push({ ...c, x, y: yy, w: cw, h: ch });
        yy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let xx = x;
      for (const c of row) {
        const cw = c.a / rh;
        out.push({ ...c, x: xx, y, w: cw, h: rh });
        xx += cw;
      }
      y += rh;
      hgt -= rh;
    }
    row = [];
  };
  while (rest.length) {
    const side = Math.min(w, hgt);
    const next = rest[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      rest.shift();
    } else place();
  }
  if (row.length) place();
  return out;
}

/** Treemap: items [{ label, n, text }], tile area follows n. */
export function treemap(items, { aria } = {}) {
  const W = 340;
  const H = 200;
  const list = items.filter((i) => i.n > 0).sort((a, b) => b.n - a.n).slice(0, 12);
  const total = list.reduce((s, i) => s + i.n, 0) || 1;
  const cells = squarify(
    list.map((i, k) => ({ ...i, k, a: (i.n / total) * W * H })),
    0,
    0,
    W,
    H,
  );
  const kids = cells.map((c) => {
    const gap = 1.5;
    const tw = c.w - gap * 2;
    const th = c.h - gap * 2;
    const fit = Math.floor((tw - 12) / 5.8);
    const tone = `tm${Math.min(5, c.k + 1)}`;
    return svg(
      'g',
      { class: `tm ${tone}` },
      svg('title', {}, `${c.label}: ${c.text ?? c.n}`),
      svg('rect', { x: r1(c.x + gap), y: r1(c.y + gap), width: r1(Math.max(0, tw)), height: r1(Math.max(0, th)), rx: 5 }),
      fit >= 4 && th >= 22 ? svg('text', { x: r1(c.x + gap + 7), y: r1(c.y + gap + 16) }, clip(c.label, fit)) : null,
      fit >= 3 && th >= 40 ? svg('text', { class: 'tm-n', x: r1(c.x + gap + 7), y: r1(c.y + gap + 31) }, clip(c.text ?? String(c.n), fit)) : null,
    );
  });
  return svg('svg', { class: 'chart treemap', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── heatmap ────────────────────────────────────────────────────────────────

/** Heatmap: cells[row][col] counts. rowLabels, colLabels as strings; tip(row, col, n) for each cell. */
export function heatmap(cells, { rowLabels, colLabels, colEvery = 2, tip, aria }) {
  const pl = 46;
  const pt = 4;
  const cw = 22;
  const chh = 22;
  const gap = 3;
  const cols = cells[0]?.length ?? 24;
  const W = pl + cols * cw + 4;
  const H = pt + cells.length * chh + 22;
  const max = Math.max(1, ...cells.flat());
  const level = (n) => (n <= 0 ? 0 : clamp(Math.ceil((n / max) * 4), 1, 4));
  const kids = [];
  cells.forEach((row, ri) => {
    kids.push(svg('text', { x: pl - 6, y: r1(pt + ri * chh + chh / 2 + 3.4), 'text-anchor': 'end' }, rowLabels[ri]));
    row.forEach((n, ci) => {
      kids.push(svg('rect', { class: `hl${level(n)}`, x: r1(pl + ci * cw), y: r1(pt + ri * chh), width: r1(cw - gap), height: r1(chh - gap), rx: 4 }, svg('title', {}, tip ? tip(ri, ci, n) : String(n))));
    });
  });
  for (let ci = 0; ci < cols; ci += colEvery) kids.push(svg('text', { x: r1(pl + ci * cw + (cw - gap) / 2), y: H - 5, 'text-anchor': 'middle' }, colLabels[ci]));
  return svg('svg', { class: 'chart heat', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── radar ──────────────────────────────────────────────────────────────────

/** Radar: axes [{ label, value, text }] on a 0..max scale (three or more). */
export function radar(axes, { max = 100, aria } = {}) {
  const W = 380;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2 + 2;
  const R = 66;
  const n = axes.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, f) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];
  const poly = (f) => axes.map((_, i) => pt(i, f).map(r1).join(',')).join(' ');
  const kids = [];
  for (const f of [0.25, 0.5, 0.75, 1]) kids.push(svg('polygon', { class: 'r-ring', points: poly(f) }));
  axes.forEach((_, i) => {
    const [x, y] = pt(i, 1);
    kids.push(svg('path', { class: 'grid', d: `M${r1(cx)} ${r1(cy)}L${r1(x)} ${r1(y)}` }));
  });
  kids.push(svg('polygon', { class: 'r-area', points: axes.map((a, i) => pt(i, clamp(a.value / max, 0, 1)).map(r1).join(',')).join(' ') }));
  axes.forEach((a, i) => {
    const [px, py] = pt(i, clamp(a.value / max, 0, 1));
    kids.push(svg('circle', { class: 'dot s1', cx: r1(px), cy: r1(py), r: 3 }, svg('title', {}, `${a.label}: ${a.text ?? r1(a.value)}`)));
    const [lx, ly] = pt(i, 1.18);
    const c = Math.cos(ang(i));
    kids.push(svg('text', { x: r1(lx), y: r1(ly + 3.5), 'text-anchor': c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle' }, svg('title', {}, a.label), clip(a.label, Math.abs(c) > 0.25 ? 15 : 22)));
  });
  return svg('svg', { class: 'chart radar', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── event timeline ─────────────────────────────────────────────────────────

/**
 * Dated events on a time axis, with the part already past filled in and a marker for today, plus the
 * list underneath. items: [{ label, day (whole days since 1970), short, long, rel }], oldest first.
 */
export function eventTimeline(items, { today, todayLabel, aria } = {}) {
  const W = 340;
  const H = 84;
  const pl = 30;
  const pr = 30;
  const base = 44;
  const lo = items[0].day;
  const hi = items[items.length - 1].day;
  const span = hi - lo || 1;
  const xs = items.map((it) => pl + ((it.day - lo) / span) * (W - pl - pr));
  for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 24); // events on nearby days stay apart
  const last = xs[xs.length - 1];
  if (last > W - pr) for (let i = 0; i < xs.length; i++) xs[i] = pl + ((xs[i] - pl) * (W - pr - pl)) / (last - pl);
  const showToday = today != null && today >= lo && today <= hi;
  const tx = showToday ? pl + ((today - lo) / span) * (W - pl - pr) : null;

  const kids = [svg('path', { class: 'tl-axis', d: `M${pl - 12} ${base}H${W - pr + 12}` })];
  if (showToday && tx > pl - 12) kids.push(svg('path', { class: 'ln s1', d: `M${pl - 12} ${base}H${r1(tx)}` }));
  if (showToday) {
    kids.push(svg('path', { class: 'tl-today', d: `M${r1(tx)} ${base - 20}V${base + 20}` }));
    if (todayLabel) kids.push(svg('text', { class: 'tl-lbl', x: r1(tx), y: 9, 'text-anchor': 'middle' }, todayLabel));
  }
  items.forEach((it, i) => {
    const x = xs[i];
    kids.push(
      svg('circle', { class: 'tl-dot', cx: r1(x), cy: base, r: 10 }, svg('title', {}, `${it.long} · ${it.label}`)),
      svg('text', { class: 'tl-n', x: r1(x), y: base + 4, 'text-anchor': 'middle' }, String(i + 1)),
      svg('text', { class: 'tl-lbl', x: r1(x), y: i % 2 === 0 ? base + 31 : base - 18, 'text-anchor': 'middle' }, it.short),
    );
  });
  return h(
    'div',
    { class: 'events' },
    svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids),
    h(
      'ol',
      { class: 'ev-list' },
      items.map((it, i) =>
        h('li', {}, h('i', { 'aria-hidden': 'true', text: String(i + 1) }), h('span', {}, h('b', { text: it.long }), it.rel ? h('small', { text: it.rel }) : null, h('span', { class: 'ev-what', text: it.label }))),
      ),
    ),
  );
}

// ─── sparklines and KPI cards ───────────────────────────────────────────────

/** A tiny trend line. values: numbers (oldest first). */
export function sparkline(values, { cls = 's1', aria } = {}) {
  const W = 96;
  const H = 30;
  const pad = 3;
  const v = values.length > 1 ? values : [0, ...values, ...values];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (W - pad * 2)) / (v.length - 1);
  const y = (n) => (hi === lo ? H / 2 : H - pad - ((n - lo) / span) * (H - pad * 2));
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  return svg(
    'svg',
    { class: 'spark', viewBox: `0 0 ${W} ${H}`, role: aria ? 'img' : null, 'aria-label': aria, 'aria-hidden': aria ? null : 'true' },
    svg('path', { class: `ar ${cls}`, d: `${d}L${x(v.length - 1).toFixed(1)} ${H - pad}L${x(0).toFixed(1)} ${H - pad}Z` }),
    svg('path', { class: `ln ${cls}`, d }),
    svg('circle', { class: `dot ${cls}`, cx: x(v.length - 1).toFixed(1), cy: y(v[v.length - 1]).toFixed(1), r: 2.6 }),
  );
}

/** KPI card with a sparkline. { label, value, note?, delta?: { text, dir: 'up'|'down'|'flat' }, values?: number[] } */
export function kpiCard({ label, value, note, delta, values, aria }) {
  return h(
    'div',
    { class: 'panel kpi-card' },
    h('p', { class: 'kpi-l', text: label }),
    h('p', { class: 'kpi-v', text: value }),
    h('div', { class: 'kpi-foot' }, delta ? h('span', { class: `delta ${delta.dir}`, text: delta.text }) : note ? h('span', { class: 'kpi-note', text: note }) : h('span', {}), values && values.length > 1 ? sparkline(values, { aria }) : null),
  );
}

/** Figure tiles. items: [{ label, value }]. */
export function kpiTiles(items) {
  return h(
    'div',
    { class: 'kpis' },
    items.map((i) => h('div', { class: 'kpi' }, h('p', { class: 'kpi-v', text: i.value }), h('p', { class: 'kpi-l', text: i.label }))),
  );
}

/** Vertical timeline. items: [{ when, who, url }]. */
export function timeline(items) {
  return h(
    'ol',
    { class: 'tl' },
    items.map((i) => h('li', {}, h('b', { text: i.when }), i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer nofollow', text: i.who }) : h('span', { text: i.who }))),
  );
}
