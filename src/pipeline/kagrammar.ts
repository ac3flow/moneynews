// Georgian Grammar & Copy Checker, then the Georgian Proofreader: two independent passes over the Georgian text.
// The Translator writes. The Checker corrects case endings, verb forms, agreement, spelling, punctuation and
// English-isms. Then code checks what a script can see (stray scripts, half-Latin words, broken punctuation) and
// the Proofreader, a second prompt that rewrites nothing, must approve every field or quote what is wrong.
// Only an approved text is marked checked and can be published. A text that fails goes back to the Checker with the
// quoted problems; after MAX_ATTEMPTS failures the article is rejected rather than shipped with errors.

import { nowIso } from '../time';
import { MAX_ATTEMPTS, attemptCounts, logEvent, type StageCtx } from './context';
import { georgianIssues, looksGeorgian, type GeorgianProblem } from './georgian';
import { digitsPreserved } from './numbers';
import { KA_GRAMMAR_SYSTEM, KA_REVIEW_SYSTEM } from './prompts';
import { rejectStatement } from './publish';
import { KaGrammarOutput, KaReviewOutput } from './schemas';

interface Pending {
  article_id: string;
  headline: string;
  summary: string;
  what_happened: string;
  why_it_matters: string;
  figures_dates: string | null;
  affected_entities: string | null;
  risks_uncertainty: string | null;
  trust_score: number;
  en_headline: string;
  en_summary: string;
  en_what_happened: string;
  en_why_it_matters: string;
  en_figures_dates: string | null;
  en_affected_entities: string | null;
  en_risks_uncertainty: string | null;
}

const FIELDS = ['headline', 'summary', 'what_happened', 'why_it_matters', 'figures_dates', 'affected_entities', 'risks_uncertainty'] as const;
type Texts = Record<(typeof FIELDS)[number], string | null | undefined>;
const joined = (o: Texts): string => FIELDS.map((f) => o[f] ?? '').join('\n');
const plain = (o: Texts): Record<(typeof FIELDS)[number], string> => Object.fromEntries(FIELDS.map((f) => [f, o[f] ?? ''])) as Record<(typeof FIELDS)[number], string>;

/** The problems recorded the last time this article failed, so the Checker can fix exactly those. */
async function earlierProblems(ctx: StageCtx, ids: string[]): Promise<Map<string, GeorgianProblem[]>> {
  const out = new Map<string, GeorgianProblem[]>();
  if (ids.length === 0) return out;
  const { results } = await ctx.env.DB.prepare(
    `SELECT article_id, detail FROM pipeline_events
     WHERE stage = 'ka_grammar' AND outcome = 'error' AND article_id IN (SELECT value FROM json_each(?1))
     ORDER BY id DESC`,
  )
    .bind(JSON.stringify(ids))
    .all<{ article_id: string; detail: string | null }>();
  for (const r of results) {
    if (out.has(r.article_id)) continue; // newest first
    try {
      const problems = (JSON.parse(r.detail ?? '{}') as { problems?: GeorgianProblem[] }).problems;
      if (Array.isArray(problems) && problems.length) out.set(r.article_id, problems.slice(0, 8));
    } catch {
      /* an unreadable note carries no hints */
    }
  }
  return out;
}

