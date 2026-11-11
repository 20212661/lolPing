import { Context, type Plugin } from 'cordis';
import { pathToFileURL } from 'node:url';
import { parseActionResult, type ActionResult } from '../shared/actionCatalog';
import { CommandService } from './commandService';
import type { PluginRequest } from './pluginRunner';

/** Runs inside the disposable process, including module loading and Cordis cleanup. */
export async function runPlugin(request: PluginRequest): Promise<ActionResult> {
  const ctx = new Context();
  const run = new AbortController();
  let result: ActionResult;
  const host: Plugin.Function = async (hostCtx) => {
    new CommandService(hostCtx);
    const module: unknown = await import(/* @vite-ignore */ pathToFileURL(request.entry).href);
    const exported = typeof module === 'object' && module !== null
      ? (module as Record<string, unknown>).default ?? module : module;
    if (typeof exported !== 'function' && !(typeof exported === 'object' && exported !== null
      && typeof (exported as Record<string, unknown>).apply === 'function')) {
      throw new Error('plugin must export a Cordis function or an object with apply');
    }
    await hostCtx.plugin(exported as Plugin, request.config);
  };
  const fiber = ctx.plugin(host);
  try {
    await fiber;
    const handler = ctx.get('commands')?.get(request.command);
    result = handler
      ? parseActionResult(await handler({
        readClipboard: async () => request.clipboard, signal: run.signal, trigger: request.trigger,
      })) ?? { ok: false, error: 'parse' }
      : { ok: false, error: 'unconfigured', detail: `unknown command: ${request.command}` };
  } catch (err) {
    result = { ok: false, error: 'pluginLoad', detail: String(err) };
  } finally {
    run.abort();
    await fiber.dispose();
  }
  return result;
}
