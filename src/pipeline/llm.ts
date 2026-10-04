// Gemini client (same REST call agent 2 already makes, plus a system instruction,
// schema validation and one corrective retry). Every stage depends on the small `Llm`
// interface, so tests inject a fake and swapping providers is a one-file change.

import type { ZodType } from 'zod';
import type { Env } from '../types';

export interface JsonRequest<T> {
  /** Stable instructions for the stage. Trusted. */
  system: string;
  /** Per-run payload. Contains untrusted feed text, so it is always passed as data. */
  user: string;
  schema: ZodType<T>;
  /** For logs and errors only. */
  label: string;
  /** Overrides GEMINI_MODEL for this call (used by the Georgian stages). */
  model?: string;
}

export interface Llm {
  json<T>(req: JsonRequest<T>): Promise<T>;
}

export class LlmError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

// A model chosen for one stage (GEMINI_MODEL_KA) can be out of quota, not open to this key, or overloaded. Rather
// than stall the pipeline, that call falls back to the default model, and the override is not tried again for a while:
// ten minutes for quota and access (403, 404, 429), two for an overloaded or failing service (500, 502, 503, 504).
const unavailable = new Map<string, number>();
export const resetModelFallbacks = (): void => unavailable.clear();
const pauseFor = (status: number): number | null =>
  status === 403 || status === 404 || status === 429 ? 10 * 60_000 : status === 500 || status === 502 || status === 503 || status === 504 ? 2 * 60_000 : null;

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 90_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

type Turn = { role: 'user' | 'model'; parts: { text: string }[] };

export function createLlm(env: Env, fetchImpl: typeof fetch = fetch): Llm | null {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const base = (env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

  async function call(system: string, contents: Turn[], modelOverride?: string): Promise<string> {
    const wanted = modelOverride && modelOverride !== model && (unavailable.get(modelOverride) ?? 0) <= Date.now() ? modelOverride : model;
    try {
      return await callModel(system, contents, wanted);
    } catch (e) {
      const pause = e instanceof LlmError && e.status !== undefined ? pauseFor(e.status) : null;
      if (wanted === model || pause === null) throw e;
      unavailable.set(wanted, Date.now() + pause);
      console.warn(`Gemini model ${wanted} answered ${(e as LlmError).status}; using ${model} for the next ${pause / 60_000} minutes`);
      return callModel(system, contents, model);
    }
  }

  async function callModel(system: string, contents: Turn[], useModel: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetchImpl(`${base}/models/${useModel}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey as string },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16384 }, // default temperature: recommended for Gemini 3
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          throw new LlmError(`Gemini ${res.status}: ${detail}`, res.status === 429 || res.status >= 500, res.status);
        }
        const body = (await res.json()) as GeminiResponse;
        if (body.promptFeedback?.blockReason) throw new LlmError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`);
        const cand = body.candidates?.[0];
        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (cand?.finishReason === 'MAX_TOKENS') throw new LlmError('Gemini output was truncated (MAX_TOKENS)');
        if (!text.trim()) throw new LlmError(`Gemini returned no text (finishReason=${cand?.finishReason ?? 'none'})`);
        return text;
      } catch (e) {
        lastError = e;
        const retryable = e instanceof LlmError ? e.retryable : e instanceof Error && (e.name === 'TimeoutError' || e.name === 'TypeError');
        if (!retryable) break;
      }
    }
    throw lastError instanceof Error ? lastError : new LlmError(String(lastError));
  }

  return {
    async json<T>({ system, user, schema, label, model: modelOverride }: JsonRequest<T>): Promise<T> {
      const contents: Turn[] = [{ role: 'user', parts: [{ text: user }] }];
      let problem = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await call(system, contents, modelOverride);
        const parsed = parseJson(raw);
        if (parsed.ok) {
          const checked = schema.safeParse(parsed.value);
          if (checked.success) return checked.data;
          problem = checked.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        } else {
          problem = parsed.error;
        }
        contents.push(
          { role: 'model', parts: [{ text: raw.slice(0, 20_000) }] },
          { role: 'user', parts: [{ text: `Your previous response was invalid (${problem}). Return the complete corrected JSON only.` }] },
        );
      }
      throw new LlmError(`${label}: model output failed validation after retry (${problem})`);
    },
  };
}

export function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
}
