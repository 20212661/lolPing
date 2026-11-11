import { describe, expect, it } from 'vitest';
import { convertKeyCombo, convertUrl, fromPopClip, slug } from '../../../packages/plugin-api/src/popclip';
import { validateManifest } from '../../../packages/plugin-api/src/validate';

describe('convertUrl', () => {
  it('turns both PopClip placeholders into the URL-encoded text placeholder', () => {
    expect(convertUrl('https://www.google.com/search?q=***')).toBe('https://www.google.com/search?q={text:url}');
    expect(convertUrl('https://x.com/?t={popclip text}')).toBe('https://x.com/?t={text:url}');
  });
});

describe('convertKeyCombo', () => {
  it('maps macOS modifiers onto their Windows counterparts', () => {
    expect(convertKeyCombo('command shift =')).toBe('ctrl+shift+=');
    expect(convertKeyCombo('option c')).toBe('alt+c');
  });

  it('returns null for a modifier it does not know', () => {
    expect(convertKeyCombo('hyper k')).toBeNull();
    expect(convertKeyCombo(42)).toBeNull();
  });
});

describe('slug', () => {
  it('derives an id from a display name and falls back when nothing usable remains', () => {
    expect(slug('Google Translate', 'fallback')).toBe('google-translate');
    expect(slug('翻译', 'fallback')).toBe('fallback');
  });
});

describe('fromPopClip', () => {
  it('converts url and key-press actions and skips applescript with a reason code', () => {
    const { manifest, skipped, warnings } = fromPopClip({
      name: 'Mixed',
      actions: [
        { title: 'Google', url: 'https://www.google.com/search?q={popclip text}' },
        { title: 'Link', keyCombo: 'command k' },
        { title: 'Say', applescript: 'say "{popclip text}"' },
      ],
    });
    expect(manifest.contributes.commands.map((c) => c.run.kind)).toEqual(['url', 'keys']);
    expect(skipped).toEqual([{ title: 'Say', reason: 'applescript' }]);
    expect(warnings).toEqual([]);
    expect(manifest.permissions).toEqual(['open', 'keys']);
  });

  it('keeps a key-press action with requiredApps but flags it instead of skipping', () => {
    const { skipped, warnings } = fromPopClip({
      name: 'App-bound',
      actions: [{ title: 'Link', keyCombo: 'command k', requiredApps: ['com.apple.Safari'] }],
    });
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([{ title: 'Link', reason: 'requiredApps' }]);
  });

  it('skips an action whose key combo names an unknown modifier', () => {
    const { skipped } = fromPopClip({ name: 'Weird', actions: [{ title: 'Hyper', keyCombo: 'hyper k' }] });
    expect(skipped).toEqual([{ title: 'Hyper', reason: 'keyCombo' }]);
  });

  it('produces a manifest that passes validation', () => {
    const { manifest } = fromPopClip({
      name: 'Mixed',
      actions: [
        { title: 'Google', url: 'https://www.google.com/search?q={popclip text}' },
        { title: 'Link', keyCombo: 'command k' },
      ],
    });
    const check = validateManifest(manifest);
    expect(check.ok, check.ok ? '' : check.errors.map((e) => `${e.code} at ${e.path}`).join('; ')).toBe(true);
  });

  it('reads a single action written at the top level', () => {
    const { manifest } = fromPopClip({ name: 'Single', url: 'https://x.com/?q=***' });
    expect(manifest.contributes.commands).toHaveLength(1);
    expect(manifest.contributes.commands[0].run).toEqual({ kind: 'url', url: 'https://x.com/?q={text:url}', cleanText: false });
  });
});
