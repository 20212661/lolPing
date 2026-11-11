import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPlugin } from '../../src/main/pluginRuntime';

describe('pluginRuntime', () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
  const request = () => ({ entry: resolve('tools/plugin-examples/hello.cjs'), command: 'hello', config: {}, clipboard: '' });

  it('loads the sample Cordis plugin and selects commands with their configuration', async () => {
    expect(await runPlugin({ ...request(), config: { message: 'hello world' } })).toEqual({ ok: true, detail: 'hello world' });
    expect(await runPlugin({ ...request(), command: 'clipboard', config: { message: 'prefix: ' }, clipboard: 'text' }))
      .toEqual({ ok: true, detail: 'prefix: text' });
    expect(await runPlugin({ ...request(), command: 'clipboard' })).toEqual({ ok: false, error: 'emptyClipboard' });
  });

  it('runs the Cordis effect disposer before completing a command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-plugin-'));
    dirs.push(dir);
    const entry = join(dir, 'cleanup.cjs');
    const marker = join(dir, 'disposed.txt');
    await writeFile(entry, `const fs = require('node:fs');
module.exports = (ctx, config) => {
  ctx.effect(() => () => fs.writeFileSync(config.marker, 'disposed'));
  ctx.effect(() => ctx.commands.register('hello', async env => ({ ok: true, detail: String(env.trigger.x) })));
};`);
    expect(await runPlugin({ ...request(), entry, config: { marker }, trigger: { displayId: 1, x: 123, y: 5 } }))
      .toEqual({ ok: true, detail: '123' });
    expect(await readFile(marker, 'utf8')).toBe('disposed');
  });

  it('reports a missing module and a command that was never registered', async () => {
    expect(await runPlugin({ ...request(), entry: resolve('missing-plugin.cjs') })).toMatchObject({ ok: false, error: 'pluginLoad' });
    expect(await runPlugin({ ...request(), command: 'missing' })).toMatchObject({ ok: false, error: 'unconfigured' });
  });

  it('supports ESM plugins and rejects malformed results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-plugin-'));
    dirs.push(dir);
    const entry = join(dir, 'bad.mjs');
    await writeFile(entry, `export default ctx => {
  ctx.effect(() => ctx.commands.register('hello', async () => ({ success: true })));
};`);
    expect(await runPlugin({ ...request(), entry })).toEqual({ ok: false, error: 'parse' });
  });
});
