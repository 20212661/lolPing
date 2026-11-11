import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import { createInvocation, RegisteredPlugin, type HostWire } from '../../src/main/pluginHostCore';

const manifest = {
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  engines: { lolping: '^1.0.0' },
  main: 'dist/index.js',
  permissions: ['open'],
  contributes: {
    commands: [
      { id: 'explain', title: 'Explain', run: { kind: 'js' } },
      { id: 'other', title: 'Other', run: { kind: 'js', handler: 'renamed' } },
      { id: 'open', title: 'Open', run: { kind: 'open', target: 'https://x.com' } },
    ],
  },
} as unknown as PluginManifest;

function makeWire() {
  const calls: Array<{ pluginId: string; invocationId: number; method: string; args: unknown[] }> = [];
  const results: Array<{ op: string; payload: unknown }> = [];
  const logs: string[] = [];
  const wire: HostWire = {
    call: async (pluginId, invocationId, method, args) => {
      calls.push({ pluginId, invocationId, method, args });
      return 'wire-value';
    },
    result: (_id, op, payload) => results.push({ op, payload }),
    log: (level, text) => logs.push(`${level}:${text}`),
  };
  return { wire, calls, results, logs };
}

describe('RegisteredPlugin', () => {
  it('accepts handlers the manifest declares, by id or by handler name', () => {
    const { wire } = makeWire();
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, wire);
    const ctx = reg.context('1.0.0');
    ctx.commands.register('explain', async () => undefined);
    ctx.commands.register('renamed', async () => undefined);
    expect([...reg.handlers.keys()].sort()).toEqual(['explain', 'renamed']);
  });

  it('refuses names the manifest does not declare, and duplicates', () => {
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, makeWire().wire);
    const ctx = reg.context('1.0.0');
    expect(() => ctx.commands.register('open', async () => undefined)).toThrow(/not declared/); // open kind, not js
    ctx.commands.register('explain', async () => undefined);
    expect(() => ctx.commands.register('explain', async () => undefined)).toThrow(/twice/);
  });

  it('disposes subscriptions in reverse order, and a throwing one does not stop the rest', () => {
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, makeWire().wire);
    const order: number[] = [];
    reg.subscriptions.push(
      { dispose: () => order.push(1) },
      { dispose: () => { throw new Error('x'); } },
      { dispose: () => order.push(3) },
    );
    reg.unload();
    expect(order).toEqual([3, 1]);
    expect(reg.handlers.size).toBe(0);
  });

  it('fires config listeners on configChanged but not on an invocation snapshot', () => {
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', { a: 1 }, makeWire().wire);
    const seen: string[][] = [];
    reg.context('1.0.0').config.onDidChange((keys) => seen.push(keys));
    reg.applyConfig({ a: 2 });
    expect(seen).toEqual([]); // an invocation's snapshot is not a settings change
    reg.configChanged({ a: 3 }, ['a']);
    expect(seen).toEqual([['a']]);
  });

  it('proxies storage and secrets over the wire with its own plugin id', async () => {
    const { wire, calls } = makeWire();
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, wire);
    const ctx = reg.context('1.0.0');
    await expect(ctx.secrets.get('apiKey')).resolves.toBe('wire-value');
    await ctx.storage.set('k', 1);
    expect(reg.store).toEqual({ k: 1 }); // the worker keeps its own copy for sync reads
    await ctx.storage.delete('k');
    expect(reg.store).toEqual({});
    expect(calls.map((c) => `${c.pluginId}:${c.method}`)).toEqual(['probe:secrets.get', 'probe:storage.set', 'probe:storage.delete']);
  });
});

describe('createInvocation', () => {
  it('streams set/append/actions over the wire until the invocation ends', () => {
    const { wire, results } = makeWire();
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, wire);
    const inv = createInvocation(reg, 7, {
      command: 'explain', handler: 'explain', trigger: { source: 'wheel', displayId: 1, x: 2, y: 3 },
      signal: new AbortController().signal, text: 'hello', textSource: 'selection', config: {},
    });
    inv.result.set('part 1');
    inv.result.append(' part 2');
    inv.result.setActions([{ kind: 'copy' }]);
    inv.end();
    inv.result.append('never');
    expect(results).toEqual([
      { op: 'set', payload: 'part 1' },
      { op: 'append', payload: ' part 2' },
      { op: 'actions', payload: [{ kind: 'copy' }] },
    ]);
  });

  it('rejects host calls after the invocation ends', async () => {
    const { wire } = makeWire();
    const reg = new RegisteredPlugin(manifest, '/plugins/probe', {}, wire);
    const inv = createInvocation(reg, 7, {
      command: 'explain', handler: 'explain', trigger: { source: 'wheel', displayId: 1, x: 2, y: 3 },
      signal: new AbortController().signal, config: {},
    });
    inv.end();
    await expect(inv.host.readClipboard()).rejects.toThrow(/ended/);
  });
});
