import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCustomAction } from '../../src/shared/actionCatalog';
import { parsePluginRequest, PluginRunner, type PluginRequest } from '../../src/main/pluginRunner';

class FakeProcess extends EventEmitter {
  request?: PluginRequest;
  killed = false;
  postMessage(request: PluginRequest): void { this.request = request; }
  kill(): void { this.killed = true; this.emit('exit', 0); }
}

const action = () => ({ ...defaultCustomAction('plugin:test', 'Test'), entry: resolve('tools/plugin-examples/hello.cjs') });
const env = (signal = new AbortController().signal) => ({ signal, readClipboard: async () => 'private text' });

describe('PluginRunner', () => {
  afterEach(() => vi.useRealTimers());

  it('passes the trigger and config but does not read the clipboard unless requested', async () => {
    const child = new FakeProcess();
    const runner = new PluginRunner(() => child);
    const readClipboard = async (): Promise<string> => { throw new Error('unexpected clipboard read'); };
    const trigger = { displayId: 2, x: 40, y: 50 };
    const result = runner.execute({ ...action(), config: '{"value":42}' }, { ...env(), readClipboard, trigger });
    expect(child.request).toMatchObject({ command: 'hello', config: { value: 42 }, clipboard: '', trigger });
    child.emit('message', { ok: true, detail: 'done', ignored: 'x' });
    expect(await result).toEqual({ ok: true, detail: 'done' });
    expect(child.killed).toBe(true);
  });

  it('bounds explicitly requested clipboard text', async () => {
    const child = new FakeProcess();
    const runner = new PluginRunner(() => child);
    const result = runner.execute({ ...action(), useClipboard: true }, { ...env(), readClipboard: async () => 'a'.repeat(20_000) });
    await vi.waitFor(() => expect(child.request).toBeDefined());
    expect(child.request?.clipboard.length).toBe(16_384);
    child.emit('message', { ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('kills a timed out invocation and allows it to be triggered again', async () => {
    vi.useFakeTimers();
    const children: FakeProcess[] = [];
    const runner = new PluginRunner(() => { const p = new FakeProcess(); children.push(p); return p; });
    const first = runner.execute(action(), env());
    expect(await runner.execute(action(), env())).toEqual({ ok: false, error: 'busy' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await first).toEqual({ ok: false, error: 'timeout' });
    expect(children[0].killed).toBe(true);
    const second = runner.execute(action(), env());
    children[1].emit('message', { ok: true });
    expect(await second).toEqual({ ok: true });
  });

  it('cancels a running process and ignores its late response', async () => {
    const child = new FakeProcess();
    const runner = new PluginRunner(() => child);
    const controller = new AbortController();
    const result = runner.execute(action(), env(controller.signal));
    controller.abort();
    child.emit('message', { ok: true });
    expect(await result).toEqual({ ok: false, error: 'unknown', detail: 'aborted' });
    expect(child.killed).toBe(true);
  });

  it('times out a stalled clipboard read without starting a process later', async () => {
    vi.useFakeTimers();
    const children: FakeProcess[] = [];
    const runner = new PluginRunner(() => { const p = new FakeProcess(); children.push(p); return p; });
    let release = (_text: string): void => {};
    const clipboard = new Promise<string>((resolveText) => { release = resolveText; });
    const result = runner.execute({ ...action(), useClipboard: true }, { ...env(), readClipboard: () => clipboard });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toEqual({ ok: false, error: 'timeout' });
    release('late');
    await Promise.resolve();
    expect(children).toHaveLength(0);
  });

  it('rejects disabled, unconfigured and malformed bindings before launch', async () => {
    const runner = new PluginRunner(() => { throw new Error('should not launch'); });
    expect(await runner.execute({ ...action(), enabled: false }, env())).toEqual({ ok: false, error: 'disabled' });
    expect(await runner.execute({ ...action(), entry: 'relative.cjs' }, env())).toEqual({ ok: false, error: 'unconfigured' });
    expect(await runner.execute({ ...action(), config: '{' }, env())).toEqual({ ok: false, error: 'pluginConfig' });
  });

  it('rejects malformed results and reports an unexpected process exit', async () => {
    const child = new FakeProcess();
    const runner = new PluginRunner(() => child);
    const first = runner.execute(action(), env());
    child.emit('message', { ok: false, error: 'invented' });
    expect(await first).toEqual({ ok: false, error: 'parse' });
    const second = runner.execute(action(), env());
    child.emit('exit', 9);
    expect(await second).toEqual({ ok: false, error: 'pluginLoad', detail: 'exit 9' });
  });

  it('limits parallel processes across different bindings', async () => {
    const children: FakeProcess[] = [];
    const runner = new PluginRunner(() => { const p = new FakeProcess(); children.push(p); return p; });
    const runs = Array.from({ length: 4 }, (_, i) => runner.execute({ ...action(), id: `plugin:p${i}` }, env()));
    expect(await runner.execute({ ...action(), id: 'plugin:overflow' }, env())).toEqual({ ok: false, error: 'busy' });
    children.forEach((p) => p.emit('message', { ok: true }));
    expect((await Promise.all(runs)).every((r) => r.ok)).toBe(true);
  });

  it('validates process requests and trigger coordinates', () => {
    const request = { entry: action().entry, command: 'hello', config: {}, clipboard: '' };
    expect(parsePluginRequest(request)).toMatchObject(request);
    for (const raw of [null, {}, { ...request, trigger: { displayId: 1, x: NaN, y: 0 } }]) {
      expect(parsePluginRequest(raw)).toBeNull();
    }
  });
});
