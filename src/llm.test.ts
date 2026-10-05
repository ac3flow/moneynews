import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmError, createLlm, parseJson, resetModelFallbacks } from '../src/pipeline/llm';
import type { Env } from '../src/types';

const schema = z.object({ ok: z.boolean() });
const reply = (text: string, extra: object = {}) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }] }), { status: 200 });

function setup(responses: (Response | Error)[], env: Partial<Env> = {}) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const r = responses.shift();
    if (!r) throw new Error('unexpected extra request');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const llm = createLlm({ GEMINI_API_KEY: 'k-123', ...env } as Env, fetchImpl);
  return { llm: llm!, calls };
}

describe('Gemini client', () => {
  it('is null without an API key', () => {
    expect(createLlm({} as Env)).toBeNull();
  });

  it('defaults to the current Gemini model and sends the documented request shape', async () => {
    const { llm, calls } = setup([reply('{"ok":true}')]);
    expect(await llm.json({ system: 'SYS', user: 'USER', schema, label: 't' })).toEqual({ ok: true });
    const c = calls[0]!;
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('k-123');
    expect(c.body.system_instruction.parts[0].text).toBe('SYS');
    expect(c.body.contents).toEqual([{ role: 'user', parts: [{ text: 'USER' }] }]);
    expect(c.body.generationConfig.responseMimeType).toBe('application/json');
    expect(c.body.generationConfig).not.toHaveProperty('temperature'); // Gemini 3 runs at its default
  });

  it('honours GEMINI_MODEL, a per-request model override and GEMINI_BASE_URL', async () => {
    const { llm, calls } = setup([reply('{"ok":true}'), reply('{"ok":true}')], { GEMINI_MODEL: 'model-a', GEMINI_BASE_URL: 'https://gw.example/v1beta/' });
    await llm.json({ system: 's', user: 'u', schema, label: 't' });
    await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'model-b' });
    expect(calls.map((c) => c.url)).toEqual(['https://gw.example/v1beta/models/model-a:generateContent', 'https://gw.example/v1beta/models/model-b:generateContent']);
  });

  it('surfaces Google\'s message for a retired model, without retrying a request that cannot succeed', async () => {
    const msg = '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users."}}';
    const { llm, calls } = setup([new Response(msg, { status: 404 })]);
    await expect(llm.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toThrow(/Gemini 404.*no longer available to new users/s);
    expect(calls).toHaveLength(1);
  });

  it('strips markdown fences, and retries once with the validation error when the output is invalid', async () => {
    const { llm, calls } = setup([reply('```json\n{"ok":"yes"}\n```'), reply('{"ok":true}')]);
    expect(await llm.json({ system: 's', user: 'u', schema, label: 't' })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const retry = calls[1]!.body.contents;
    expect(retry).toHaveLength(3);
    expect(retry[2].parts[0].text).toMatch(/invalid.*ok/s);
  });

  it('gives up after one corrective retry', async () => {
    const { llm } = setup([reply('not json'), reply('{"ok": 1}')]);
    await expect(llm.json({ system: 's', user: 'u', schema, label: 'research' })).rejects.toThrow(/research: model output failed validation/);
  });

  it('rejects truncated, empty and blocked responses with a clear message', async () => {
    await expect(setup([reply('{"ok":tr', { finishReason: 'MAX_TOKENS' })]).llm.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toThrow(/truncated/);
    await expect(setup([reply('   ')]).llm.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toThrow(/no text/);
    const blocked = new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
    await expect(setup([blocked]).llm.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toThrow(/blocked.*SAFETY/);
  });

  it('LlmError records whether a failure is worth retrying', () => {
    expect(new LlmError('x', true).retryable).toBe(true);
    expect(new LlmError('x').retryable).toBe(false);
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson('{')).toMatchObject({ ok: false });
  });
});

describe('a stage model that is out of quota falls back to the default model', () => {
  beforeEach(resetModelFallbacks);
  const quota = () => new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 });
  const model = (url: string) => /models\/([^:]+):/.exec(url)?.[1];

  it('answers 429 on the override, then uses the default model for that call', async () => {
    const { llm, calls } = setup([quota(), quota(), reply('{"ok":true}')], { GEMINI_MODEL: 'base-model' });
    expect(await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'big-model' })).toEqual({ ok: true });
    expect(calls.map((c) => model(c.url))).toEqual(['big-model', 'big-model', 'base-model']); // the one automatic retry, then the fallback
  });

  it('does not try the override again for a while, and a 404 or 403 also falls back', async () => {
    const { llm, calls } = setup([new Response('{"error":{"code":404}}', { status: 404 }), reply('{"ok":true}'), reply('{"ok":true}')], { GEMINI_MODEL: 'base-model' });
    await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'gone-model' });
    await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'gone-model' });
    expect(calls.map((c) => model(c.url))).toEqual(['gone-model', 'base-model', 'base-model']);
    const { llm: denied, calls: dc } = setup([new Response('{"error":{"code":403}}', { status: 403 }), reply('{"ok":true}')], { GEMINI_MODEL: 'base-model' });
    await denied.json({ system: 's', user: 'u', schema, label: 't', model: 'private-model' });
    expect(dc.map((c) => model(c.url))).toEqual(['private-model', 'base-model']);
  });

  it('an overloaded override (503) falls back for a short while, not ten minutes', async () => {
    const down = () => new Response('{"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}', { status: 503 });
    const { llm, calls } = setup([down(), down(), reply('{"ok":true}'), reply('{"ok":true}')], { GEMINI_MODEL: 'base-model' });
    expect(await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'big-model' })).toEqual({ ok: true });
    expect(await llm.json({ system: 's', user: 'u', schema, label: 't', model: 'big-model' })).toEqual({ ok: true });
    expect(calls.map((c) => model(c.url))).toEqual(['big-model', 'big-model', 'base-model', 'base-model']); // not retried on the big model right after
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 60_000); // two minutes later it is tried again
    const { llm: later, calls: lc } = setup([reply('{"ok":true}')], { GEMINI_MODEL: 'base-model' });
    await later.json({ system: 's', user: 'u', schema, label: 't', model: 'big-model' });
    vi.useRealTimers();
    expect(lc.map((c) => model(c.url))).toEqual(['big-model']);
  });

  it('other errors on the override are not hidden, and the default model itself is never swapped out', async () => {
    const { llm } = setup([new Response('{"error":{"code":400}}', { status: 400 })], { GEMINI_MODEL: 'base-model' });
    await expect(llm.json({ system: 's', user: 'u', schema, label: 't', model: 'odd-model' })).rejects.toThrow(/Gemini 400/);
    const { llm: base } = setup([quota(), quota()], { GEMINI_MODEL: 'base-model' });
    await expect(base.json({ system: 's', user: 'u', schema, label: 't' })).rejects.toThrow(/Gemini 429/);
  });
});
