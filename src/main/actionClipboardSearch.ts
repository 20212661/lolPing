import type { Plugin } from 'cordis';
import { DEFAULT_SEARCH_URL, type ActionsSettings } from '../shared/actionCatalog';
import type { CommandHostDeps } from './commandHost';

/** The address that searches for `text`: the template's first '%s', or the template with the text appended. */
export function searchUrlFor(template: string, text: string): string {
  const q = encodeURIComponent(text);
  const t = template.trim();
  if (!t) return DEFAULT_SEARCH_URL.includes('%s') ? DEFAULT_SEARCH_URL.replace('%s', q) : `${DEFAULT_SEARCH_URL}${q}`;
  return t.includes('%s') ? t.replace('%s', q) : `${t}${q}`;
}

/** The 'clipboard-search' action: opens a search for the clipboard text in the browser. */
export const clipboardSearchPlugin: Plugin.Function<{ deps: CommandHostDeps; action: ActionsSettings['clipboardSearch'] }> = (ctx, { deps, action }) => {
  ctx.effect(() => ctx.commands.register('clipboard-search', async (env) => {
    const text = (await env.readClipboard()).trim();
    if (!text) return { ok: false, error: 'emptyClipboard' as const };
    try {
      await deps.openExternal(searchUrlFor(action.url, text));
      return { ok: true as const };
    } catch (err) {
      return { ok: false, error: 'spawn' as const, detail: String(err) };
    }
  }));
};
