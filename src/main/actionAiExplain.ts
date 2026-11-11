import type { Plugin } from 'cordis';
import type { AiExplainConfig } from '../shared/actionCatalog';
import type { CommandHostDeps } from './commandHost';

/** Long clipboard texts are cut here: enough to explain a term or an error, bounded on the way out. */
const INPUT_LIMIT = 4000;
const SYSTEM_PROMPT = 'You explain text the user copied: a term, an error, anything. Answer in the language the text is written in, '
  + 'in a few short sentences, plain words, no markdown headings.';

export interface ExplainRequest {
  url: string;
  body: string;
}

/** The chat completion request an OpenAI-compatible API understands, for explaining `text`. */
export function explainRequest(cfg: AiExplainConfig, text: string): ExplainRequest {
  return {
    url: `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, INPUT_LIMIT) },
      ],
    }),
  };
}

/** Reads the assistant's message out of a chat completion reply, or null for any other shape. */
export function parseExplainAnswer(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' && content.trim() !== '' ? content.trim() : null;
}

/** The 'ai-explain' action: sends the clipboard text to the configured chat API and returns its answer. */
export const aiExplainPlugin: Plugin.Function<{ deps: CommandHostDeps; action: AiExplainConfig }> = (ctx, { deps, action }) => {
  ctx.effect(() => ctx.commands.register('ai-explain', async (env) => {
    if (!action.apiKey || !action.baseUrl || !action.model) return { ok: false, error: 'unconfigured' as const };
    const text = (await env.readClipboard()).trim();
    if (!text) return { ok: false, error: 'emptyClipboard' as const };
    const { url, body } = explainRequest(action, text);
    let res: Response;
    try {
      res = await deps.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${action.apiKey}`, 'content-type': 'application/json' },
        body,
        signal: env.signal,
      });
    } catch (err) {
      if (env.signal.aborted) return { ok: false, error: 'unknown' as const, detail: 'aborted' };
      return { ok: false, error: 'network' as const, detail: String(err) };
    }
    if (!res.ok) return { ok: false, error: 'http' as const, detail: String(res.status) };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, error: 'parse' as const };
    }
    const answer = parseExplainAnswer(json);
    return answer === null ? { ok: false, error: 'parse' as const } : { ok: true as const, detail: answer };
  }));
};
