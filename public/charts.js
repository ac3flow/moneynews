// Small SVG/DOM chart builders. They take ready-made strings (already translated, already formatted)
// and never read story text as markup. Colours come from CSS classes (.f1-.f7 fills, .s1-.s7 strokes,
// .tm1-.tm5 treemap tiles), so light and dark themes need no code here.
// Nothing sets an inline style: the CSP forbids it, and SVG attributes are all these charts need.

import { h, svg } from './dom.js';

const FILLS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
const STROKES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
// Colour order for categories that must tell apart (slices, series, parties): emerald, amber, violet, teal, sky, deep emerald, grey.
const SERIES_F = ['f1', 'f3', 'f4', 'f6', 'f7', 'f2', 'f5'];
const SERIES_S = ['s1', 's3', 's4', 's6', 's7', 's2', 's5'];
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
    parts.map((it, n) => h('li', {}, svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('rect', { class: SERIES_F[n % SERIES_F.length], width: 10, height: 10 })), h('span', { text: it.label, title: it.label }), h('b', { text: it.text ?? String(it.n) }))),
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
    const el = svg('circle', { class: `ring ${SERIES_S[i % SERIES_S.length]}`, cx: 50, cy: 50, r: R, 'stroke-dasharray': `${r2(len)} ${r2(C - len)}`, 'stroke-dashoffset': r2(-off), transform: 'rotate(-90 50 50)' }, svg('title', {}, `${it.label}: ${it.text ?? it.n}`));
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
      svg('polygon', { class: i === 0 ? 'f1' : 'f2', points: `${r1(cx - w0 / 2)},${y} ${r1(cx + w0 / 2)},${y} ${r1(cx + w1 / 2)},${y + rowH} ${r1(cx - w1 / 2)},${y + rowH}` }, svg('title', {}, `${it.label}: ${it.text}`)),
      svg('text', { class: 'fl', x: 0, y: y + 16 }, svg('title', {}, it.label), clip(it.label, 20)),
      svg('text', { class: 'fv', x: 0, y: y + 33 }, it.text),
    );
  });
  const H = items.length * (rowH + gap) - gap;
  return svg('svg', { class: 'chart funnel', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
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

// ─── upright columns: one series, grouped, or stacked ──────────────────────

function seriesLegend(names) {
  return h(
    'ul',
    { class: 'legend row' },
    names.map((name, n) => h('li', {}, svg('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('rect', { class: SERIES_F[n % SERIES_F.length], width: 10, height: 10 })), h('span', { text: name, title: name }))),
  );
}

/**
 * Upright columns. labels: one per group. series: [{ name, values }]. One series is a plain column chart; several are
 * grouped side by side, or summed into one column per group when `stacked`.
 */
export function columns({ labels, series, aria, fmt = r1, stacked = false, W = 340, H = 170 }) {
  const pl = 34;
  const pr = 10;
  const pt = 14;
  const pb = 28;
  const iw = W - pl - pr;
  const ih = H - pt - pb;
  const sums = labels.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const top = niceMax(stacked ? Math.max(...sums) : Math.max(...series.flatMap((s) => s.values)));
  const y = (v) => pt + (1 - v / top) * ih;
  const base = pt + ih;
  const kids = [];
  for (const g of [0, 0.5, 1]) {
    const yy = pt + g * ih;
    kids.push(svg('path', { class: 'grid', d: `M${pl} ${yy.toFixed(1)}H${W - pr}` }), svg('text', { x: pl - 6, y: (yy + 3.5).toFixed(1), 'text-anchor': 'end' }, fmt(top * (1 - g))));
  }
  const gw = iw / labels.length;
  const inner = gw * 0.72;
  const bw = stacked ? inner : inner / series.length;
  const fit = Math.max(3, Math.floor(gw / 5.8));
  labels.forEach((l, i) => {
    const gx = pl + i * gw + (gw - inner) / 2;
    let acc = 0;
    series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      const x = stacked ? gx : gx + si * bw;
      const top0 = stacked ? y(acc + v) : y(v);
      const hgt = stacked ? y(acc) - y(acc + v) : base - y(v);
      acc += v;
      if (hgt <= 0) return;
      kids.push(svg('rect', { class: SERIES_F[si % SERIES_F.length], x: x.toFixed(1), y: top0.toFixed(1), width: Math.max(1, bw - 1.5).toFixed(1), height: hgt.toFixed(1), rx: 2 }, svg('title', {}, `${l}${series.length > 1 ? ` · ${s.name}` : ''}: ${fmt(v)}`)));
      if (series.length === 1 && bw >= 22) kids.push(svg('text', { class: 'val', x: (x + (bw - 1.5) / 2).toFixed(1), y: (top0 - 4).toFixed(1), 'text-anchor': 'middle' }, fmt(v)));
    });
    if (stacked && bw >= 22) kids.push(svg('text', { class: 'val', x: (gx + inner / 2).toFixed(1), y: (y(sums[i]) - 4).toFixed(1), 'text-anchor': 'middle' }, fmt(sums[i])));
    kids.push(svg('text', { x: (pl + i * gw + gw / 2).toFixed(1), y: H - 9, 'text-anchor': 'middle' }, svg('title', {}, l), clip(l, fit)));
  });
  const chart = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
  return series.length > 1 ? h('div', {}, chart, seriesLegend(series.map((s) => s.name))) : chart;
}

/** Horizontal stacked bars: one row per item, its parts side by side. rows: [{ label, total, parts: number[] }]. */
export function stackedRows({ rows, names, fmt = r1, aria }) {
  const top = Math.max(1e-9, ...rows.map((r) => r.parts.reduce((t, v) => t + v, 0)));
  return h(
    'div',
    { role: 'img', 'aria-label': aria },
    h(
      'div',
      { class: 'bars' },
      rows.map((r) => {
        let acc = 0;
        const sum = r.parts.reduce((t, v) => t + v, 0);
        return h(
          'div',
          { class: 'bar-row' },
          h('span', { text: r.label, title: r.label }),
          h('b', { text: fmt(sum) }),
          svg(
            'svg',
            { class: 'bar', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
            svg('rect', { class: 'trk', width: 100, height: 8 }),
            r.parts.map((v, i) => {
              const x = (acc / top) * 100;
              acc += v;
              return v > 0 ? svg('rect', { class: SERIES_F[i % SERIES_F.length], x: x.toFixed(1), width: Math.max(0.6, (v / top) * 100 - 0.4).toFixed(1), height: 8 }, svg('title', {}, `${r.label} · ${names[i]}: ${fmt(v)}`)) : null;
            }),
          ),
        );
      }),
    ),
    seriesLegend(names),
  );
}

// ─── slopegraph ─────────────────────────────────────────────────────────────

/** Space labels at least `gap` apart, keeping their order. */
function spread(ys, gap) {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const out = [...ys];
  let prev = -Infinity;
  for (const [y, i] of order) {
    out[i] = Math.max(y, prev + gap);
    prev = out[i];
  }
  return out;
}

/** Slopegraph: each item runs from its value at one moment to its value at another. items: [{ label, a, b, aText, bText }]. */
export function slope(items, { from, to, aria }) {
  const W = 340;
  const pt = 30;
  const pb = 12;
  const H = Math.max(120, items.length * 30 + pt + pb);
  const xa = 124;
  const xb = 216;
  const all = items.flatMap((i) => [i.a, i.b]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (v) => pt + (1 - (v - lo) / span) * (H - pt - pb);
  const ya = spread(items.map((i) => y(i.a)), 14);
  const yb = spread(items.map((i) => y(i.b)), 14);
  const kids = [svg('text', { class: 'sl-h', x: xa, y: 12, 'text-anchor': 'middle' }, clip(from, 14)), svg('text', { class: 'sl-h', x: xb, y: 12, 'text-anchor': 'middle' }, clip(to, 14))];
  items.forEach((it, i) => {
    const cls = it.b > it.a ? 's1' : it.b < it.a ? 'sneg' : 's3';
    kids.push(
      svg('path', { class: `ln ${cls}`, d: `M${xa} ${r1(y(it.a))}L${xb} ${r1(y(it.b))}` }, svg('title', {}, `${it.label}: ${it.aText} → ${it.bText}`)),
      svg('circle', { class: `dot ${cls}`, cx: xa, cy: r1(y(it.a)), r: 3 }),
      svg('circle', { class: `dot ${cls}`, cx: xb, cy: r1(y(it.b)), r: 3 }),
      svg('text', { class: 'sl-t', x: xa - 9, y: r1(ya[i] + 3.5), 'text-anchor': 'end' }, svg('title', {}, it.label), `${clip(it.label, 11)} ${it.aText}`),
      svg('text', { class: 'sl-t', x: xb + 9, y: r1(yb[i] + 3.5) }, `${it.bText} ${clip(it.label, 11)}`),
    );
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── gantt ──────────────────────────────────────────────────────────────────

/** Periods on a shared date axis. items: [{ label, start, end (whole days since 1970), range }], earliest start first. */
export function gantt(items, { today, todayLabel, aria }) {
  const W = 340;
  const rowH = 36;
  const pl = 8;
  const pr = 8;
  const lo = Math.min(...items.map((i) => i.start));
  const hi = Math.max(...items.map((i) => i.end));
  const span = hi - lo || 1;
  const x = (d) => pl + ((d - lo) / span) * (W - pl - pr);
  const H = items.length * rowH + 14;
  const kids = [];
  if (today != null && today >= lo && today <= hi) {
    kids.push(svg('path', { class: 'tl-today', d: `M${r1(x(today))} 4V${H - 4}` }));
    if (todayLabel) kids.push(svg('text', { class: 'tl-lbl', x: r1(x(today) + 3), y: H - 1 }, todayLabel));
  }
  items.forEach((it, i) => {
    const top = i * rowH + 4;
    const w = Math.max(5, x(it.end) - x(it.start));
    kids.push(
      svg('text', { class: 'gl', x: pl, y: top + 10 }, svg('title', {}, it.label), clip(it.label, 26)),
      svg('text', { class: 'gd', x: W - pr, y: top + 10, 'text-anchor': 'end' }, it.range),
      svg('rect', { class: 'trk2', x: pl, y: top + 16, width: W - pl - pr, height: 8, rx: 4 }),
      svg('rect', { class: SERIES_F[i % SERIES_F.length], x: r1(x(it.start)), y: top + 16, width: r1(Math.min(w, W - pr - x(it.start))), height: 8, rx: 4 }, svg('title', {}, `${it.label}: ${it.range}`)),
    );
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── network ────────────────────────────────────────────────────────────────

/**
 * Nodes and the links between them. nodes: [{ label }], links: [{ from, to, label }] (positions in nodes). The best connected node
 * sits in the middle when there are four or more; the rest sit on an ellipse around it.
 */
export function network({ nodes, links, aria }) {
  const W = 340;
  const H = 250;
  const cx = W / 2;
  const cy = H / 2;
  const deg = nodes.map((_, i) => links.filter((l) => l.from === i || l.to === i).length);
  const hub = nodes.length >= 4 && Math.max(...deg) >= 2 ? deg.indexOf(Math.max(...deg)) : -1;
  const rest = nodes.map((_, i) => i).filter((i) => i !== hub);
  const pos = nodes.map(() => [cx, cy]);
  rest.forEach((i, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / rest.length;
    pos[i] = [cx + Math.cos(a) * 112, cy + Math.sin(a) * 80];
  });
  const kids = [];
  for (const l of links) {
    const [x1, y1] = pos[l.from];
    const [x2, y2] = pos[l.to];
    kids.push(svg('path', { class: 'e-line', d: `M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}` }));
  }
  for (const l of links) {
    if (!l.label) continue;
    const [x1, y1] = pos[l.from];
    const [x2, y2] = pos[l.to];
    kids.push(svg('text', { class: 'e-lbl', x: r1((x1 + x2) / 2), y: r1((y1 + y2) / 2 + 3), 'text-anchor': 'middle' }, clip(l.label, 16)));
  }
  nodes.forEach((n, i) => {
    const [x, y] = pos[i];
    const below = y >= cy - 4;
    kids.push(
      svg('circle', { class: `${i === hub ? 'f1' : SERIES_F[(i % 6) + 1]} node`, cx: r1(x), cy: r1(y), r: Math.min(12, 6 + deg[i] * 2) }, svg('title', {}, n.label)),
      svg('text', { class: 'n-lbl', x: r1(x), y: r1(below ? y + Math.min(12, 6 + deg[i] * 2) + 11 : y - Math.min(12, 6 + deg[i] * 2) - 5), 'text-anchor': 'middle' }, svg('title', {}, n.label), clip(n.label, 16)),
    );
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
}

// ─── pie, waffle, Nightingale rose, parliament ──────────────────────────────

/** Pie: items [{ label, n, text }], seven slices at most. */
export function pie(items, { aria } = {}) {
  const parts = items.filter((i) => i.n > 0).slice(0, 7);
  const total = parts.reduce((s, i) => s + i.n, 0) || 1;
  const R = 25;
  const C = 2 * Math.PI * R;
  let off = 0;
  const segs = parts.map((it, i) => {
    const arc = (it.n / total) * C;
    const len = Math.max(0.5, arc - (parts.length > 1 ? 0.8 : 0));
    const el = svg('circle', { class: `pie-seg ${SERIES_S[i % SERIES_S.length]}`, cx: 50, cy: 50, r: R, 'stroke-dasharray': `${r2(len)} ${r2(C - len)}`, 'stroke-dashoffset': r2(-off), transform: 'rotate(-90 50 50)' }, svg('title', {}, `${it.label}: ${it.text ?? it.n}`));
    off += arc;
    return el;
  });
  return h('div', { class: 'donut-wrap' }, svg('svg', { class: 'donut', viewBox: '0 0 100 100', role: 'img', 'aria-label': aria }, segs), legendList(parts));
}

/** Waffle: one percentage as a hundred squares, filled from the bottom left. */
export function waffle(value, { text, label, aria } = {}) {
  const filled = Math.round(clamp(value, 0, 100));
  const cells = [];
  for (let k = 0; k < 100; k++) {
    const row = 9 - Math.floor(k / 10);
    const col = k % 10;
    cells.push(svg('rect', { class: k < filled ? 'f1' : 'trk', x: col * 10 + 0.8, y: row * 10 + 0.8, width: 8.4, height: 8.4, rx: 1.6 }));
  }
  return h(
    'div',
    { class: 'donut-wrap' },
    svg('svg', { class: 'donut', viewBox: '0 0 100 100', role: 'img', 'aria-label': aria }, cells),
    h('div', { class: 'waffle-note' }, h('b', { text: text ?? `${filled}%` }), label ? h('span', { text: label }) : null),
  );
}

/** Nightingale rose: one petal per item, its area following the value. items: [{ label, n, text }]. */
export function rose(items, { aria } = {}) {
  const parts = items.filter((i) => i.n > 0).slice(0, 7);
  const top = Math.max(1e-9, ...parts.map((i) => i.n));
  const k = parts.length;
  const step = (2 * Math.PI) / k;
  const petals = parts.map((it, i) => {
    const r = 46 * Math.sqrt(it.n / top);
    const a0 = -Math.PI / 2 + i * step + 0.02;
    const a1 = -Math.PI / 2 + (i + 1) * step - 0.02;
    const p = (a) => `${r1(50 + Math.cos(a) * r)} ${r1(50 + Math.sin(a) * r)}`;
    return svg('path', { class: SERIES_F[i % SERIES_F.length], d: `M50 50L${p(a0)}A${r1(r)} ${r1(r)} 0 0 1 ${p(a1)}Z` }, svg('title', {}, `${it.label}: ${it.text ?? it.n}`));
  });
  return h('div', { class: 'donut-wrap' }, svg('svg', { class: 'donut', viewBox: '0 0 100 100', role: 'img', 'aria-label': aria }, petals), legendList(parts));
}

/** Parliament chart: seats as dots on concentric arcs, parties in order from left to right. items: [{ label, n, text }], whole counts. */
export function parliament(items, { center, aria } = {}) {
  const parts = items.filter((i) => i.n > 0);
  const N = parts.reduce((s, i) => s + i.n, 0);
  const W = 340;
  const H = 176;
  const cx = W / 2;
  const cy = H - 14;
  const R = 150;
  const r0 = R * 0.38;
  const rows = clamp(Math.round(Math.sqrt(N / 2.4)), 2, 9);
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((R - r0) * i) / (rows - 1));
  const sum = radii.reduce((t, r) => t + r, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((N * r) / sum)));
  let diff = N - counts.reduce((t, c) => t + c, 0);
  for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) {
    const d = diff > 0 ? 1 : -1;
    if (counts[i] + d >= 1) {
      counts[i] += d;
      diff -= d;
    }
  }
  const seats = [];
  radii.forEach((r, i) => {
    const k = counts[i];
    for (let j = 0; j < k; j++) {
      const a = k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1));
      seats.push({ a, r, x: cx + Math.cos(a) * r, y: cy - Math.sin(a) * r });
    }
  });
  seats.sort((p, q) => q.a - p.a || p.r - q.r);
  const gap = Math.min((R - r0) / (rows - 1), (Math.PI * R) / Math.max(1, counts[rows - 1] - 1));
  const dot = Math.max(1.4, gap * 0.4);
  const owner = [];
  parts.forEach((p, i) => owner.push(...Array(p.n).fill(i)));
  const kids = seats.map((s, k) => svg('circle', { class: SERIES_F[owner[k] % SERIES_F.length], cx: r1(s.x), cy: r1(s.y), r: r1(dot) }, svg('title', {}, `${parts[owner[k]].label}: ${parts[owner[k]].text ?? parts[owner[k]].n}`)));
  if (center) kids.push(svg('text', { class: 'c-val', x: cx, y: cy - 4, 'text-anchor': 'middle' }, center));
  return h('div', {}, svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids), legendList(parts));
}

// ─── key terms ──────────────────────────────────────────────────────────────

/** Word cloud: terms [{ text, w }] with w from 1 (small) to 5 (large); the layout is a centred flow of words sized by weight. */
export function wordCloud(terms, { aria } = {}) {
  return h(
    'div',
    { class: 'cloud', role: 'img', 'aria-label': aria },
    terms.map((t, i) => h('span', { class: `cw cw-${t.w} cc-${i % 5}`, text: t.text })),
  );
}
