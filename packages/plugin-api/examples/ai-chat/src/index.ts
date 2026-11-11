// In a real plugin: import { definePlugin, ... } from '@lolping/api';
import { definePlugin, type Invocation, type PluginContext } from '../../../src/api';

const PROMPTS: Record<string, (cfg: Readonly<Record<string, unknown>>) => string> = {
  explain: () => '解释用户选中的文本（术语、报错、代码都可能）。用文本本身的语言，几句话，不要标题。',
  translate: (cfg) => `把用户选中的文本翻译成${String(cfg.targetLang ?? '中文')}，只输出译文。`,
  polish: () => '润色用户选中的文本，保持原意和语言，只输出润色后的文本。',
};

export const activate = definePlugin((ctx: PluginContext) => {
  for (const name of Object.keys(PROMPTS)) {
    ctx.subscriptions.push(ctx.commands.register(name, (inv) => chat(ctx, inv)));
  }
});

async function chat(ctx: PluginContext, inv: Invocation) {
  const apiKey = await ctx.secrets.get('apiKey');
  const baseUrl = String(inv.config.baseUrl ?? '').replace(/\/+$/, '');
  if (!apiKey || !baseUrl) return { ok: false as const, error: 'unconfigured' as const };
  if (!inv.text?.trim()) return { ok: false as const, error: 'noText' as const };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: inv.config.model,
        stream: true,
        messages: [
          { role: 'system', content: PROMPTS[inv.command](inv.config) },
          { role: 'user', content: inv.text.slice(0, 4000) },
        ],
      }),
      signal: inv.signal,
    });
  } catch (err) {
    return { ok: false as const, error: inv.signal.aborted ? 'cancelled' as const : 'network' as const, detail: String(err) };
  }
  if (!res.ok || !res.body) return { ok: false as const, error: 'http' as const, detail: String(res.status) };

  // SSE: read line by line, append each delta to the result bubble as it arrives.
  let full = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!data || data === '[DONE]' || !line.startsWith('data:')) continue;
      try {
        const delta: unknown = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          inv.result.append(delta);
        }
      } catch { /* skip an incomplete line */ }
    }
  }
  if (!full.trim()) return { ok: false as const, error: 'parse' as const };

  if (inv.command === 'polish') inv.result.setActions([{ kind: 'paste', label: '替换原文' }, { kind: 'copy' }]);
  else inv.result.setActions([{ kind: 'copy' }]);
  return { ok: true as const };
}