export async function kaGrammarStage(ctx: StageCtx): Promise<Record<string, unknown>> {
  const { env, now, cfg } = ctx;
  const { results: queue } = await env.DB.prepare(
    `SELECT t.article_id, t.headline, t.summary, t.what_happened, t.why_it_matters, t.figures_dates, t.affected_entities, t.risks_uncertainty, a.trust_score,
            a.headline AS en_headline, a.summary AS en_summary, a.what_happened AS en_what_happened, a.why_it_matters AS en_why_it_matters,
            a.figures_dates AS en_figures_dates, a.affected_entities AS en_affected_entities, a.risks_uncertainty AS en_risks_uncertainty
     FROM article_translations t JOIN articles a ON a.id = t.article_id
     WHERE t.lang = 'ka' AND t.grammar_checked = 0 AND a.status = 'edited'
     ORDER BY t.created_at ASC LIMIT ?1`,
  )
    .bind(cfg.maxArticlesPerRun)
    .all<Pending>();
  if (queue.length === 0) return { skipped: 'nothing to check' };
  if (!ctx.llm) return { skipped: 'GEMINI_API_KEY not configured', queued: queue.length };

  const attempts = await attemptCounts(ctx, 'ka_grammar', queue.map((q) => q.article_id));
  const statements: D1PreparedStatement[] = [];
  const live: Pending[] = [];
  let rejected = 0;
  for (const q of queue) {
    if ((attempts.get(q.article_id) ?? 0) >= MAX_ATTEMPTS) {
      statements.push(rejectStatement(env, q.article_id, now, { from: 'edited', factChecked: true, trustScore: q.trust_score }));
      logEvent(ctx, { articleId: q.article_id, stage: 'ka_grammar', outcome: 'rejected', detail: { reason: 'ka_grammar_failed', attempts: MAX_ATTEMPTS } });
      rejected++;
    } else live.push(q);
  }

  let checked = 0;
  let retry = 0;
  if (live.length) {
    const hints = await earlierProblems(ctx, live.map((q) => q.article_id));
    const out = await ctx.llm.json({
      system: KA_GRAMMAR_SYSTEM,
      user: JSON.stringify({
        articles: live.map((q) => ({ id: q.article_id, ...plain(q), ...(hints.has(q.article_id) ? { problems: hints.get(q.article_id) } : {}) })),
      }),
      schema: KaGrammarOutput,
      label: 'ka_grammar',
      model: env.GEMINI_MODEL_KA,
    });
    const byId = new Map(out.articles.map((a) => [a.id, a]));
    const ts = nowIso(now);

    const toReview: { q: Pending; c: NonNullable<ReturnType<typeof byId.get>> }[] = [];
    for (const q of live) {
      const c = byId.get(q.article_id);
      const reason = !c ? 'missing_from_output' : !digitsPreserved(joined(q), joined(c)) ? 'facts_changed' : !looksGeorgian(c) ? 'not_georgian' : null;
      if (!c || reason) {
        logEvent(ctx, { articleId: q.article_id, stage: 'ka_grammar', outcome: 'error', detail: { reason } });
        retry++;
        continue;
      }
      // The corrected text is kept either way, so the next attempt starts from it; only an approved text is marked checked.
      statements.push(
        env.DB.prepare(
          `UPDATE article_translations SET headline=?2, summary=?3, what_happened=?4, why_it_matters=?5, figures_dates=?6, affected_entities=?7,
             risks_uncertainty=?8, updated_at=?9
           WHERE article_id=?1 AND lang='ka' AND grammar_checked=0`,
        ).bind(q.article_id, c.headline, c.summary, c.what_happened, c.why_it_matters, c.figures_dates, c.affected_entities, c.risks_uncertainty, ts),
      );
      const issues = georgianIssues(plain(c)); // the story's fields only, not the checker's English note about its changes
      if (issues.length) {
        logEvent(ctx, { articleId: q.article_id, stage: 'ka_grammar', outcome: 'error', detail: { reason: 'script_issues', problems: issues.slice(0, 8) } });
        retry++;
      } else toReview.push({ q, c });
    }
    // Persist the corrected texts before the second model call, so an outage there loses nothing.
    if (statements.length) await env.DB.batch(statements.splice(0));

    if (toReview.length) {
      const review = await ctx.llm.json({
        system: KA_REVIEW_SYSTEM,
        user: JSON.stringify({
          articles: toReview.map(({ q, c }) => ({
            id: q.article_id,
            english: { headline: q.en_headline, summary: q.en_summary, what_happened: q.en_what_happened, why_it_matters: q.en_why_it_matters, figures_dates: q.en_figures_dates ?? '', affected_entities: q.en_affected_entities ?? '', risks_uncertainty: q.en_risks_uncertainty ?? '' },
            georgian: plain(c),
          })),
        }),
        schema: KaReviewOutput,
        label: 'ka_review',
        model: env.GEMINI_MODEL_KA,
      });
      const verdicts = new Map(review.articles.map((r) => [r.id, r]));
      for (const { q, c } of toReview) {
        const v = verdicts.get(q.article_id);
        if (v && v.ok && v.problems.length === 0) {
          statements.push(
            env.DB.prepare(`UPDATE article_translations SET grammar_checked=1, updated_at=?2 WHERE article_id=?1 AND lang='ka' AND grammar_checked=0`).bind(q.article_id, ts),
          );
          logEvent(ctx, { articleId: q.article_id, stage: 'ka_grammar', outcome: 'ok', detail: { corrections: c.corrections, reviewed: true } });
          checked++;
        } else {
          // approving with problems listed, or saying nothing, both count as "not approved"
          logEvent(ctx, { articleId: q.article_id, stage: 'ka_grammar', outcome: 'error', detail: { reason: v ? 'review_failed' : 'review_missing', problems: (v?.problems ?? []).slice(0, 8) } });
          retry++;
        }
      }
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return { checked, retry, rejected };
}
