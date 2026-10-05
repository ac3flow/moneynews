import { describe, expect, it } from 'vitest';
import appJs from '../public/app.js?raw';
import chartsJs from '../public/charts.js?raw';
import coversJs from '../public/covers.js?raw';
import headers from '../public/_headers?raw';
import css from '../src/ui/input.css?raw';

describe('front end stays inside the CSP', () => {
  it('sets no inline style attributes and no inline event handlers', () => {
    for (const [name, src] of [['app.js', appJs], ['charts.js', chartsJs], ['covers.js', coversJs]] as const) {
      expect(src, `${name} style attribute`).not.toMatch(/setAttribute\(\s*['"]style|\bstyle\s*:\s*['"`]|style="/);
      expect(src, `${name} inline handler`).not.toMatch(/\bon(click|error|load)\s*=\s*["']/);
    }
  });

  it('writes markup with innerHTML only for the generated cover art', () => {
    expect(chartsJs).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    const uses = [...appJs.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]);
    expect(uses).toEqual(['coverMarkup(a.id, a.category)']);
    expect(appJs).not.toMatch(/insertAdjacentHTML|outerHTML/);
  });

  it('only shows https pictures, with no referrer, and the CSP lets them load', () => {
    expect(appJs).toMatch(/httpsImg\(img\.url\)/);
    expect(appJs).toMatch(/referrerpolicy: 'no-referrer'/);
    expect(headers).toMatch(/img-src 'self' data: https:/);
  });
});

describe('every chart class has a style', () => {
  const tokens = new Set<string>();
  for (const m of chartsJs.matchAll(/class:\s*(['`])([^'`]*)\1/g)) {
    // drop ${...} expressions, keep the literal words around them
    for (const w of (m[2] as string).replace(/\S*\$\{[^}]*\}/g, ' ').split(/\s+/)) if (w) tokens.add(w); // a word glued to ${...} is a prefix, covered below
  }
  for (const list of chartsJs.matchAll(/const (FILLS|STROKES) = \[([^\]]*)\]/g)) for (const w of (list[2] as string).matchAll(/'(\w+)'/g)) tokens.add(w[1] as string);
  for (const n of [1, 2, 3, 4, 5]) tokens.add(`tm${n}`);

  it('finds the classes it should', () => {
    for (const w of ['f1', 's7', 'tm5', 'ln', 'ring', 'g-val', 'r-area', 'tgt']) expect(tokens.has(w), w).toBe(true);
  });

  it('has a rule for each of them', () => {
    // classes that only mark a state for other rules, or style via a parent
    const markers = new Set(['peak', 'zero', 'val', 'dot', 'tm', 'neg', 'pos', 'up', 'down', 'flat', 'row', 'thin', 'tall']);
    const missing = [...tokens].filter((w) => !markers.has(w) && !new RegExp(`\\.${w.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });
});
