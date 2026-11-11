import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultCustomAction } from '../../src/shared/actionCatalog';
import { PluginRunner, type PluginRequest } from '../../src/main/pluginRunner';

describe('plugin process boundary', () => {
  let dir: string;
  const children: ChildProcess[] = [];
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lolping-worker-'));
    const built = await build({
      entryPoints: [resolve('src/main/pluginWorker.ts')], outfile: join(dir, 'worker.cjs'),
      bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent', write: false,
    });
    await writeFile(join(dir, 'worker.cjs'), built.outputFiles[0].contents);
    // Node's IPC substitutes only the Electron transport; the production worker and plugin runtime are unchanged.
    await writeFile(join(dir, 'port.cjs'), `process.parentPort = {
      once: (_event, callback) => process.once('message', data => callback({ data })),
      postMessage: value => process.send(value),
    };`);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }));
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const launch = (onReady: () => void = () => {}) => {
    const child = fork(join(dir, 'worker.cjs'), [], {
      execArgv: ['--require', join(dir, 'port.cjs')], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    children.push(child);
    const port = new EventEmitter();
    child.on('exit', (code) => port.emit('exit', code ?? 1));
    child.on('message', (raw: unknown) => {
      if (typeof raw === 'object' && raw !== null && 'testReady' in raw) onReady();
      else port.emit('message', raw);
    });
    return Object.assign(port, {
      postMessage: (request: PluginRequest) => { child.send(request); },
      kill: () => child.kill(),
    });
  };

  it('runs the sample through the real worker entry and a process message round trip', async () => {
    const runner = new PluginRunner(() => launch());
    const result = await runner.execute({
      ...defaultCustomAction('plugin:hello', 'Hello'), entry: resolve('tools/plugin-examples/hello.cjs'),
      config: '{"message":"process round trip"}',
    }, { signal: new AbortController().signal, readClipboard: async () => '' });
    expect(result).toEqual({ ok: true, detail: 'process round trip' });
  });

  it('terminates an actual CPU loop on deadline while the parent remains responsive', async () => {
    const entry = join(dir, 'loop.cjs');
    await writeFile(entry, `module.exports = ctx => {
      ctx.effect(() => ctx.commands.register('hello', async () => {
        process.send({ testReady: true });
        while (true) {}
      }));
    };`);
    let markReady = (): void => {};
    const ready = new Promise<void>((resolveReady) => { markReady = resolveReady; });
    vi.useFakeTimers();
    const runner = new PluginRunner(() => launch(markReady));
    const result = runner.execute({ ...defaultCustomAction('plugin:loop', 'Loop'), entry }, {
      signal: new AbortController().signal, readClipboard: async () => '',
    });
    await ready;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toEqual({ ok: false, error: 'timeout' });
    expect(children[0].killed).toBe(true);
  });
});
