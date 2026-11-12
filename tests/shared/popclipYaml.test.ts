import { describe, expect, it } from 'vitest';
import { parsePopClipText } from '../../src/shared/popclipYaml';

describe('parsePopClipText', () => {
  it('takes JSON straight through', () => {
    expect(parsePopClipText('{"name":"DeepL","url":"https://x.com/***"}'))
      .toEqual({ name: 'DeepL', url: 'https://x.com/***' });
  });

  it('parses the PopClip YAML subset: top pairs, comments, quotes', () => {
    const yaml = [
      '# a PopClip extension',
      "name: 'DeepL'",
      'url: https://www.deepl.com/translator#en/de/***',
      'regular: "quoted value"',
    ].join('\n');
    expect(parsePopClipText(yaml)).toEqual({
      name: 'DeepL',
      url: 'https://www.deepl.com/translator#en/de/***', // a # inside a value is data, not a comment
      regular: 'quoted value',
    });
  });

  it('parses an actions list with several entries', () => {
    const yaml = [
      'name: Emojipedia',
      'actions:',
      '  - title: Search',
      '    url: https://e.org/?q=***',
      '  - title: Copy',
      '    keyCombo: command c',
    ].join('\n');
    expect(parsePopClipText(yaml)).toEqual({
      name: 'Emojipedia',
      actions: [
        { title: 'Search', url: 'https://e.org/?q=***' },
        { title: 'Copy', keyCombo: 'command c' },
      ],
    });
  });

  it('parses a single action written at the top level', () => {
    expect(parsePopClipText('name: X\nurl: https://x.com/***')).toEqual({ name: 'X', url: 'https://x.com/***' });
  });

  it('refuses nesting, arrays and anything richer than the subset', () => {
    expect(parsePopClipText('name:\n  nested: value')).toBeNull();
    expect(parsePopClipText('- just\n- a\n- list')).toBeNull();
    expect(parsePopClipText('plain word')).toBeNull();
  });

  it('refuses empty text and non-object JSON', () => {
    expect(parsePopClipText('')).toBeNull();
    expect(parsePopClipText('   ')).toBeNull();
    expect(parsePopClipText('[1,2]')).toBeNull();
    expect(parsePopClipText('42')).toBeNull();
  });
});
