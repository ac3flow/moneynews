import { describe, expect, it } from 'vitest';
import { fallbackImportance, importanceScore } from '../src/pipeline/importance';

describe('importanceScore', () => {
  const base = { llm: 60, publishers: 2, primary: false, georgia: false };

  it('stays between 0 and 100 and reaches both ends', () => {
    expect(importanceScore({ llm: 0, publishers: 0, primary: false, georgia: false })).toBe(0);
    expect(importanceScore({ llm: 100, publishers: 9, primary: true, georgia: true })).toBe(100);
    expect(importanceScore({ llm: 500, publishers: 99, primary: true, georgia: true })).toBe(100);
    expect(importanceScore({ llm: -40, publishers: -3, primary: false, georgia: false })).toBe(0);
  });

  it("is mostly the Research agent's judgement of how much the story matters", () => {
    expect(importanceScore({ ...base, llm: 90 })).toBeGreaterThan(importanceScore({ ...base, llm: 30 }) + 25);
  });

  it('rises with the number of independent publishers, with diminishing steps after five', () => {
    const at = (publishers: number) => importanceScore({ ...base, publishers });
    expect([0, 1, 2, 3, 4, 5].map(at)).toEqual([33, 36, 45, 53, 59, 63]);
    expect(at(8)).toBe(at(5));
  });

  it('adds a bonus for an official source and for Georgia, and does not use trust at all', () => {
    expect(importanceScore({ ...base, primary: true }) - importanceScore(base)).toBe(8);
    expect(importanceScore({ ...base, georgia: true }) - importanceScore(base)).toBe(7);
    expect(Object.keys(base)).not.toContain('trust');
  });

  it('gives older stories a stand-in from their trust score', () => {
    expect(fallbackImportance(90)).toBe(54);
    expect(fallbackImportance(0)).toBe(0);
    expect(fallbackImportance(300)).toBe(60);
  });
});
