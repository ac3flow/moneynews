// Cheap, deterministic checks on Georgian output. They cannot judge grammar (the Georgian
// Grammar Checker agent does that), but they catch the failures that matter most: a model that
// answers in English, or one that drops the Georgian script.

const isGeorgian = (c: number): boolean => (c >= 0x10d0 && c <= 0x10ff) || (c >= 0x1c90 && c <= 0x1cbf) || (c >= 0x2d00 && c <= 0x2d2f);
const isLatin = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/** Share of Georgian letters among Georgian + Latin letters. 1 = all Georgian, 0 = none. */
export function georgianShare(text: string): number {
  let ka = 0;
  let latin = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isGeorgian(c)) ka++;
    else if (isLatin(c)) latin++;
  }
  return ka + latin === 0 ? 0 : ka / (ka + latin);
}

export const hasGeorgian = (text: string): boolean => georgianShare(text) > 0;

/**
 * True when the narrative fields are really Georgian. Brand names, tickers and acronyms stay in
 * Latin script on purpose (as in "Google-მა"), so the bar is a majority, not 100%.
 */
export function looksGeorgian(fields: { headline: string; summary: string; what_happened: string; why_it_matters: string; risks_uncertainty?: string | null }): boolean {
  const body = [fields.summary, fields.what_happened, fields.why_it_matters, fields.risks_uncertainty ?? ''].join(' ');
  return hasGeorgian(fields.headline) && georgianShare(body) >= 0.6;
}

// ─── deterministic proofreading ─────────────────────────────────────────────

export interface GeorgianProblem {
  /** headline, summary, what_happened ... */
  field: string;
  /** The words at fault, as written. */
  text: string;
  problem: string;
}

type Fields = Record<string, string | null | undefined>;

const KA = '\u10d0-\u10f0'; // the 33 letters of modern Georgian
const ARCHAIC = /[\u10f1-\u10fa\u10fc-\u10ff]/;
const MTAVRULI = /[\u1c90-\u1cbf]/;
const OTHER_SCRIPT = /[\u0400-\u052f\u0590-\u06ff\u3040-\u9fff\uac00-\ud7af]/;
// a Latin name carrying a Georgian ending after a hyphen is correct: Nvidia-ს, ETF-ები, „Google“-ის
const NAME_WITH_ENDING = new RegExp(`^[A-Za-z0-9&.'’“”"/+]+[-–][${KA}]+$`);
const HAS_KA = new RegExp(`[${KA}]`);
const HAS_LATIN = /[A-Za-z]/;
const FULL_STOP_END = /[.!?…]["“”»)’]*$/;

/**
 * Mistakes a script can see without understanding Georgian: letters that do not belong, a word that is
 * half Latin and half Georgian, broken spacing or punctuation, a repeated word, a sentence that stops
 * without ending. The proofreader agent judges the rest; this catches what must never get that far.
 */
export function georgianIssues(fields: Fields): GeorgianProblem[] {
  const out: GeorgianProblem[] = [];
  const add = (field: string, text: string, problem: string) => {
    if (!out.some((p) => p.field === field && p.text === text && p.problem === problem)) out.push({ field, text: text.slice(0, 60), problem });
  };
  for (const [field, raw] of Object.entries(fields)) {
    const value = (raw ?? '').trim();
    if (!value) continue;
    const prose = field !== 'figures_dates' && field !== 'affected_entities';

    const archaic = ARCHAIC.exec(value);
    if (archaic) add(field, value.slice(Math.max(0, archaic.index - 8), archaic.index + 8), 'uses an archaic Georgian letter that modern Georgian does not');
    const capital = MTAVRULI.exec(value);
    if (capital) add(field, value.slice(Math.max(0, capital.index - 8), capital.index + 8), 'uses Mtavruli capital letters; news text is written in Mkhedruli only');
    const other = OTHER_SCRIPT.exec(value);
    if (other) add(field, value.slice(Math.max(0, other.index - 8), other.index + 8), 'contains letters from a script that is not Georgian or Latin');

    for (const token of value.split(/\s+/)) {
      const word = token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
      if (HAS_KA.test(word) && HAS_LATIN.test(word) && !NAME_WITH_ENDING.test(word)) add(field, word, 'mixes Latin and Georgian letters in one word');
    }
    const repeated = new RegExp(`(?:^|\\s)([${KA}]{3,})\\s+\\1(?=\\s|[.,;:!?]|$)`).exec(value);
    if (repeated) add(field, `${repeated[1]} ${repeated[1]}`, 'the same word is written twice in a row');
    const stretched = new RegExp(`([${KA}])\\1{3,}`).exec(value);
    if (stretched) add(field, stretched[0], 'a letter is repeated several times');

    if (prose) {
      const spaceBefore = /\s[,;:!?]/.exec(value);
      if (spaceBefore) add(field, value.slice(Math.max(0, spaceBefore.index - 8), spaceBefore.index + 8), 'has a space before punctuation');
      const noSpaceAfter = new RegExp(`[,;:!?][${KA}]`).exec(value);
      if (noSpaceAfter) add(field, value.slice(Math.max(0, noSpaceAfter.index - 8), noSpaceAfter.index + 8), 'has no space after punctuation');
      const doubled = /,,|;;|!!|\?\?|\.\.(?!\.)/.exec(value);
      if (doubled) add(field, value.slice(Math.max(0, doubled.index - 8), doubled.index + 8), 'has doubled punctuation');
      if ((value.match(/\(/g) ?? []).length !== (value.match(/\)/g) ?? []).length) add(field, '( )', 'has an unclosed bracket');
      const opening = (value.match(/„/g) ?? []).length;
      if (opening !== (value.match(/[“”]/g) ?? []).length) add(field, '„ “', 'has an unclosed quotation mark');
      if ((value.match(/"/g) ?? []).length % 2 === 1) add(field, '"', 'has an unclosed quotation mark');
    }

    // every sentence-level field ends like a sentence (the headline and the key-figure lists do not)
    if (field === 'summary' || field === 'why_it_matters' || field === 'risks_uncertainty' || field === 'what_happened') {
      for (const para of value.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
        if (!FULL_STOP_END.test(para)) add(field, para.slice(-40), 'does not end with a full stop');
      }
    }
  }
  return out;
}
