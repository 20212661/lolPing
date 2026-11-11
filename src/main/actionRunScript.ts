import type { Plugin } from 'cordis';
import type { ActionsSettings } from '../shared/actionCatalog';
import type { CommandHostDeps } from './commandHost';

/** The 'run-script' action: runs the configured command line in a hidden shell, detached from lolPing. */
export const runScriptPlugin: Plugin.Function<{ deps: CommandHostDeps; action: ActionsSettings['runScript'] }> = (ctx, { deps, action }) => {
  ctx.effect(() => ctx.commands.register('run-script', async () => {
    const command = action.command.trim();
    if (!command) return { ok: false, error: 'unconfigured' as const };
    // Windows' default shell is cmd; the other platforms agree on /bin/sh
    const spawned = deps.platform === 'win'
      ? deps.spawnDetached('cmd.exe', ['/c', command])
      : deps.spawnDetached('/bin/sh', ['-c', command]);
    return spawned.ok ? { ok: true as const } : { ok: false, error: 'spawn' as const, detail: spawned.error };
  }));
};
