import { describe, expect, it } from 'vitest';
import type { CommandRun } from '../../packages/plugin-api/src/manifest';
import { cleanText, fillPlaceholders, runDeclarative } from '../../src/main/declarativeRun';

const cmd = (run: CommandRun, requires?: string[]): { run: CommandRun; requires?: string[] } => ({ run, requires });

describe('fillPlaceholders', () => {
  it('fills the text, the encoded text and config values', () => {
    expect(fillPlaceholders('{text}', 'hello world', {})).toBe('hello world');
    expect(fillPlaceholders('?q={text:url}', 'a b&c', {})).toBe(`?q=${encodeURIComponent('a b&c')}`);
    expect(fillPlaceholders('{config.model}', '', { model: 'deepseek-chat' })).toBe('deepseek-chat');
  });

  it('leaves everything else, including environment variables, untouched', () => {
    expect(fillPlaceholders('%USERPROFILE% {unknown}', 'x', {})).toBe('%USERPROFILE% {unknown}');
  });

  it('encodes {text:url} without eating the {text} inside other placeholders', () => {
    expect(fillPlaceholders('{text:url}|{text}', 'a b', {})).toBe(`${encodeURIComponent('a b')}|a b`);
  });
});

describe('cleanText', () => {
  it('collapses whitespace and newlines into one trimmed line', () => {
    expect(cleanText('  a\n b \t c\n')).toBe('a b c');
  });
});

describe('runDeclarative', () => {
  it('turns a url command into an openUrl effect with the text encoded', () => {
    expect(runDeclarative(cmd({ kind: 'url', url: 'https://x.com/?q={text:url}' }, ['text']), 'a b', {}))
      .toEqual({ kind: 'openUrl', url: `https://x.com/?q=${encodeURIComponent('a b')}` });
  });

  it('cleans the query text when the command asks for it', () => {
    const command = cmd({ kind: 'url', url: 'https://x.com/?q={text:url}', cleanText: true }, ['text']);
    expect(runDeclarative(command, ' a\nb ', {})).toEqual({ kind: 'openUrl', url: `https://x.com/?q=${encodeURIComponent('a b')}` });
  });

  it('fails as noText when a text-requiring command got nothing', () => {
    const url = cmd({ kind: 'url', url: 'https://x.com/?q={text:url}' }, ['text']);
    expect(runDeclarative(url, '  ', {})).toEqual({ kind: 'noText' });
    expect(runDeclarative(url, undefined, {})).toEqual({ kind: 'noText' });
  });

  it('fills {config.x} into an open target and its args', () => {
    const command = cmd({ kind: 'open', target: 'wt.exe', args: ['-d', '{config.home}', '{text}'] });
    expect(runDeclarative(command, 'hi', { home: 'C:\\repo' }))
      .toEqual({ kind: 'openTarget', target: 'wt.exe', args: ['-d', 'C:\\repo', 'hi'] });
  });

  it('answers unsupported for the run kinds later host steps execute', () => {
    expect(runDeclarative({ run: { kind: 'keys', keys: ['ctrl+c'] } }, '', {})).toEqual({ kind: 'unsupported' });
    expect(runDeclarative({ run: { kind: 'js' } }, '', {})).toEqual({ kind: 'unsupported' });
    expect(runDeclarative({ run: { kind: 'exec', file: 'python', protocol: 'plain' } }, '', {})).toEqual({ kind: 'unsupported' });
  });
});
