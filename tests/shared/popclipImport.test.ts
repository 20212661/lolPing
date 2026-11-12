import { describe, expect, it } from 'vitest';
import { importPopClipText, parseImportReply } from '../../src/shared/popclipImport';

const MIXED = [
  'name: Mixed',
  'actions:',
  '  - title: Google',
  '    url: https://www.google.com/search?q=***',
  '  - title: Link',
  '    keyCombo: command k',
  '  - title: Say',
  '    applescript: say "hi"',
].join('\n');

describe('importPopClipText', () => {
  it('converts a pasted snippet into a manifest and keeps the skip reasons', () => {
    const r = importPopClipText(MIXED, 'snippet');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.conversion.manifest.id).toBe('mixed');
    expect(r.conversion.manifest.contributes.commands.map((c) => c.run.kind)).toEqual(['url', 'keys']);
    expect(r.conversion.skipped).toEqual([{ title: 'Say', reason: 'applescript' }]);
  });

  it('reports every reason when nothing survives the conversion', () => {
    const r = importPopClipText('name: Mac only\nactions:\n  - title: Say\n    applescript: say "hi"');
    expect(r).toEqual({
      ok: false,
      error: 'noCommands',
      skipped: [{ title: 'Say', reason: 'applescript' }],
    });
  });

  it('answers parse for text that is neither JSON nor the YAML subset', () => {
    expect(importPopClipText('words without any colon at all')).toEqual({ ok: false, error: 'parse', skipped: [] });
    // a stray pair parses but converts to nothing, which surfaces as noCommands with the reasons
    const stray = importPopClipText('garbage: value');
    expect(stray.ok).toBe(false);
    if (!stray.ok) expect(stray.error).toBe('noCommands');
    expect(importPopClipText('')).toEqual({ ok: false, error: 'parse', skipped: [] });
  });

  it('takes JSON popclip configs too', () => {
    const r = importPopClipText('{"name":"J","url":"https://j.com/***"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.conversion.manifest.contributes.commands[0].run).toMatchObject({ kind: 'url' });
  });
});

describe('parseImportReply', () => {
  it('accepts a success with its dir, skips and warnings', () => {
    const reply = parseImportReply({
      ok: true, dir: 'mixed',
      skipped: [{ title: 'Say', reason: 'applescript' }],
      warnings: [{ title: 'Link', reason: 'requiredApps' }],
    });
    expect(reply).toEqual({
      ok: true, dir: 'mixed',
      skipped: [{ title: 'Say', reason: 'applescript' }],
      warnings: [{ title: 'Link', reason: 'requiredApps' }],
    });
  });

  it('drops malformed entries and rejects unknown shapes', () => {
    expect(parseImportReply({ ok: true, dir: 'x', skipped: ['nope', { title: 'T', reason: 'shell' }] })?.skipped)
      .toEqual([{ title: 'T', reason: 'shell' }]);
    expect(parseImportReply({ ok: false, error: 'sneaky' })).toBeNull();
    expect(parseImportReply(null)).toBeNull();
  });
});
