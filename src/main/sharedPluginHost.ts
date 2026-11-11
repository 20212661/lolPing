/**
 * The main-process side of the shared plugin host: starts the worker lazily, loads plugins on demand,
 * routes invokes with per-command timeouts, restarts the process when one wedges, demotes plugins that
 * time out twice in a row to the one-shot model, and reclaims the process after an idle stretch.
 * The process handle is injected (the same shape PluginRunner tests use), so the lifecycle is testable.
 */

import type { Trigger } from '../../packages/plugin-api/src/api';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import { IDLE_MS, MAX_CONCURRENT, PROTOCOL_VERSION, type ToPluginHost } from '../../packages/plugin-api/src/protocol';
import { ResultCoalescer } from './resultStream';
import { parseHostMessage, type ParsedResult } from './pluginHostProtocol';

/** The process boundary, injected so tests can drive the lifecycle without Electron. */
export interface HostProcess {
  postMessage(m: ToPluginHost): void;
  on(event: 'message', listener: (value: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): unknown;
}

/** What a plugin may ask the host to do; implemented in index.ts against real OS abilities. */
export type HostActionRunner = (method: string, args: unknown[]) => Promise<unknown>;

export interface SharedHostDeps {
  launch(): HostProcess;
  /** Executes a validated host action for `pluginId`; rejects when the plugin lacks the permission. */
  execute(pluginId: string, method: string, args: unknown[]): Promise<unknown>;
  /** The plugin's manifest, entry path and config for a load; null when the scan no longer has it. */
  resolve(pluginId: string): { manifest: PluginManifest; entry: string; pluginPath: string; config: Record<string, unknown>; storage: Array<[string, unknown]> } | null;
  log(pluginId: string, level: 'info' | 'warn' | 'error', text: string): void;
  now(): number;
  schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(t: ReturnType<typeof setTimeout>): void;
}

export interface InvokeRequest {
  pluginId: string;
  handler: string;
  command: string;
  timeoutMs: number;
  text?: string;
  textSource?: 'selection' | 'clipboard';
  trigger: Trigger;
  /** The manifest's isolated flag: one throwaway process per invocation. */
  isolated?: boolean;
}

/** What the caller shows while the invocation runs: streaming text, then the final result. */
export interface InvokeEvents {
  onText(text: string): void;
}

interface ActiveInvoke {
  id: number;
  pluginId: string;
  resolve(result: ParsedResult): void;
  coalescer: ResultCoalescer | null;
  timer: ReturnType<typeof setTimeout>;
  process: HostProcess | null; // the process it started on, for restart scoping
}

export class SharedPluginHost {
  private process: HostProcess | null = null;
  private starting: Promise<HostProcess> | null = null;
  private readonly loaded = new Set<string>();
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly active = new Map<number, ActiveInvoke>();
  private readonly callReplies = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly timeouts = new Map<string, number>();
  private readonly demoted = new Set<string>();
  private seq = 0;
  private callSeq = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly deps: SharedHostDeps) {}

  /** Plugins whose last two invocations timed out; they run one-shot until the app restarts. */
  get demotedPlugins(): ReadonlySet<string> {
    return this.demoted;
  }

  /**
   * Runs one command. `isolated` (manifest flag or demotion) uses a throwaway process; otherwise the
   * shared process is started on demand and the plugin loaded into it first.
   */
  invoke(req: InvokeRequest, events?: InvokeEvents): Promise<ParsedResult> {
    if (this.disposed) return Promise.resolve({ ok: false, error: 'disabled' });
    if (this.active.size >= MAX_CONCURRENT) return Promise.resolve({ ok: false, error: 'busy' });
    const isolated = req.isolated === true || this.demoted.has(req.pluginId);
    return (isolated ? this.invokeOneShot(req, events) : this.invokeShared(req, events));
  }

  /** Pushes new config to a loaded plugin's onDidChange listeners. */
  configChanged(pluginId: string, config: Record<string, unknown>, changed: string[]): void {
    if (this.process && this.loaded.has(pluginId)) {
      this.process.postMessage({ t: 'config', pluginId, config, changed });
    }
  }

  stop(): void {
    this.disposed = true;
    if (this.idleTimer !== null) this.deps.cancel(this.idleTimer);
    for (const inv of this.active.values()) {
      this.deps.cancel(inv.timer);
      inv.resolve({ ok: false, error: 'cancelled' });
    }
    this.active.clear();
    this.killProcess();
  }

  private async invokeShared(req: InvokeRequest, events?: InvokeEvents): Promise<ParsedResult> {
    try {
      const proc = await this.ensureStarted();
      if (!(await this.ensureLoaded(proc, req.pluginId))) return { ok: false, error: 'pluginLoad' };
      return await this.dispatch(proc, req, events, null);
    } catch {
      return { ok: false, error: 'pluginLoad' };
    }
  }

