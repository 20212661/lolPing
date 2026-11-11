import { isAbsolute } from 'node:path';
import { parseActionResult, type ActionResult, type CustomAction } from '../shared/actionCatalog';
import type { ActionEnv, ActionTrigger } from './commandService';

export interface PluginRequest {
  entry: string;
  command: string;
  config: unknown;
  clipboard: string;
  trigger?: ActionTrigger;
}

export function parsePluginRequest(raw: unknown): PluginRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.entry !== 'string' || !isAbsolute(r.entry) || typeof r.command !== 'string'
    || !r.command || typeof r.clipboard !== 'string') return null;
  let trigger: ActionTrigger | undefined;
  if (r.trigger !== undefined) {
    if (typeof r.trigger !== 'object' || r.trigger === null) return null;
    const t = r.trigger as Record<string, unknown>;
    if (typeof t.displayId !== 'number' || !Number.isFinite(t.displayId)
      || typeof t.x !== 'number' || !Number.isFinite(t.x) || typeof t.y !== 'number' || !Number.isFinite(t.y)) return null;
    trigger = { displayId: t.displayId, x: t.x, y: t.y };
  }
  return { entry: r.entry, command: r.command, config: r.config, clipboard: r.clipboard.slice(0, 16_384), trigger };
}

/** The process boundary, injected so timeout and exit handling can be tested without Electron. */
export interface PluginProcess {
  postMessage(request: PluginRequest): void;
  on(event: 'message', listener: (value: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): unknown;
}

/** Each invocation gets a disposable process. A stuck plugin never blocks the gesture or Electron threads. */
export class PluginRunner {
  private readonly running = new Set<string>();

  constructor(private readonly launch: () => PluginProcess) {}

  execute(action: CustomAction, env: ActionEnv): Promise<ActionResult> {
    if (!action.enabled) return Promise.resolve({ ok: false, error: 'disabled' });
    if (!isAbsolute(action.entry) || !/\.(cjs|mjs|js)$/i.test(action.entry) || !action.command) {
      return Promise.resolve({ ok: false, error: 'unconfigured' });
    }
    if (this.running.has(action.id) || this.running.size >= 4) return Promise.resolve({ ok: false, error: 'busy' });
    let config: unknown;
    try { config = JSON.parse(action.config); }
    catch { return Promise.resolve({ ok: false, error: 'pluginConfig' }); }
    if (env.signal.aborted) return Promise.resolve({ ok: false, error: 'unknown', detail: 'aborted' });
    this.running.add(action.id);
    return new Promise((resolve) => {
      let child: PluginProcess | undefined;
      let settled = false;
      const finish = (result: ActionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        env.signal.removeEventListener('abort', abort);
        this.running.delete(action.id);
        try { child?.kill(); }
        catch { /* The process may already have exited. */ }
        resolve(result);
      };
      const abort = (): void => finish({ ok: false, error: 'unknown', detail: 'aborted' });
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), action.timeoutMs);
      env.signal.addEventListener('abort', abort, { once: true });
      // Clipboard reads are optional and included in the deadline, before any plugin receives data.
      void (async () => {
        try {
          const clipboard = action.useClipboard ? (await env.readClipboard()).slice(0, 16_384) : '';
          if (settled) return;
          child = this.launch();
          child.on('message', (raw) => finish(parseActionResult(raw) ?? { ok: false, error: 'parse' }));
          child.on('exit', (code) => finish({ ok: false, error: 'pluginLoad', detail: `exit ${code}` }));
          child.postMessage({ entry: action.entry, command: action.command, config, clipboard, trigger: env.trigger });
        } catch (err) {
          finish({ ok: false, error: 'pluginLoad', detail: String(err) });
        }
      })();
    });
  }
}
