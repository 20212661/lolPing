/**
 * The four built-in wheel actions as one built-in plugin: an in-memory manifest whose handlers speak the
 * same contract API (packages/plugin-api) third-party plugins do, going through the same permission-checked
 * host actions. This replaces the v2 CommandHostDeps privilege channel; nothing here can do more than a
 * plugin in the plugins folder can. The wheel ids keep their v2 names ('open-app', …), so existing settings
 * keep working.
 */

import type { CommandHandler, CommandResult, Invocation } from '../../packages/plugin-api/src/api';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import type { BuiltinActionId } from '../shared/actionCatalog';

/** '' when there is nothing to open, or the kind of target an OS-level "open" can take: a scheme URL or a path. */
export function openAppTargetKind(target: string): 'empty' | 'url' | 'path' {
  const t = target.trim();
  if (!t) return 'empty';
  try {
    const scheme = new URL(t).protocol.slice(0, -1); // ':' off; a Windows drive path parses as scheme 'c'
    if (scheme.length >= 2 && /^[a-z][a-z0-9+.-]*$/i.test(scheme)) return 'url';
  } catch {
    // not a URL at all: a plain path
  }
  return 'path';
}

/** Long texts are cut here: enough to explain a term or an error, bounded on the way out. */
const INPUT_LIMIT = 4000;
const SYSTEM_PROMPT = 'You explain text the user copied: a term, an error, anything. Answer in the language the text is written in, '
  + 'in a few short sentences, plain words, no markdown headings.';

/** The chat completion request an OpenAI-compatible API understands, for explaining `text`. */
export function explainRequest(cfg: { baseUrl: string; model: string }, text: string): { url: string; body: string } {
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

/** The address that searches for `text`: the template's first '%s', or the template with the text appended. */
export function searchUrlFor(template: string, text: string, fallback: string): string {
  const q = encodeURIComponent(text);
  const t = template.trim();
  const base = t || fallback;
  return base.includes('%s') ? base.replace('%s', q) : `${base}${q}`;
}

/** The built-in plugin's manifest, the same shape a folder plugin's plugin.json has. */
export const BUILTIN_MANIFEST: PluginManifest = {
  id: 'builtin', name: 'lolPing built-ins', version: '1.0.0', engines: { lolping: '^1.0.0' },
  permissions: ['selection', 'clipboard.read', 'clipboard.write', 'open', 'shell', 'network'],
  contributes: {
    commands: [
      { id: 'open-app', title: 'Open app', run: { kind: 'js' } },
      { id: 'run-script', title: 'Run script', run: { kind: 'js' } },
      { id: 'ai-explain', title: 'Explain with AI', feedback: 'result', requires: ['text'], run: { kind: 'js' } },
      { id: 'clipboard-search', title: 'Search clipboard', requires: ['text'], run: { kind: 'js' } },
    ],
  },
};

export interface BuiltInAction {
  /** The v2 wheel id, unchanged so settings files keep working. */
  id: BuiltinActionId;
  feedback: 'instant' | 'result';
  /** Text-requiring built-ins get the selection first (the v2 versions read the clipboard only). */
  requiresText: boolean;
  handler: CommandHandler;
}

const openApp: CommandHandler = async (inv) => {
  const target = String(inv.config.target ?? '').trim();
  if (openAppTargetKind(target) === 'empty') return { ok: false, error: 'unconfigured' };
  await inv.host.open(target, []);
  return { ok: true };
};

const runScript: CommandHandler = async (inv) => {
  const command = String(inv.config.command ?? '').trim();
  if (!command) return { ok: false, error: 'unconfigured' };
  // host.open with arguments takes the detached-spawn path, which is exactly the v2 behaviour:
  // a hidden shell runs the line and lolPing does not wait for it.
  await inv.host.open('cmd.exe', ['/c', command]);
  return { ok: true };
};

const aiExplain: CommandHandler = async (inv) => {
  const cfg = inv.config as { baseUrl?: string; apiKey?: string; model?: string };
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) return { ok: false, error: 'unconfigured' };
  const text = (inv.text ?? '').trim();
  if (!text) return { ok: false, error: 'noText' };
  const { url, body } = explainRequest(cfg as { baseUrl: string; model: string }, text);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body,
      signal: inv.signal,
    });
  } catch (err) {
    if (inv.signal.aborted) return { ok: false, error: 'cancelled', detail: String(err) };
    return { ok: false, error: 'network', detail: String(err) };
  }
  if (!res.ok) return { ok: false, error: 'http', detail: String(res.status) };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'parse' };
  }
  const answer = parseExplainAnswer(json);
  return answer === null ? { ok: false, error: 'parse' } : { ok: true, detail: answer };
};

const clipboardSearch: CommandHandler = async (inv) => {
  const text = (inv.text ?? '').trim();
  if (!text) return { ok: false, error: 'noText' };
  await inv.host.open(searchUrlFor(String(inv.config.url ?? ''), text, 'https://www.bing.com/search?q=%s'), []);
  return { ok: true };
};

/** The built-ins by their v2 wheel id. */
export const BUILT_IN_ACTIONS: Record<BuiltinActionId, BuiltInAction> = {
  'open-app': { id: 'open-app', feedback: 'instant', requiresText: false, handler: openApp },
  'run-script': { id: 'run-script', feedback: 'instant', requiresText: false, handler: runScript },
  'ai-explain': { id: 'ai-explain', feedback: 'result', requiresText: true, handler: aiExplain },
  'clipboard-search': { id: 'clipboard-search', feedback: 'instant', requiresText: true, handler: clipboardSearch },
};

/** The Invocation shape a built-in handler gets; the runner in index.ts builds the real one. */
export type { Invocation, CommandResult };
