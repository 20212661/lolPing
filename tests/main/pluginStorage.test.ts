import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { moveLegacyPluginData, pluginDataDirIn, readPluginStore, writePluginStore } from '../../src/main/pluginStorage';

const dir = mkdtempSync(join(tmpdir(), 'lolping-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('pluginStorage', () => {
  it('round-trips a store atomically', () => {
    writePluginStore(dir, 'probe', { count: 3, label: 'x', nested: { a: 1 } });
    expect(readPluginStore(dir, 'probe')).toEqual({ count: 3, label: 'x', nested: { a: 1 } });
    writePluginStore(dir, 'probe', { count: 4 });
    expect(readPluginStore(dir, 'probe')).toEqual({ count: 4 });
  });

  it('treats a missing or broken file as an empty store', () => {
    expect(readPluginStore(dir, 'never-written')).toEqual({});
    writeFileSync(join(dir, 'broken.json'), '{nope', 'utf8');
    expect(readPluginStore(dir, 'broken')).toEqual({});
  });

  it('caps the number of keys it will write', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) big[`k${i}`] = i;
    writePluginStore(dir, 'big', big);
    expect(Object.keys(readPluginStore(dir, 'big')).length).toBe(256);
  });
});
describe('moveLegacyPluginData', () => {
  it('moves plugins/data to plugin-data once, so the folder scan stops seeing it', () => {
    const base = mkdtempSync(join(tmpdir(), 'lolping-legacy-'));
    const root = join(base, 'plugins');
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'probe.json'), '{"n":1}');
    const target = pluginDataDirIn(base);
    expect(moveLegacyPluginData(root, target)).toBe(true);
    expect(existsSync(join(root, 'data'))).toBe(false);
    expect(readPluginStore(target, 'probe')).toEqual({ n: 1 });
    expect(moveLegacyPluginData(root, target)).toBe(false); // nothing left to move
    rmSync(base, { recursive: true, force: true });
  });

  it('never touches a real plugin that happens to be called data', () => {
    const base = mkdtempSync(join(tmpdir(), 'lolping-legacy-'));
    const root = join(base, 'plugins');
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'plugin.json'), '{}');
    expect(moveLegacyPluginData(root, pluginDataDirIn(base))).toBe(false);
    expect(existsSync(join(root, 'data', 'plugin.json'))).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });
});
