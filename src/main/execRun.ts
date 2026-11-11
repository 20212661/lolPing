/**
 * The exec executor: runs a manifest's exec command as a child process. stdio-json speaks the contract's
 * NDJSON protocol (one ExecRequest line in, ExecEvent lines out, streaming); plain feeds the text on stdin
 * and takes stdout as the result. Every stdout line is validated before use; a process that exits without
 * a done event is a pluginLoad failure. The child handle is injected, so tests script both modes.
 */

import { PROTOCOL_VERSION } from '../../packages/plugin-api/src/protocol';

/** A follow-up the host executes after a done, each under the manifest's permissions. */
export type ThenAction = { kind: 'paste' | 'copy'; text: string } | { kind: 'open'; target: string };

export type ExecResult = { ok: true; detail?: string } | { ok: false; error: string; detail?: string };

/** A validated line from the child's stdout. */
export type ExecEvent =
  | { t: 'set' | 'append'; text: string }
  | { t: 'done'; result: ExecResult; then?: ThenAction[] };

export interface ExecChild {
  write(data: string): void;
  end(): void;
  kill(): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
}

export interface ExecDeps {
  /** Null when the process could not be started. `cwd` is the plugin's folder. */
  spawn(file: string, args: string[], cwd: string): ExecChild | null;
  schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancel(t: ReturnType<typeof setTimeout>): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ERROR_CODES = [
  'unknown', 'unconfigured', 'noText', 'emptyClipboard', 'network', 'http', 'parse', 'spawn',
  'timeout', 'busy', 'disabled', 'pluginLoad', 'pluginConfig', 'permission', 'cancelled',
];

/** Validates one stdout line as an ExecEvent; null when it is not one. */
export function parseExecLine(line: string): ExecEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  if (raw.t === 'set' || raw.t === 'append') {
    return typeof raw.text === 'string' ? { t: raw.t, text: raw.text.slice(0, 4000) } : null;
  }
  if (raw.t !== 'done' || !isObj(raw.result) || typeof raw.result.ok !== 'boolean') return null;
  const detail = typeof raw.result.detail === 'string' ? raw.result.detail.slice(0, 4000) : undefined;
  let result: ExecResult;
  if (raw.result.ok === true) {
    result = { ok: true, ...(detail !== undefined ? { detail } : {}) };
  } else if (typeof raw.result.error === 'string' && ERROR_CODES.includes(raw.result.error)) {
    result = { ok: false, error: raw.result.error, ...(detail !== undefined ? { detail } : {}) };
  } else {
    return null;
  }
  let then: ThenAction[] | undefined;
  if (Array.isArray(raw.then)) {
    then = [];
    for (const a of raw.then.slice(0, 4)) {
      if (!isObj(a)) return null;
      if ((a.kind === 'paste' || a.kind === 'copy') && typeof a.text === 'string') {
        then.push({ kind: a.kind, text: a.text.slice(0, 16_384) });
      } else if (a.kind === 'open' && typeof a.target === 'string') {
        then.push({ kind: 'open', target: a.target.slice(0, 2048) });
      } else {
        return null;
      }
    }
  }
  return { t: 'done', result, ...(then !== undefined ? { then } : {}) };
}

export interface ExecRequestInput {
  file: string;
  args: string[];
  /** The plugin's folder, so relative file names and script paths resolve inside it. */
  cwd: string;
  protocol: 'stdio-json' | 'plain';
  command: string;
  timeoutMs: number;
  text: string;
  textSource: 'selection' | 'clipboard';
  trigger: { source: string; displayId: number; x: number; y: number };
  config: Record<string, unknown>;
}

/**
 * Runs one exec command. Streams set/append through `onText` as they arrive; resolves with the done
 * result and its follow-ups, or an error result on timeout, spawn failure or a done-less exit.
 */
export function runExecCommand(
  deps: ExecDeps,
  req: ExecRequestInput,
  onText: (op: 'set' | 'append', text: string) => void,
): Promise<ExecResult & { then?: ThenAction[] }> {
  return new Promise((resolve) => {
    const child = deps.spawn(req.file, req.args, req.cwd);
    if (!child) {
      resolve({ ok: false, error: 'spawn' });
      return;
    }
    let settled = false;
    let stdout = '';
    const finish = (outcome: ExecResult & { then?: ThenAction[] }): void => {
      if (settled) return;
      settled = true;
      deps.cancel(timer);
      resolve(outcome);
    };
    const timer = deps.schedule(() => {
      child.kill();
      finish({ ok: false, error: 'timeout' });
    }, req.timeoutMs);
    child.onExit((code) => {
      if (settled) return;
      // plain mode: the whole stdout is the result; stdio-json without a done is a broken plugin.
      if (req.protocol === 'plain') {
        finish(stdout.trim() ? { ok: true, detail: stdout.trim().slice(0, 4000) } : { ok: false, error: 'pluginLoad', detail: `exit ${code}` });
      } else {
        finish({ ok: false, error: 'pluginLoad', detail: `exit ${code} without done` });
      }
    });
    child.onLine((line) => {
      if (settled || !line.trim()) return;
      if (req.protocol === 'plain') {
        stdout += `${line}\n`;
        return;
      }
      const ev = parseExecLine(line);
      if (!ev) return; // a non-protocol line is ignored, like a stray log print
      if (ev.t === 'set' || ev.t === 'append') onText(ev.t, ev.text);
      else finish(ev.t === 'done' ? { ...ev.result, ...(ev.then ? { then: ev.then } : {}) } : { ok: false, error: 'parse' });
    });
    if (req.protocol === 'stdio-json') {
      child.write(`${JSON.stringify({
        lolping: PROTOCOL_VERSION, command: req.command, text: req.text, textSource: req.textSource,
        trigger: req.trigger, config: req.config,
      })}\n`);
      child.end();
    } else {
      child.write(req.text);
      child.end();
    }
  });
}
