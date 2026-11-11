import { describe, expect, it } from 'vitest';
import { parseExecLine, runExecCommand, type ExecChild, type ExecDeps } from '../../src/main/execRun';

describe('parseExecLine', () => {
  it('accepts set, append and done with and without follow-ups', () => {
    expect(parseExecLine('{"t":"set","text":"a"}')).toEqual({ t: 'set', text: 'a' });
    expect(parseExecLine('{"t":"append","text":"b"}')).toEqual({ t: 'append', text: 'b' });
    expect(parseExecLine('{"t":"done","result":{"ok":true,"detail":"x"}}')).toEqual({ t: 'done', result: { ok: true, detail: 'x' } });
    expect(parseExecLine('{"t":"done","result":{"ok":false,"error":"noText"}}')).toEqual({ t: 'done', result: { ok: false, error: 'noText' } });
    expect(parseExecLine('{"t":"done","result":{"ok":true},"then":[{"kind":"paste","text":"UP"}]}'))
      .toEqual({ t: 'done', result: { ok: true }, then: [{ kind: 'paste', text: 'UP' }] });
  });

  it('rejects non-lines, unknown error codes and malformed follow-ups', () => {
    expect(parseExecLine('not json')).toBeNull();
    expect(parseExecLine('{"t":"done"}')).toBeNull();
    expect(parseExecLine('{"t":"done","result":{"ok":false,"error":"rm -rf"}}')).toBeNull();
    expect(parseExecLine('{"t":"done","result":{"ok":true},"then":[{"kind":"sudo"}]}')).toBeNull();
    expect(parseExecLine('{"t":"mystery"}')).toBeNull();
  });
});

/** A scripted child: lines() is what the "process" prints, then it exits. */
function fakeDeps(lines: string[] | { onStdin(data: string, child: ExecChild & { emitLine(l: string): void }): void }): { deps: ExecDeps; children: ExecChild[]; spawned: Array<{ file: string; args: string[]; cwd: string }> } {
  const children: ExecChild[] = [];
  const spawned: Array<{ file: string; args: string[]; cwd: string }> = [];
  class FakeChild implements ExecChild {
    written = '';
    ended = false;
    killed = false;
    private readonly lineListeners: Array<(l: string) => void> = [];
    private readonly exitListeners: Array<(c: number | null) => void> = [];
    constructor() {
      children.push(this);
      queueMicrotask(() => {
        if (Array.isArray(lines)) {
          for (const l of lines) this.emitLine(l);
          this.emitExit(0);
        }
      });
    }
    write(data: string): void {
      this.written += data;
      if (!Array.isArray(lines)) lines.onStdin(data, this as ExecChild & { emitLine(l: string): void });
    }
    end(): void {
      this.ended = true;
    }
    kill(): void {
      this.killed = true;
      this.emitExit(null);
    }
    onLine(f: (l: string) => void): void {
      this.lineListeners.push(f);
    }
    onExit(f: (c: number | null) => void): void {
      this.exitListeners.push(f);
    }
    emitLine(l: string): void {
      for (const f of [...this.lineListeners]) f(l);
    }
    emitExit(c: number | null): void {
      for (const f of [...this.exitListeners]) f(c);
    }
  }
  const deps: ExecDeps = {
    spawn: (file, args, cwd) => { spawned.push({ file, args, cwd }); return new FakeChild(); },
    schedule: (fn) => setTimeout(fn, 10_000) as unknown as ReturnType<typeof setTimeout>,
    cancel: (t) => clearTimeout(t as unknown as ReturnType<typeof setTimeout>),
  };
  return { deps, children, spawned };
}

const req = (over: Partial<Parameters<typeof runExecCommand>[1]> = {}): Parameters<typeof runExecCommand>[1] => ({
  file: 'python', args: ['main.py'], cwd: '/plugins/probe', protocol: 'stdio-json', command: 'upper', timeoutMs: 9000,
  text: 'hi', textSource: 'clipboard', trigger: { source: 'wheel', displayId: 1, x: 1, y: 1 }, config: {}, ...over,
});

describe('runExecCommand', () => {
  it('streams stdio-json events and resolves with the done result and follow-ups', async () => {
    const { deps } = fakeDeps([
      '{"t":"set","text":"UPPER: "}',
      '{"t":"append","text":"HI"}',
      '{"t":"done","result":{"ok":true},"then":[{"kind":"paste","text":"HI"}]}',
    ]);
    const seen: Array<[string, string]> = [];
    const outcome = await runExecCommand(deps, req(), (op, text) => seen.push([op, text]));
    expect(seen).toEqual([['set', 'UPPER: '], ['append', 'HI']]);
    expect(outcome).toEqual({ ok: true, then: [{ kind: 'paste', text: 'HI' }] });
  });

  it('writes one ExecRequest line, closes stdin and runs in the plugin folder', async () => {
    const { deps, children, spawned } = fakeDeps(['{"t":"done","result":{"ok":true}}']) as unknown as {
      deps: ExecDeps; children: Array<ExecChild & { written: string; ended: boolean }>;
      spawned: Array<{ file: string; args: string[]; cwd: string }>;
    };
    await runExecCommand(deps, req(), () => undefined);
    const first = JSON.parse(children[0].written.trim());
    expect(first).toMatchObject({ lolping: 1, command: 'upper', text: 'hi', textSource: 'clipboard' });
    expect(children[0].ended).toBe(true);
    expect(spawned[0]).toEqual({ file: 'python', args: ['main.py'], cwd: '/plugins/probe' });
  });

  it('takes the whole stdout as the result in plain mode', async () => {
    const { deps } = fakeDeps(['line one', 'line two']);
    const outcome = await runExecCommand(deps, req({ protocol: 'plain' }), () => undefined);
    expect(outcome).toEqual({ ok: true, detail: 'line one\nline two' });
  });

  it('feeds the text on stdin in plain mode', async () => {
    const { deps, children } = fakeDeps(['ok']) as unknown as { deps: ExecDeps; children: Array<ExecChild & { written: string; ended: boolean }> };
    await runExecCommand(deps, req({ protocol: 'plain' }), () => undefined);
    expect(children[0].written).toBe('hi');
  });

  it('a done-less exit in stdio-json is a pluginLoad failure', async () => {
    const { deps } = fakeDeps(['{"t":"append","text":"partial"}']);
    const outcome = await runExecCommand(deps, req(), () => undefined);
    expect(outcome).toEqual({ ok: false, error: 'pluginLoad', detail: 'exit 0 without done' });
  });

  it('maps a failed done result straight through', async () => {
    const { deps } = fakeDeps(['{"t":"done","result":{"ok":false,"error":"noText"}}']);
    await expect(runExecCommand(deps, req(), () => undefined)).resolves.toEqual({ ok: false, error: 'noText' });
  });
});
