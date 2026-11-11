/**
 * Runtime validation for messages from the shared plugin host process — it is untrusted to the degree
 * of "may have bugs" (a broken plugin can make it misbehave), so every field is checked before use,
 * the same discipline as parseHelperLine and parseActionResult.
 */

import type { ForegroundApp, ResultAction, Trigger } from '../../packages/plugin-api/src/api';
import type { FromPluginHost, HostMethod } from '../../packages/plugin-api/src/protocol';

const HOST_METHODS: readonly HostMethod[] = [
  'getSelection', 'readClipboard', 'writeClipboard', 'paste', 'pressKeys', 'open', 'exec', 'notify',
  'secrets.get', 'storage.set', 'storage.delete',
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;

/** A done result from the whitelisted codes; anything else reads as 'unknown'. */
function parseResult(raw: unknown): ParsedResult | null {
  if (!isObj(raw) || typeof raw.ok !== 'boolean') return null;
  const detail = typeof raw.detail === 'string' ? raw.detail.slice(0, 4000) : undefined;
  if (raw.ok === true) return { ok: true, ...(detail !== undefined ? { detail } : {}) };
  const codes = [
    'unknown', 'unconfigured', 'noText', 'emptyClipboard', 'network', 'http', 'parse', 'spawn',
    'timeout', 'busy', 'disabled', 'pluginLoad', 'pluginConfig', 'permission', 'cancelled',
  ];
  return typeof raw.error === 'string' && codes.includes(raw.error)
    ? { ok: false, error: raw.error, ...(detail !== undefined ? { detail } : {}) }
    : null;
}

const parseTrigger = (raw: unknown): Trigger | null => {
  if (!isObj(raw)) return null;
  if (raw.source !== 'wheel' && raw.source !== 'palette' && raw.source !== 'hotkey') return null;
  if (!isInt(raw.displayId) || !isInt(raw.x) || !isInt(raw.y)) return null;
  return { source: raw.source, displayId: raw.displayId, x: raw.x, y: raw.y };
};

/** A validated done/result payload: whitelisted error codes, bounded detail. */
export type ParsedResult = { ok: true; detail?: string } | { ok: false; error: string; detail?: string };

/** A host message that passed validation; `result` is only present on done. */
export type HostMessage =
  | { t: 'ready'; protocol: number }
  | { t: 'loaded'; pluginId: string; handlers: string[] }
  | { t: 'loadFailed'; pluginId: string; detail: string }
  | { t: 'call'; callId: number; pluginId: string; invocationId?: number; method: HostMethod; args: unknown[] }
  | { t: 'result'; id: number; op: 'set' | 'append'; text: string }
  | { t: 'result'; id: number; op: 'actions'; actions: ResultAction[] }
  | { t: 'done'; id: number; result: ParsedResult }
  | { t: 'log'; pluginId: string; level: 'info' | 'warn' | 'error'; text: string };

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'ready':
      return isInt(raw.protocol) ? { t: 'ready', protocol: raw.protocol } : null;
    case 'loaded':
      return isStr(raw.pluginId, 64) && Array.isArray(raw.handlers) && raw.handlers.every((h) => isStr(h, 64))
        ? { t: 'loaded', pluginId: raw.pluginId, handlers: raw.handlers as string[] }
        : null;
    case 'loadFailed':
      return isStr(raw.pluginId, 64) && isStr(raw.detail, 2000) ? { t: 'loadFailed', pluginId: raw.pluginId, detail: raw.detail } : null;
    case 'call': {
      if (!isInt(raw.callId) || !isStr(raw.pluginId, 64) || !HOST_METHODS.includes(raw.method as HostMethod)) return null;
      if (raw.invocationId !== undefined && !isInt(raw.invocationId)) return null;
      if (!Array.isArray(raw.args) || raw.args.length > 8) return null;
      return { t: 'call', callId: raw.callId, pluginId: raw.pluginId, ...(raw.invocationId !== undefined ? { invocationId: raw.invocationId } : {}), method: raw.method as HostMethod, args: raw.args };
    }
    case 'result':
      if (!isInt(raw.id)) return null;
      if (raw.op === 'set' || raw.op === 'append') return isStr(raw.text, 4000) ? { t: 'result', id: raw.id, op: raw.op, text: raw.text } : null;
      if (raw.op === 'actions') {
        if (!Array.isArray(raw.actions) || raw.actions.length > 4) return null;
        const actions: ResultAction[] = [];
        for (const a of raw.actions) {
          if (!isObj(a)) return null;
          if (a.kind === 'copy' || a.kind === 'paste') actions.push({ kind: a.kind, ...(isStr(a.label, 64) ? { label: a.label } : {}) });
          else if (a.kind === 'open' && isStr(a.label, 64) && isStr(a.target, 2048)) actions.push({ kind: 'open', label: a.label, target: a.target });
          else return null;
        }
        return { t: 'result', id: raw.id, op: 'actions', actions };
      }
      return null;
    case 'done': {
      if (!isInt(raw.id)) return null;
      const result = parseResult(raw.result);
      return result ? { t: 'done', id: raw.id, result } : null;
    }
    case 'log':
      return isStr(raw.pluginId, 64) && (raw.level === 'info' || raw.level === 'warn' || raw.level === 'error') && isStr(raw.text, 2000)
        ? { t: 'log', pluginId: raw.pluginId, level: raw.level, text: raw.text }
        : null;
    default:
      return null;
  }
}

/** The trigger payload an invoke carries, checked the same way before the worker trusts it. */
export const parseInvokeTrigger = parseTrigger;
export type { ForegroundApp };