  /** A demoted or isolated plugin gets its own process: load, invoke, settle, kill — nothing shared. */
  private async invokeOneShot(req: InvokeRequest, events?: InvokeEvents): Promise<ParsedResult> {
    let proc: HostProcess;
    try {
      proc = await this.startProcess();
    } catch {
      return { ok: false, error: 'pluginLoad' };
    }
    this.attach(proc);
    let result: ParsedResult;
    try {
      if (!(await this.loadInto(proc, req.pluginId))) return { ok: false, error: 'pluginLoad' };
      result = await this.dispatch(proc, req, events, proc);
    } catch {
      result = { ok: false, error: 'pluginLoad' };
    }
    try {
      proc.kill();
    } catch {
      // already gone
    }
    return result;
  }

  private async ensureStarted(): Promise<HostProcess> {
    if (this.process) return this.process;
    if (!this.starting) {
      this.starting = this.startProcess().then((proc) => {
        this.process = proc;
        this.attach(proc);
        return proc;
      }).catch((err: unknown) => {
        this.starting = null;
        throw err;
      });
    }
    return this.starting;
  }

  /** Forks a worker and waits for its ready event; no shared-state bookkeeping. */
  private startProcess(): Promise<HostProcess> {
    return new Promise((resolve, reject) => {
      const proc = this.deps.launch();
      let settled = false;
      const timer = this.deps.schedule(() => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch { /* already gone */ }
        reject(new Error('plugin host did not start'));
      }, 5000);
      proc.on('message', (raw) => {
        if (settled) return;
        const msg = parseHostMessage(raw);
        if (msg?.t === 'ready' && msg.protocol === PROTOCOL_VERSION) {
          settled = true;
          this.deps.cancel(timer);
          resolve(proc);
        }
      });
      proc.on('exit', () => {
        if (settled) return;
        settled = true;
        this.deps.cancel(timer);
        reject(new Error('plugin host exited during start'));
      });
    });
  }

  private attach(proc: HostProcess): void {
    proc.on('message', (raw) => this.onMessage(proc, raw));
    proc.on('exit', () => this.onExit(proc));
  }

  private async ensureLoaded(proc: HostProcess, pluginId: string): Promise<boolean> {
    if (proc === this.process && this.loaded.has(pluginId)) return true;
    const pending = this.loading.get(pluginId);
    if (pending && proc === this.process) return pending;
    const attempt = this.loadInto(proc, pluginId);
    if (proc === this.process) this.loading.set(pluginId, attempt);
    return attempt;
  }

  /** Sends the load for one plugin to one process and waits for its verdict. */
  private loadInto(proc: HostProcess, pluginId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const info = this.deps.resolve(pluginId);
      const timer = this.deps.schedule(() => {
        this.loading.delete(pluginId);
        resolve(false);
      }, 5000);
      const onMessage = (raw: unknown): void => {
        const msg = parseHostMessage(raw);
        if (!msg) return;
        if ((msg.t === 'loaded' || msg.t === 'loadFailed') && msg.pluginId === pluginId) {
          this.deps.cancel(timer);
          this.loading.delete(pluginId);
          if (msg.t === 'loaded') {
            if (proc === this.process) this.loaded.add(pluginId);
          } else {
            this.deps.log(pluginId, 'error', `load failed: ${msg.detail}`);
          }
          resolve(msg.t === 'loaded');
        }
      };
      proc.on('message', onMessage);
      if (info) {
        proc.postMessage({
          t: 'load', pluginId, pluginPath: info.pluginPath, entry: info.entry, manifest: info.manifest,
          config: info.config, apiVersion: '1.0.0', storage: info.storage,
        });
      } else {
        this.deps.cancel(timer);
        this.loading.delete(pluginId);
        resolve(false);
      }
    });
  }

  /** `owned` is the process a one-shot invocation owns (killed when it settles); null means shared. */
  private dispatch(proc: HostProcess, req: InvokeRequest, events: InvokeEvents | undefined, owned: HostProcess | null): Promise<ParsedResult> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      const coalescer = events
        ? new ResultCoalescer(33, (text) => events.onText(text), this.deps.schedule, this.deps.cancel)
        : null;
      const timer = this.deps.schedule(() => {
        // A wedged call restarts the shared process; the plugin's streak counter decides demotion.
        this.noteTimeout(req.pluginId);
        this.failActive(proc, id, { ok: false, error: 'timeout' });
        if (owned) {
          try {
            owned.kill();
          } catch {
            // already gone
          }
        } else {
          this.killProcess();
        }
      }, req.timeoutMs);
      const info = this.deps.resolve(req.pluginId);
      this.active.set(id, {
        id, pluginId: req.pluginId, resolve, coalescer, timer, process: owned,
      });
      proc.postMessage({
        t: 'invoke', id, pluginId: req.pluginId, command: req.command, handler: req.handler,
        ...(req.text !== undefined ? { text: req.text } : {}),
        ...(req.textSource !== undefined ? { textSource: req.textSource } : {}),
        trigger: req.trigger, config: info?.config ?? {},
      });
      this.armIdleTimer();
    });
  }

  private noteTimeout(pluginId: string): void {
    const n = (this.timeouts.get(pluginId) ?? 0) + 1;
    this.timeouts.set(pluginId, n);
    if (n >= 2 && !this.demoted.has(pluginId)) {
      this.demoted.add(pluginId);
      this.deps.log(pluginId, 'warn', 'two timeouts in a row: running one-shot (isolated) from now on');
    }
  }

  /** A successful invocation resets the plugin's timeout streak. */
  private noteSuccess(pluginId: string): void {
    this.timeouts.delete(pluginId);
  }

  private failActive(proc: HostProcess | null, id: number, result: ParsedResult): void {
    const inv = this.active.get(id);
    if (!inv) return;
    if (inv.process !== null && inv.process !== proc && proc !== null) return; // belongs to another process generation
    this.active.delete(id);
    this.deps.cancel(inv.timer);
    inv.coalescer?.flushNow();
    inv.resolve(result);
    this.armIdleTimer();
  }

  private killProcess(): void {
    const proc = this.process;
    this.process = null;
    this.starting = null; // a cached start promise would hand back this dead process
    this.loaded.clear();
    this.callReplies.clear();
    for (const inv of [...this.active.values()]) {
      if (inv.process !== null) continue; // one-shot invocations resolve through their own path
      this.active.delete(inv.id);
      this.deps.cancel(inv.timer);
      inv.coalescer?.flushNow();
      inv.resolve({ ok: false, error: 'pluginLoad', detail: 'host restarted' });
    }
    try {
      proc?.kill();
    } catch {
      // already gone
    }
  }

  private onExit(proc: HostProcess): void {
    if (this.process === proc) this.killProcess(); // also settles the shared invocations
    for (const inv of [...this.active.values()]) {
      if (inv.process === proc) {
        this.active.delete(inv.id);
        this.deps.cancel(inv.timer);
        inv.coalescer?.flushNow();
        inv.resolve({ ok: false, error: 'pluginLoad', detail: 'host exited' });
      }
    }
  }

  /** Five idle minutes with nothing running: hand the memory back. The next invoke starts fresh. */
  private armIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.deps.cancel(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.active.size > 0 || !this.process) return;
    this.idleTimer = this.deps.schedule(() => {
      this.idleTimer = null;
      if (this.active.size === 0) this.killProcess();
    }, IDLE_MS);
  }

  private onMessage(proc: HostProcess, raw: unknown): void {
    const msg = parseHostMessage(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'loaded':
      case 'loadFailed':
      case 'ready':
        return; // handled by the start/load waiters
      case 'log':
        this.deps.log(msg.pluginId, msg.level, msg.text);
        return;
      case 'call': {
        const id = ++this.callSeq;
        const inv = msg.invocationId !== undefined ? this.active.get(msg.invocationId) : undefined;
        // An invocation-scoped call from a dead invocation is refused; notify/storage live past the handler.
        if (msg.invocationId !== undefined && !inv) {
          proc.postMessage({ t: 'reply', callId: msg.callId, ok: false, error: 'the invocation has ended' });
          return;
        }
        void this.deps.execute(msg.pluginId, msg.method, msg.args).then(
          (value) => proc.postMessage({ t: 'reply', callId: msg.callId, ok: true, value }),
          (err: unknown) => proc.postMessage({ t: 'reply', callId: msg.callId, ok: false, error: String(err).slice(0, 2000) }),
        );
        return;
      }
      case 'result': {
        const inv = this.active.get(msg.id);
        if (!inv) return;
        if (msg.op === 'actions') {
          // Result buttons need a clickable bubble, which the click-through overlay cannot host yet.
          this.deps.log(inv.pluginId, 'info', 'result actions received; clickable bubbles arrive with a later step');
          return;
        }
        if (msg.op === 'set') inv.coalescer?.set(msg.text);
        else inv.coalescer?.append(msg.text);
        return;
      }
      case 'done': {
        const inv = this.active.get(msg.id);
        if (!inv) return;
        this.active.delete(msg.id);
        this.deps.cancel(inv.timer);
        if (msg.result.ok) this.noteSuccess(inv.pluginId);
        inv.coalescer?.flushNow();
        inv.resolve(msg.result);
        if (inv.process !== null) {
          try {
            inv.process.kill();
          } catch {
            // already gone
          }
        }
        this.armIdleTimer();
        return;
      }
    }
  }
}
