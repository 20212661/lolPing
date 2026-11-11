import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import { IDLE_MS } from '../../packages/plugin-api/src/protocol';
import { SharedPluginHost, type HostProcess, type InvokeRequest } from '../../src/main/sharedPluginHost';

const manifest = {
  id: 'probe', name: 'Probe', version: '1.0.0', engines: { lolping: '^1.0.0' }, main: 'dist/index.js',
  contributes: { commands: [{ id: 'explain', title: 'Explain', run: { kind: 'js' } }] },
} as unknown as PluginManifest;

/** A fake utility process: sent holds what main wrote, emit feeds what "the worker" answered. */
class FakeProcess implements HostProcess {
  sent: unknown[] = [];
  killed = false;
  private readonly onMessage: Array<(v: unknown) => void> = [];
  private readonly onExit: Array<(c: number) => void> = [];
  postMessage(m: unknown): void {
    this.sent.push(m);
  }
  on(event: 'message', l: (v: unknown) => void): unknown;
  on(event: 'exit', l: (c: number) => void): unknown;
  on(event: 'message' | 'exit', l: ((v: unknown) => void) | ((c: number) => void)): unknown {
    (event === 'message' ? this.onMessage : this.onExit).push(l as never);
    return this;
  }
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    for (const l of [...this.onExit]) l(0);
  }
  /** The worker sends a message to main. */
  emit(m: unknown): void {
    for (const l of [...this.onMessage]) l(m);
  }
}

/** Runs the timers by hand, so timeouts and idle reclaim are deterministic. */
class Clock {
  private now = 0;
  private seq = 0;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();
  readonly schedule = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  readonly cancel = (t: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(t as unknown as number);
  };
  fire(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.tasks.entries()]) {
      if (t.at <= this.now) {
        this.tasks.delete(id);
        t.fn();
      }
    }
  }
}

