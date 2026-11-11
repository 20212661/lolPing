/**
 * The host's internal wire protocol (plugin authors do not need this file).
 *
 * Two channels:
 *   A. main process <-> shared plugin host process (an Electron utilityProcess over parentPort.postMessage)
 *      All JS plugins load here. The host starts lazily, reclaims it after IDLE_MS idle, and restarts the
 *      whole process when a call times out. Plugins marked isolated: true keep the throwaway-process model;
 *      the messages are the same, only the process is load -> invoke -> exit each time.
 *   B. main process <-> external executable (run.kind === 'exec', protocol: 'stdio-json')
 *      One ExecRequest line on stdin, ExecEvent lines on stdout — plugins in any language.
 *
 * Every inbound message must be validated in the main process by a parse* function before use
 * (the same discipline as parseActionResult).
 */

import type { CommandResult, ForegroundApp, ResultAction, Trigger } from './api';
import type { PluginManifest } from './manifest';

export const PROTOCOL_VERSION = 1;
/** How long the shared plugin host may stay idle before it is reclaimed. */
export const IDLE_MS = 5 * 60_000;
/** The concurrent invocation cap (the existing PluginRunner cap of 4). */
export const MAX_CONCURRENT = 4;
export const MAX_TEXT = 16_384;
export const MAX_RESULT = 4_000;

// ───────────────────────── A. main process -> plugin host ─────────────────────────

export type ToPluginHost =
  | {
    t: 'load';
    pluginId: string;
    pluginPath: string;
    /** The entry's absolute path (the main process checked it is inside pluginPath). */
    entry: string;
    manifest: PluginManifest;
    config: Record<string, unknown>;
    apiVersion: string;
    /** The plugin's stored KV, sent once at load; later changes go through 'storage.set'/'storage.delete'. */
    storage?: Array<[string, unknown]>;
  }
  | { t: 'unload'; pluginId: string }
  | {
    t: 'invoke';
    /** The invocation id, assigned by the main process and unique within the host. */
    id: number;
    pluginId: string;
    command: string;
    handler: string;
    text?: string;
    textSource?: 'selection' | 'clipboard';
    app?: ForegroundApp;
    trigger: Trigger;
    config: Record<string, unknown>;
  }
  | { t: 'cancel'; id: number }
  | { t: 'config'; pluginId: string; config: Record<string, unknown>; changed: string[] }
  /** The answer to a call the plugin host made. */
  | { t: 'reply'; callId: number; ok: true; value?: unknown }
  | { t: 'reply'; callId: number; ok: false; error: string };

// ───────────────────────── A. plugin host -> main process ─────────────────────────

/** HostActions, Secrets and Storage are proxies in the plugin host; the real work happens in the main process. */
export type HostMethod =
  | 'getSelection' | 'readClipboard' | 'writeClipboard' | 'paste' | 'pressKeys' | 'open' | 'exec' | 'notify'
  | 'secrets.get' | 'storage.set' | 'storage.delete';

export type FromPluginHost =
  | { t: 'ready'; protocol: number }
  | { t: 'loaded'; pluginId: string; handlers: string[] }
  | { t: 'loadFailed'; pluginId: string; detail: string }
  | {
    t: 'call';
    callId: number;
    pluginId: string;
    /** The invocation this call belongs to; calls arriving after their invocation ended are refused. */
    invocationId?: number;
    method: HostMethod;
    args: unknown[];
  }
  | { t: 'result'; id: number; op: 'set' | 'append'; text: string }
  | { t: 'result'; id: number; op: 'actions'; actions: ResultAction[] }
  | { t: 'done'; id: number; result: Exclude<CommandResult, void> | { ok: true } }
  | { t: 'log'; pluginId: string; level: 'info' | 'warn' | 'error'; text: string };

/**
 * Checks the main process must do on inbound messages (the plugin host is untrusted to the degree of
 * "may have bugs"):
 *   1. The permission of call.method must be in that plugin's manifest.permissions; otherwise
 *      reply ok:false 'permission'.
 *   2. A call's pluginId must name a plugin actually loaded in this host process — a buggy host must not
 *      let one plugin borrow another plugin's permissions.
 *   3. call.invocationId must belong to an invocation still running (notify and storage excepted).
 *   4. Result text is truncated to MAX_RESULT; the accumulated append total likewise.
 *   5. done.result goes through the same whitelist validation as parseActionResult.
 */
export const PERMISSION_OF: Record<HostMethod, string | null> = {
  getSelection: 'selection',
  readClipboard: 'clipboard.read',
  writeClipboard: 'clipboard.write',
  paste: 'paste',
  pressKeys: 'keys',
  open: 'open',
  exec: 'shell',
  notify: null,
  'secrets.get': null,
  'storage.set': null,
  'storage.delete': null,
};

// ───────────────────────── B. stdio-json external program ─────────────────────────

/** The single line written to the child's stdin (with a trailing \n). Stdin closes after it. */
export interface ExecRequest {
  lolping: typeof PROTOCOL_VERSION;
  command: string;
  text?: string;
  textSource?: 'selection' | 'clipboard';
  app?: ForegroundApp;
  trigger: Trigger;
  config: Record<string, unknown>;
}

/**
 * One JSON object per line on stdout. A done event must come last; a process exiting without one is an
 * error 'pluginLoad'. External programs cannot call HostActions in v1; anything they need afterwards
 * (pasting and so on) is declared in done.then and executed by the host.
 */
export type ExecEvent =
  | { t: 'set' | 'append'; text: string }
  | {
    t: 'done';
    result: Exclude<CommandResult, void> | { ok: true };
    /** Follow-up actions the host executes, each under the manifest's permissions. */
    then?: Array<{ kind: 'paste' | 'copy'; text: string } | { kind: 'open'; target: string }>;
  };
