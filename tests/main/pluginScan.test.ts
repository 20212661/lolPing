import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { commandRef } from '../../packages/plugin-api/src/manifest';
import { buildPluginList, findCommand, itemExists, listFolderInputs, scanPluginFolders } from '../../src/main/pluginScan';
import { commandGlyphUrl, commandIcons } from '../../src/shared/commandTiles';

const root = mkdtempSync(join(tmpdir(), 'lolping-plugins-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const folder = (name: string, manifest: unknown): string => {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  return name;
};

const GOOD = {
  id: 'quick-pack', name: 'Quick pack', version: '1.0.0', engines: { lolping: '^1.0.0' },
  permissions: ['open'], icon: 'text:DS',
  contributes: { commands: [
    { id: 'deepseek', title: 'DeepSeek', icon: 'text:DS', color: '#4d6bfe', run: { kind: 'open', target: 'https://chat.deepseek.com' } },
    { id: 'bing', title: 'Bing', requires: ['text'], run: { kind: 'url', url: 'https://www.bing.com/search?q={text:url}' } },
  ] },
};

describe('scanPluginFolders', () => {
  it('accepts valid folders and collects coded errors for broken ones', () => {
    folder('good', GOOD);
    folder('bad', { id: 'BAD', name: '', version: '1.0.0', engines: { lolping: '^9.0.0' }, contributes: { commands: [] } });
    const result = scanPluginFolders(listFolderInputs(root));
    expect(result.plugins.map((p) => p.manifest.id)).toEqual(['quick-pack']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].dir).toBe('bad');
    const codes = result.failures[0].errors.map((e) => e.code);
    expect(codes).toContain('id');
    expect(codes).toContain('name');
    expect(codes).toContain('enginesIncompatible');
    expect(codes).toContain('commands');
  });

  it('treats a folder with unparseable plugin.json as a coded failure, not a crash', () => {
    const dir = join(root, 'broken-json');
    mkdirSync(dir);
    writeFileSync(join(dir, 'plugin.json'), '{nope', 'utf8');
    const result = scanPluginFolders(listFolderInputs(root));
    const broken = result.failures.find((f) => f.dir === 'broken-json');
    expect(broken?.errors[0].code).toBe('root');
  });
});

describe('buildPluginList', () => {
  it('resolves each command to a tile icon and the full ref', () => {
    const list = buildPluginList(scanPluginFolders(listFolderInputs(root)), root);
    const pack = list.plugins.find((p) => p.id === 'quick-pack');
    expect(pack?.commands.map((c) => c.ref)).toEqual([commandRef('quick-pack', 'deepseek'), commandRef('quick-pack', 'bing')]);
    expect(pack?.commands[0].icon).toBe(commandGlyphUrl('DS', '#4d6bfe'));
    expect(pack?.commands[1].icon).toBe(commandGlyphUrl('DS', '#55c9ba')); // the plugin-level icon covers it
    expect(pack?.configuration).toEqual([]);
    expect(commandIcons(list)['quick-pack.bing']).toBe(commandGlyphUrl('DS', '#55c9ba'));
  });
});

describe('findCommand', () => {
  const scan = () => scanPluginFolders(listFolderInputs(root));

  it('finds the plugin and command a ref points at', () => {
    const found = findCommand(scan(), 'quick-pack.bing');
    expect(found?.command.run).toEqual({ kind: 'url', url: 'https://www.bing.com/search?q={text:url}', cleanText: false });
  });

  it('returns null for an unknown plugin or command', () => {
    expect(findCommand(scan(), 'nope.bing')).toBeNull();
    expect(findCommand(scan(), 'quick-pack.nope')).toBeNull();
  });

  it('counts a ref known to the scan as an existing wheel item, and an unknown one as gone', () => {
    const s = scan();
    expect(itemExists(s, 'quick-pack.bing')).toBe(true);
    expect(itemExists(s, 'nope.bing')).toBe(false);
    expect(itemExists(s, 'plugin:old' as never)).toBe(false); // v2 bindings are always gone now
    expect(itemExists(s, 'danger')).toBe(true); // pings always exist
  });
});