function setup() {
  const clock = new Clock();
  const procs: FakeProcess[] = [];
  const executed: Array<{ pluginId: string; method: string; args: unknown[] }> = [];
  const logs: string[] = [];
  const host = new SharedPluginHost({
    launch: () => {
      const p = new FakeProcess();
      procs.push(p);
      queueMicrotask(() => p.emit({ t: 'ready', protocol: 1 }));
      return p;
    },
    resolve: (pluginId) => ({
      manifest, entry: `/plugins/${pluginId}/dist/index.js`, pluginPath: `/plugins/${pluginId}`,
      config: { model: 'x' }, storage: [],
    }),
    execute: async (pluginId, method, args) => {
      executed.push({ pluginId, method, args });
      return 'done-value';
    },
    log: (pluginId, level, text) => logs.push(`${pluginId}:${level}:${text}`),
    now: () => 0,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { host, procs, executed, logs, clock };
}

const req = (over: Partial<InvokeRequest> = {}): InvokeRequest => ({
  pluginId: 'probe', handler: 'explain', command: 'explain', timeoutMs: 1000,
  trigger: { source: 'wheel', displayId: 1, x: 10, y: 20 }, ...over,
});

describe('SharedPluginHost', () => {
  it('starts lazily, loads the plugin, runs the invoke and answers with done', async () => {
    const { host, procs } = setup();
    const promise = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0)); // let the fake ready land
    const proc = procs[0];
    expect(procs).toHaveLength(1);
    expect(proc.sent[0]).toMatchObject({ t: 'load', pluginId: 'probe' });
    proc.emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    const invoke = proc.sent.find((m) => (m as { t: string }).t === 'invoke');
    expect(invoke).toMatchObject({ pluginId: 'probe', handler: 'explain' });
    proc.emit({ t: 'result', id: 1, op: 'append', text: 'part ' });
    proc.emit({ t: 'result', id: 1, op: 'append', text: 'two' });
    proc.emit({ t: 'done', id: 1, result: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(procs[0].killed).toBe(false); // the shared process stays for the idle window
  });

  it('reuses the shared process and its loaded plugin for the next invoke', async () => {
    const { host, procs } = setup();
    const first = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'done', id: 1, result: { ok: true } });
    await first;
    const second = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    expect(procs).toHaveLength(1); // no second fork
    expect(procs[0].sent.filter((m) => (m as { t: string }).t === 'load')).toHaveLength(1);
    procs[0].emit({ t: 'done', id: 2, result: { ok: true } });
    await second;
  });

  it('times a wedged call out, restarts the process, and demotes after two in a row', async () => {
    const { host, procs, clock } = setup();
    const first = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    clock.fire(1001); // the invoke deadline passes with no done
    await expect(first).resolves.toEqual({ ok: false, error: 'timeout' });
    expect(procs[0].killed).toBe(true);
    expect(host.demotedPlugins.has('probe')).toBe(false); // one timeout is not a streak

    const second = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    expect(procs).toHaveLength(2); // restarted
    procs[1].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    clock.fire(1001);
    await expect(second).resolves.toEqual({ ok: false, error: 'timeout' });
    expect(host.demotedPlugins.has('probe')).toBe(true); // demoted: one-shot from now on

    const third = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    expect(procs).toHaveLength(3); // the demoted invoke forked its own process
    procs[2].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    const invokeMsg = procs[2].sent.find((m) => (m as { t: string }).t === 'invoke') as { id: number };
    procs[2].emit({ t: 'done', id: invokeMsg.id, result: { ok: true } });
    await expect(third).resolves.toEqual({ ok: true });
    expect(procs[2].killed).toBe(true); // the one-shot process is killed after it settles
  });

  it('answers host calls through execute and replies to the worker', async () => {
    const { host, procs, executed } = setup();
    const promise = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'call', callId: 5, pluginId: 'probe', invocationId: 1, method: 'readClipboard', args: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(executed).toEqual([{ pluginId: 'probe', method: 'readClipboard', args: [] }]);
    expect(procs[0].sent).toContainEqual({ t: 'reply', callId: 5, ok: true, value: 'done-value' });
    procs[0].emit({ t: 'done', id: 1, result: { ok: true } });
    await promise;
  });

  it('refuses a host call whose invocation already ended', async () => {
    const { host, procs } = setup();
    const promise = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'call', callId: 6, pluginId: 'probe', invocationId: 99, method: 'open', args: ['https://x.com'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(procs[0].sent).toContainEqual({ t: 'reply', callId: 6, ok: false, error: 'the invocation has ended' });
    procs[0].emit({ t: 'done', id: 1, result: { ok: true } });
    await promise;
  });

  it('reclaims the process after the idle window', async () => {
    const { host, procs, clock } = setup();
    const promise = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'done', id: 1, result: { ok: true } });
    await promise;
    expect(procs[0].killed).toBe(false);
    clock.fire(IDLE_MS + 1);
    expect(procs[0].killed).toBe(true);
  });

  it('answers busy when four invocations are already running', async () => {
    const { host, procs } = setup();
    const running = [1, 2, 3, 4].map(() => host.invoke(req()));
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    await expect(host.invoke(req())).resolves.toEqual({ ok: false, error: 'busy' });
    for (let id = 1; id <= 4; id++) procs[0].emit({ t: 'done', id, result: { ok: true } });
    await Promise.all(running);
  });

  it('stop() settles running invocations as cancelled', async () => {
    const { host, procs } = setup();
    const promise = host.invoke(req());
    await new Promise((r) => setTimeout(r, 0));
    procs[0].emit({ t: 'loaded', pluginId: 'probe', handlers: ['explain'] });
    await new Promise((r) => setTimeout(r, 0));
    host.stop();
    await expect(promise).resolves.toEqual({ ok: false, error: 'cancelled' });
    expect(procs[0].killed).toBe(true);
  });
});
