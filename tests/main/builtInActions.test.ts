import { describe, expect, it } from 'vitest';
import type { Invocation } from '../../packages/plugin-api/src/api';
import { BUILT_IN_ACTIONS, BUILTIN_MANIFEST, explainRequest, openAppTargetKind, parseExplainAnswer, searchUrlFor } from '../../src/main/builtInActions';

describe('openAppTargetKind', () => {
  it('tells empty, url and path apart', () => {
    expect(openAppTargetKind('')).toBe('empty');
    expect(openAppTargetKind('  ')).toBe('empty');
    expect(openAppTargetKind('https://x.com')).toBe('url');
    expect(openAppTargetKind('C:\\tools\\x.exe')).toBe('path');
    expect(openAppTargetKind('wt.exe')).toBe('path');
  });
});

describe('explainRequest', () => {
  it('builds the chat completion request against the configured base url', () => {
    const r = explainRequest({ baseUrl: 'https://api.x.com/v1/', model: 'm1' }, 'hello');
    expect(r.url).toBe('https://api.x.com/v1/chat/completions');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('m1');
    expect(body.messages).toHaveLength(2);
  });

  it('cuts long input to the limit', () => {
    const body = JSON.parse(explainRequest({ baseUrl: 'https://x.com', model: 'm' }, 'y'.repeat(9000)).body);
    expect(body.messages[1].content).toHaveLength(4000);
  });
});

describe('parseExplainAnswer', () => {
  it('reads the assistant message and rejects anything else', () => {
    expect(parseExplainAnswer({ choices: [{ message: { content: ' the answer ' } }] })).toBe('the answer');
    expect(parseExplainAnswer({ choices: [] })).toBeNull();
    expect(parseExplainAnswer({ choices: [{ message: { content: '  ' } }] })).toBeNull();
    expect(parseExplainAnswer('nope')).toBeNull();
  });
});

describe('searchUrlFor', () => {
  it('fills the first %s, appends when there is none, and falls back to the default', () => {
    expect(searchUrlFor('https://s/?q=%s&x=1', 'a b', 'https://d/?q=%s')).toBe(`https://s/?q=${encodeURIComponent('a b')}&x=1`);
    expect(searchUrlFor('https://s/', 'a b', 'https://d/?q=%s')).toBe(`https://s/${encodeURIComponent('a b')}`);
    expect(searchUrlFor('', 'a b', 'https://d/?q=%s')).toBe(`https://d/?q=${encodeURIComponent('a b')}`);
  });
});

/** A minimal Invocation whose host records every open. */
function inv(over: Partial<Invocation> = {}): Invocation & { opened: Array<[string, string[]]> } {
  const opened: Array<[string, string[]]> = [];
  const host: Invocation['host'] = {
    getSelection: async () => '',
    readClipboard: async () => '',
    writeClipboard: async () => undefined,
    paste: async () => undefined,
    pressKeys: async () => undefined,
    open: async (target, args) => { opened.push([target, args ?? []]); },
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    notify: () => undefined,
  };
  return {
    command: 'c', trigger: { source: 'wheel', displayId: 1, x: 0, y: 0 },
    signal: new AbortController().signal, text: undefined, textSource: undefined, app: undefined,
    config: {}, host, result: { set: () => undefined, append: () => undefined, setActions: () => undefined },
    ...over,
    opened,
  };
}

describe('BUILT_IN_ACTIONS handlers', () => {
  it('the manifest declares every permission the handlers use', () => {
    expect(BUILTIN_MANIFEST.permissions).toContain('open');
    expect(BUILTIN_MANIFEST.permissions).toContain('network');
    expect(BUILTIN_MANIFEST.contributes.commands.map((c) => c.id)).toEqual(['open-app', 'run-script', 'ai-explain', 'clipboard-search']);
  });

  it('open-app opens the configured target and refuses an empty one', async () => {
    const good = inv({ config: { target: 'https://example.com' } }) as Invocation & { opened: Array<[string, string[]]> };
    await expect(BUILT_IN_ACTIONS['open-app'].handler(good)).resolves.toEqual({ ok: true });
    expect(good.opened).toEqual([['https://example.com', []]]);

    const empty = inv({ config: { target: '  ' } });
    await expect(BUILT_IN_ACTIONS['open-app'].handler(empty)).resolves.toEqual({ ok: false, error: 'unconfigured' });
  });

  it('run-script opens a hidden shell with the command line, fire-and-forget', async () => {
    const i = inv({ config: { command: 'echo hi' } }) as Invocation & { opened: Array<[string, string[]]> };
    await expect(BUILT_IN_ACTIONS['run-script'].handler(i)).resolves.toEqual({ ok: true });
    expect(i.opened).toEqual([['cmd.exe', ['/c', 'echo hi']]]);

    const unconfigured = inv({ config: {} });
    await expect(BUILT_IN_ACTIONS['run-script'].handler(unconfigured)).resolves.toEqual({ ok: false, error: 'unconfigured' });
  });

  it('clipboard-search opens the search url for the text, and fails without text', async () => {
    const i = inv({ config: { url: 'https://s/?q=%s' }, text: 'a b', textSource: 'clipboard' }) as Invocation & { opened: Array<[string, string[]]> };
    await expect(BUILT_IN_ACTIONS['clipboard-search'].handler(i)).resolves.toEqual({ ok: true });
    expect(i.opened[0][0]).toBe(`https://s/?q=${encodeURIComponent('a b')}`);

    const dry = inv({ config: { url: 'https://s/?q=%s' }, text: '  ' });
    await expect(BUILT_IN_ACTIONS['clipboard-search'].handler(dry)).resolves.toEqual({ ok: false, error: 'noText' });
  });

  it('ai-explain answers unconfigured and noText before any request', async () => {
    await expect(BUILT_IN_ACTIONS['ai-explain'].handler(inv({ config: { baseUrl: '', apiKey: '', model: '' } })))
      .resolves.toEqual({ ok: false, error: 'unconfigured' });
    await expect(BUILT_IN_ACTIONS['ai-explain'].handler(inv({ config: { baseUrl: 'https://x.com', apiKey: 'k', model: 'm' } })))
      .resolves.toEqual({ ok: false, error: 'noText' });
  });
});
