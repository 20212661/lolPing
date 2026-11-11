import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultActions, defaultCustomAction, type ActionsSettings } from '../../src/shared/actionCatalog';
import { CommandHost, type CommandHostDeps } from '../../src/main/commandHost';

/** Every OS ability the actions use, recorded instead of done. */
function makeDeps(platform: 'win' | 'mac' = 'win') {
  const opened: string[] = [];
  const spawned: { file: string; args: string[] }[] = [];
  let clipboard = '';
  const fetchImpl = vi.fn<typeof fetch>();
  const deps: CommandHostDeps = {
    platform,
    readClipboard: async () => clipboard,
    openPath: async (path) => {
      opened.push(`path:${path}`);
      return '';
    },
    openExternal: async (url) => {
      opened.push(`url:${url}`);
    },
    spawnDetached: (file, args) => {
      spawned.push({ file, args });
      return { ok: true };
    },
    fetchImpl,
  };
  return { deps, opened, spawned, fetchImpl, setClipboard: (text: string) => (clipboard = text) };
}

const withConfig = (patch: Partial<ActionsSettings>): ActionsSettings => ({ ...defaultActions(), ...patch });

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body } as unknown as Response);

describe('CommandHost', () => {
  let helper: ReturnType<typeof makeDeps>;
  let host: CommandHost;

  beforeEach(() => {
    helper = makeDeps();
    host = new CommandHost(helper.deps);
    return host.applyConfig(defaultActions());
  });

  afterEach(async () => {
    await host.unload();
  });

  it('runs every built-in action from the wheel ids', async () => {
    helper.setClipboard('hello world');
    helper.fetchImpl.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'an answer' } }] }));
    await host.applyConfig(withConfig({
      openApp: { target: 'https://example.com/app' },
      runScript: { command: 'echo hi' },
      aiExplain: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' },
    }));
    expect((await host.execute('open-app')).ok).toBe(true);
    expect((await host.execute('run-script')).ok).toBe(true);
    expect(await host.execute('ai-explain')).toEqual({ ok: true, detail: 'an answer' });
    expect((await host.execute('clipboard-search')).ok).toBe(true);
    expect(helper.opened).toEqual(['url:https://example.com/app', 'url:https://www.bing.com/search?q=hello%20world']);
    expect(helper.spawned).toEqual([{ file: 'cmd.exe', args: ['/c', 'echo hi'] }]);
  });

  it('says unconfigured when an action has nothing to work on', async () => {
    for (const id of ['open-app', 'run-script', 'ai-explain'] as const) {
      expect(await host.execute(id)).toEqual({ ok: false, error: 'unconfigured' });
    }
  });

  it('says emptyClipboard when the clipboard has no text', async () => {
    helper.setClipboard('   ');
    await host.applyConfig(withConfig({
      aiExplain: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' },
    }));
    expect(await host.execute('ai-explain')).toEqual({ ok: false, error: 'emptyClipboard' });
    expect(await host.execute('clipboard-search')).toEqual({ ok: false, error: 'emptyClipboard' });
    expect(helper.fetchImpl).not.toHaveBeenCalled();
    expect(helper.opened).toEqual([]);
  });

  it('posts the clipboard text to the configured chat API and reads the answer', async () => {
    helper.setClipboard('what is a race condition?');
    helper.fetchImpl.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Two steps, one timing assumption.' } }] }));
    await host.applyConfig(withConfig({ aiExplain: { baseUrl: 'https://api.example.com/v1/', apiKey: 'k-2', model: 'gryphon' } }));
    const result = await host.execute('ai-explain');
    expect(result).toEqual({ ok: true, detail: 'Two steps, one timing assumption.' });
    const [url, init] = helper.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer k-2', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body)).model).toBe('gryphon');
    expect(JSON.parse(String(init.body)).messages.at(-1).content).toBe('what is a race condition?');
  });

  it('turns a service error and an unreachable service into http and network', async () => {
    helper.setClipboard('text');
    await host.applyConfig(withConfig({ aiExplain: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' } }));
    helper.fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false, 401));
    expect(await host.execute('ai-explain')).toEqual({ ok: false, error: 'http', detail: '401' });
    helper.fetchImpl.mockRejectedValueOnce(new Error('connection refused'));
    expect(await host.execute('ai-explain')).toEqual({ ok: false, error: 'network', detail: 'Error: connection refused' });
    helper.fetchImpl.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    expect(await host.execute('ai-explain')).toEqual({ ok: false, error: 'parse' });
  });

  it('runs scripts with the platform shell', async () => {
    const mac = makeDeps('mac');
    const macHost = new CommandHost(mac.deps);
    await macHost.applyConfig(withConfig({ runScript: { command: 'say hi' } }));
    expect((await macHost.execute('run-script')).ok).toBe(true);
    await macHost.unload();
    expect(mac.spawned).toEqual([{ file: '/bin/sh', args: ['-c', 'say hi'] }]);
  });

  it('reports a command that could not start', async () => {
    helper.deps.spawnDetached = () => ({ ok: false, error: 'ENOENT' });
    await host.applyConfig(withConfig({ runScript: { command: 'missing.cmd' } }));
    expect(await host.execute('run-script')).toEqual({ ok: false, error: 'spawn', detail: 'ENOENT' });
  });

  it('opens a configured path the OS way, and an address in the browser', async () => {
    await host.applyConfig(withConfig({ openApp: { target: 'C:/Tools/lol.exe' } }));
    expect((await host.execute('open-app')).ok).toBe(true);
    expect(helper.opened).toEqual(['path:C:/Tools/lol.exe']);
  });

  it('uses the newest settings after a reload', async () => {
    await host.applyConfig(withConfig({ clipboardSearch: { url: 'https://example.com/find?q=%s' } }));
    helper.setClipboard('a b');
    expect((await host.execute('clipboard-search')).ok).toBe(true);
    expect(helper.opened).toEqual(['url:https://example.com/find?q=a%20b']);
  });

  it('dispatches a custom binding with its trigger and removes it on reload', async () => {
    const custom = defaultCustomAction('plugin:hello', 'Hello');
    helper.deps.runPlugin = async (action, env) => ({ ok: true, detail: `${action.command}:${env.trigger?.x}` });
    await host.applyConfig(withConfig({ custom: [custom] }));
    expect(await host.execute(custom.id, { displayId: 2, x: 17, y: 2 })).toEqual({ ok: true, detail: 'hello:17' });
    await host.applyConfig(defaultActions());
    expect(await host.execute(custom.id)).toEqual({ ok: false, error: 'unknown' });
  });

  it('serializes rapid settings changes and never loads an obsolete configuration', async () => {
    const first = host.applyConfig(withConfig({ openApp: { target: 'old.exe' } }));
    const second = host.applyConfig(withConfig({ openApp: { target: 'new.exe' } }));
    await Promise.all([first, second]);
    expect(await host.execute('open-app')).toEqual({ ok: true });
    expect(helper.opened).toEqual(['path:new.exe']);
    const loading = host.applyConfig(defaultActions());
    const stopping = host.unload();
    await Promise.all([loading, stopping]);
    expect(await host.execute('open-app')).toEqual({ ok: false, error: 'unknown' });
  });

  it('takes the actions away when it unloads, and aborts what is still running', async () => {
    helper.setClipboard('text');
    await host.applyConfig(withConfig({ aiExplain: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' } }));
    // A request that only ends when its abort signal fires.
    helper.fetchImpl.mockImplementation((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    const running = host.execute('ai-explain');
    await vi.waitFor(() => expect(helper.fetchImpl).toHaveBeenCalled());
    await host.unload();
    expect(await running).toEqual({ ok: false, error: 'unknown', detail: 'aborted' });
    expect(await host.execute('ai-explain')).toEqual({ ok: false, error: 'unknown' });
  });
});
