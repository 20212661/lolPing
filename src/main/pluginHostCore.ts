/**
 * The pure core of the shared plugin host worker: the PluginContext/Invocation objects the contract
 * (packages/plugin-api api.ts) promises, with every cross-process piece injected. The worker entry
 * wires these to parentPort; tests wire them to fakes.
 */

import type {
  CommandHandler, Config, Disposable, HostActions, Invocation, Logger, PluginContext, ResultView, Secrets, Storage,
} from '../../packages/plugin-api/src/api';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import type { HostMethod } from '../../packages/plugin-api/src/protocol';

/** What the worker needs to send to the main process, all validated on arrival there. */
export interface HostWire {
  call(pluginId: string, invocationId: number, method: HostMethod, args: unknown[]): Promise<unknown>;
  result(id: number, op: 'set' | 'append' | 'actions', payload: string | unknown[]): void;
  log(level: 'info' | 'warn' | 'error', text: string): void;
}

export const disposeAll = (subscriptions: Disposable[]): void => {
  for (const d of subscriptions.splice(0).reverse()) {
    try {
      d.dispose();
    } catch {
      // one plugin's failing disposer must not stop the rest
    }
  }
};

/** The handlers a plugin registered, kept by the worker to route invokes. */
export class RegisteredPlugin {
  readonly handlers = new Map<string, CommandHandler>();
  readonly subscriptions: Disposable[] = [];
  private readonly listeners: Array<(keys: string[]) => void> = [];
  private configSnap: Readonly<Record<string, unknown>>;

  constructor(
    readonly manifest: PluginManifest,
    readonly pluginPath: string,
    config: Readonly<Record<string, unknown>>,
    readonly wire: HostWire,
  ) {
    this.configSnap = { ...config };
  }

  /** The manifest's js handler names: register accepts nothing else, per the contract. */
  get declared(): Set<string> {
    return new Set(this.manifest.contributes.commands.flatMap((c) => (c.run.kind === 'js' ? [c.run.handler ?? c.id] : [])));
  }

  configApi(): Config {
    return {
      get: <T>(key: string): T | undefined => this.configSnap[key] as T | undefined,
      onDidChange: (listener: (keys: string[]) => void): Disposable => {
        this.listeners.push(listener);
        return { dispose: () => { const i = this.listeners.indexOf(listener); if (i >= 0) this.listeners.splice(i, 1); } };
      },
    };
  }

  secretsApi(): Secrets {
    return {
      get: async (key): Promise<string | undefined> => {
        const value = await this.wire.call(this.manifest.id, -1, 'secrets.get', [key]);
        return value === undefined || value === null ? undefined : String(value);
      },
    };
  }

  storageApi(): Storage {
    return {
      get: <T>(key: string): T | undefined => this.store?.[key] as T | undefined,
      set: (key, value) => {
        this.store = { ...this.store, [key]: value };
        return this.wire.call(this.manifest.id, -1, 'storage.set', [key, value]).then(() => undefined);
      },
      delete: (key) => {
        if (this.store) delete this.store[key];
        return this.wire.call(this.manifest.id, -1, 'storage.delete', [key]).then(() => undefined);
      },
    };
  }

  logApi(): Logger {
    const line = (level: 'info' | 'warn' | 'error') => (...args: unknown[]): void =>
      this.wire.log(level, args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 2000));
    return { info: line('info'), warn: line('warn'), error: line('error') };
  }

  context(apiVersion: string): PluginContext {
    return {
      pluginId: this.manifest.id,
      pluginPath: this.pluginPath,
      apiVersion,
      subscriptions: this.subscriptions,
      commands: {
        register: (name: string, handler: CommandHandler): Disposable => {
          if (!this.declared.has(name)) throw new Error(`command '${name}' is not declared in the manifest`);
          if (this.handlers.has(name)) throw new Error(`command '${name}' is registered twice`);
          this.handlers.set(name, handler);
          return { dispose: () => { this.handlers.delete(name); } };
        },
      },
      config: this.configApi(),
      secrets: this.secretsApi(),
      storage: this.storageApi(),
      log: this.logApi(),
    };
  }

  configChanged(config: Readonly<Record<string, unknown>>, changed: string[]): void {
    this.configSnap = { ...config };
    for (const l of [...this.listeners]) {
      try {
        l(changed);
      } catch {
        // a plugin's listener error must not break the config push
      }
    }
  }

  /** Updates the snapshot an invocation sees without firing onDidChange (that is the settings window's event). */
  applyConfig(config: Readonly<Record<string, unknown>>): void {
    this.configSnap = { ...config };
  }

  unload(): void {
    disposeAll(this.subscriptions);
    this.handlers.clear();
  }

  /** The plugin's whole storage, kept in the worker and mirrored to the main process per change. */
  store: Record<string, unknown> | undefined;
  setStore(store: Record<string, unknown>): void {
    this.store = store;
  }
}

/** One invocation's host proxy and result view, tied to the wire until the handler returns. */
export function createInvocation(

  reg: RegisteredPlugin,
  invocationId: number,
  payload: { command: string; handler: string; trigger: Invocation['trigger']; signal: AbortSignal; text?: string; textSource?: 'selection' | 'clipboard'; config: Record<string, unknown> },
): Invocation & { end(): void } {
  reg.applyConfig(payload.config);
  let live = true;
  const host: HostActions = {
    getSelection: () => wireCall('getSelection', []) as Promise<string>,
    readClipboard: () => wireCall('readClipboard', []) as Promise<string>,
    writeClipboard: (text) => wireCall('writeClipboard', [text]) as Promise<void>,
    paste: (text) => wireCall('paste', [text]) as Promise<void>,
    pressKeys: (keys, opts) => wireCall('pressKeys', [keys, opts]) as Promise<void>,
    open: (target, args) => wireCall('open', [target, args]) as Promise<void>,
    exec: (file, args, opts) => wireCall('exec', [file, args, opts]) as never,
    notify: (text) => wireCall('notify', [text]),
  };
  const wireCall = (method: HostMethod, args: unknown[]): Promise<unknown> => {
    if (!live) return Promise.reject(new Error('the invocation has ended'));
    return reg.wire.call(reg.manifest.id, invocationId, method, args);
  };
  const result: ResultView = {
    set: (text) => { if (live) reg.wire.result(invocationId, 'set', text.slice(0, 4000)); },
    append: (chunk) => { if (live) reg.wire.result(invocationId, 'append', chunk.slice(0, 4000)); },
    setActions: (actions) => { if (live) reg.wire.result(invocationId, 'actions', actions); },
  };
  return {
    command: payload.command,
    trigger: payload.trigger,
    signal: payload.signal,
    text: payload.text,
    textSource: payload.textSource,
    app: undefined, // the foreground app arrives with a later host step
    config: payload.config,
    host,
    result,
    // live flips when the handler settles; host/result turn into no-ops then
    end: () => { live = false; },
  };
}
