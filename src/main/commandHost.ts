import { Context, type Fiber, type Plugin } from 'cordis';
import type { ActionId, ActionsSettings, ActionResult, CustomAction } from '../shared/actionCatalog';
import type { Platform } from '../shared/platform';
import { aiExplainPlugin } from './actionAiExplain';
import { clipboardSearchPlugin } from './actionClipboardSearch';
import { openAppPlugin } from './actionOpenApp';
import { runScriptPlugin } from './actionRunScript';
import { CommandService, type ActionEnv, type ActionTrigger } from './commandService';

/**
 * The OS-level abilities the actions get, injected so tests can pass fakes. Everything Electron-specific
 * (shell, clipboard, processes) stays behind this interface; the plugins never import Electron.
 */
export interface CommandHostDeps {
  platform: Platform;
  readClipboard(): Promise<string>;
  /** Resolves with '' when it opened, or with the problem when it didn't (electron shell.openPath's shape). */
  openPath(path: string): Promise<string>;
  /** Resolves when the browser took the address; rejects when it couldn't. */
  openExternal(url: string): Promise<void>;
  /** Starts a process lolPing doesn't wait for. Failures to start come back synchronously. */
  spawnDetached(file: string, args: string[]): { ok: true } | { ok: false; error: string };
  fetchImpl: typeof fetch;
  runPlugin?(action: CustomAction, env: ActionEnv): Promise<ActionResult>;
}

interface HostConfig {
  deps: CommandHostDeps;
  actions: ActionsSettings;
}

/** Puts the command registry on the context, then loads each built-in action as its own Cordis plugin. */
const commandHostPlugin: Plugin.Function<HostConfig> = (ctx, { deps, actions }) => {
  new CommandService(ctx);
  ctx.plugin(openAppPlugin, { deps, action: actions.openApp });
  ctx.plugin(runScriptPlugin, { deps, action: actions.runScript });
  ctx.plugin(aiExplainPlugin, { deps, action: actions.aiExplain });
  ctx.plugin(clipboardSearchPlugin, { deps, action: actions.clipboardSearch });
  for (const action of actions.custom) {
    ctx.effect(() => ctx.commands.register(action.id, async (env) => {
      if (!action.enabled) return { ok: false, error: 'disabled' };
      return deps.runPlugin ? deps.runPlugin(action, env) : { ok: false, error: 'pluginLoad' };
    }));
  }
};

/**
 * The wheel actions' Cordis host: a Context whose fiber tree is the built-in plugins, one fiber per action.
 * Settings changes replace the whole tree; unloading it aborts whatever is still running.
 */
export class CommandHost {
  private readonly ctx = new Context();
  private fiber: Fiber | null = null;
  private readonly inFlight = new Set<AbortController>();
  private revision = 0;
  private ready = false;
  private changes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CommandHostDeps) {}

  /** (Re)loads the built-in actions with `actions` as their config. */
  applyConfig(actions: ActionsSettings): Promise<void> {
    const revision = ++this.revision;
    this.cancelRuns();
    this.changes = this.changes.catch(() => undefined).then(async () => {
      await this.disposeFiber();
      if (revision !== this.revision) return;
      const fiber = this.ctx.plugin(commandHostPlugin, { deps: this.deps, actions });
      this.fiber = fiber;
      await fiber;
      this.ready = revision === this.revision;
    });
    return this.changes;
  }

  /** Runs an action. An id nobody registered, or a host mid-reload, is an ordinary failure, not a throw. */
  async execute(id: ActionId, trigger?: ActionTrigger): Promise<ActionResult> {
    if (!this.ready) return { ok: false, error: 'unknown' };
    const handler = this.ctx.get('commands')?.get(id);
    if (!handler) return { ok: false, error: 'unknown' };
    const run = new AbortController();
    this.inFlight.add(run);
    const env: ActionEnv = { readClipboard: this.deps.readClipboard, signal: run.signal, trigger };
    try {
      const result = await handler(env);
      return run.signal.aborted ? { ok: false, error: 'unknown', detail: 'aborted' } : result;
    } catch (err) {
      if (run.signal.aborted) return { ok: false, error: 'unknown', detail: 'aborted' };
      return { ok: false, error: 'unknown', detail: String(err) };
    } finally {
      this.inFlight.delete(run);
    }
  }

  /** Stops the plugins and aborts the actions still running. Safe to call again. */
  unload(): Promise<void> {
    ++this.revision;
    this.cancelRuns();
    this.changes = this.changes.catch(() => undefined).then(() => this.disposeFiber());
    return this.changes;
  }

  private cancelRuns(): void {
    this.ready = false;
    for (const run of this.inFlight) run.abort();
    this.inFlight.clear();
  }

  private async disposeFiber(): Promise<void> {
    const fiber = this.fiber;
    this.fiber = null;
    if (fiber) await fiber.dispose();
  }
}
