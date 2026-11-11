import type { Plugin } from 'cordis';
import type { ActionsSettings } from '../shared/actionCatalog';
import type { CommandHostDeps } from './commandHost';

/** '' when there is nothing to open, or the target an OS-level "open" can take: a scheme URL or a filesystem path. */
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

/** The 'open-app' action: opens the configured program, file or address the way the OS opens it. */
export const openAppPlugin: Plugin.Function<{ deps: CommandHostDeps; action: ActionsSettings['openApp'] }> = (ctx, { deps, action }) => {
  ctx.effect(() => ctx.commands.register('open-app', async () => {
    const kind = openAppTargetKind(action.target);
    if (kind === 'empty') return { ok: false, error: 'unconfigured' as const };
    if (kind === 'url') {
      try {
        await deps.openExternal(action.target.trim());
        return { ok: true as const };
      } catch (err) {
        return { ok: false, error: 'spawn' as const, detail: String(err) };
      }
    }
    // shell.openPath resolves with '' on success and the error message otherwise
    const problem = await deps.openPath(action.target.trim());
    return problem === '' ? { ok: true as const } : { ok: false, error: 'spawn' as const, detail: problem };
  }));
};
