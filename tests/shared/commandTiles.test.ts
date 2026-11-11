import { describe, expect, it } from 'vitest';
import { commandGlyphUrl, commandIcons, fallbackTileUrl, parsePluginList, tileIconUrl, type PluginListResult } from '../../src/shared/commandTiles';

describe('tileIconUrl', () => {
  it('renders a text icon as the glyph inside the action circle', () => {
    expect(tileIconUrl('text:DS', null, '#4d6bfe')).toBe(commandGlyphUrl('DS', '#4d6bfe'));
  });

  it('uses a file icon the main process already read, and falls back when there is none', () => {
    expect(tileIconUrl('icon.svg', 'data:image/svg+xml,z', undefined)).toBe('data:image/svg+xml,z');
    expect(tileIconUrl(undefined, null, '#ffffff')).toBe(fallbackTileUrl('#ffffff'));
  });
});

describe('commandGlyphUrl', () => {
  it('builds an svg data url that carries the label and the color', () => {
    const url = commandGlyphUrl('释', '#b48aff');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('释');
    expect(decodeURIComponent(url)).toContain('#b48aff');
  });
});

const tile = (over: Record<string, unknown>): Record<string, unknown> => ({
  ref: 'p.c', title: 'C', icon: fallbackTileUrl(undefined), feedback: 'instant', runKind: 'url', ...over,
});

describe('parsePluginList', () => {
  it('accepts a list the main process built and keeps its tiles', () => {
    const list: PluginListResult = {
      plugins: [{
        id: 'p', name: 'P', version: '1.0.0', description: undefined, dir: 'p', permissions: ['open'],
        commands: [{ ref: 'p.c', title: 'C', icon: 'data:image/svg+xml,x', color: undefined, feedback: 'result', runKind: 'url' }],
        configuration: [{ key: 'k', type: 'string', title: 'K', description: undefined, default: 'v', enum: undefined, multiline: false }],
      }],
      failures: [],
    };
    const parsed = parsePluginList(list);
    expect(parsed).toEqual(list);
  });

  it('drops a command without a ref or with an unknown run kind', () => {
    const parsed = parsePluginList({
      plugins: [{ id: 'p', name: 'P', version: '1', dir: 'p', permissions: [], commands: [tile({}), tile({ ref: 'no-dot' }), tile({ runKind: 'weird' })], configuration: [] }],
      failures: [],
    });
    expect(parsed?.plugins[0].commands).toHaveLength(1);
  });

  it('replaces a non-data icon with the fallback tile', () => {
    const parsed = parsePluginList({
      plugins: [{ id: 'p', name: 'P', version: '1', dir: 'p', permissions: [], commands: [tile({ icon: 'https://evil/x.png' })], configuration: [] }],
      failures: [],
    });
    expect(parsed?.plugins[0].commands[0].icon).toBe(fallbackTileUrl(undefined));
  });

  it('maps an unknown failure code to root and keeps the path and value', () => {
    const parsed = parsePluginList({
      plugins: [],
      failures: [{ dir: 'bad', errors: [{ code: 'sneaky' }, { code: 'icon', path: 'icon', value: '../x.png' }] }],
    });
    expect(parsed?.failures[0].errors).toEqual([
      { code: 'root', path: undefined, value: undefined },
      { code: 'icon', path: 'icon', value: '../x.png' },
    ]);
  });

  it('rejects payloads that are not plugin lists', () => {
    expect(parsePluginList(null)).toBeNull();
    expect(parsePluginList({ plugins: 'x' })).toBeNull();
  });

  it('collects one icon per command for the overlays', () => {
    const list = parsePluginList({
      plugins: [{ id: 'p', name: 'P', version: '1', dir: 'p', permissions: [], commands: [tile({ ref: 'p.c', icon: 'data:image/svg+xml,x' }), tile({ ref: 'p.d' })], configuration: [] }],
      failures: [],
    });
    const icons = commandIcons(list!);
    expect(icons['p.c']).toBe('data:image/svg+xml,x');
    expect(icons['p.d']).toBe(fallbackTileUrl(undefined));
  });
});
