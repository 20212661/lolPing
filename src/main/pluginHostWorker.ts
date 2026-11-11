/**
 * The shared plugin host worker: loads contract plugins (manifest + activate(ctx)), routes invokes to
 * their registered handlers and proxies HostActions to the main process. One process holds every
 * non-isolated plugin; the main process owns its lifecycle (lazy start, idle reclaim, timeout restart).
 */

import { pathToFileURL } from 'node:url';
import type { CommandResult } from '../../packages/plugin-api/src/api';
import { PROTOCOL_VERSION, type ToPluginHost } from '../../packages/plugin-api/src/protocol';
import { createInvocation, RegisteredPlugin, type HostWire } from './pluginHostCore';

const port = process.parentPort!;
const send = (m: unknown): void => port.postMessage(m);

/** One outstanding host-action call from a plugin, awaiting the main process's reply. */
interface PendingCall {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

const plugins = new Map<string, RegisteredPlugin>();
const calls = new Map<number, PendingCall>();
const aborts = new Map<number, AbortController>();
let callSeq = 0;

const wire: HostWire = {
  call: (pluginId, invocationId, method, args) => new Promise((resolve, reject) => {
    const callId = ++callSeq;
    calls.set(callId, { resolve, reject });
    send({ t: 'call', callId, pluginId, invocationId, method, args });
  }),
  result: (id, op, payload) => send(op === 'actions' ? { t: 'result', id, op, actions: payload } : { t: 'result', id, op, text: payload }),
  log: (level, text) => {
    const pluginId = currentPlugin ?? '?';
    send({ t: 'log', pluginId, level, text });
  },
};

/** The plugin whose invocation most recently logged; wire.log has no plugin context of its own. */
let currentPlugin: string | null = null;

async function loadPlugin(msg: Extract<ToPluginHost, { t: 'load' }>): Promise<void> {
  const existing = plugins.get(msg.pluginId);
  if (existing) {
    send({ t: 'loaded', pluginId: msg.pluginId, handlers: [...existing.handlers.keys()] });
    return;
  }
  const reg = new RegisteredPlugin(msg.manifest, msg.pluginPath, msg.config, wire);
  try {
    const module: unknown = await import(/* @vite-ignore */ pathToFileURL(msg.entry).href);
    const exported = typeof module === 'object' && module !== null
      ? (module as Record<string, unknown>).default ?? module : module;
    if (typeof exported !== 'function' && !(typeof exported === 'object' && exported !== null
      && typeof (exported as Record<string, unknown>).apply === 'function')) {
      throw new Error('plugin must export activate(ctx) or an object with apply(ctx, config)');
    }
    if (Array.isArray(msg.storage)) reg.setStore(Object.fromEntries(msg.storage));
    currentPlugin = msg.pluginId;
    const activate = typeof exported === 'function' ? exported : (exported as { apply: typeof exported }).apply;
    await (activate as (ctx: unknown, config: unknown) => unknown)(reg.context(msg.apiVersion), msg.config);
    currentPlugin = null;
    plugins.set(msg.pluginId, reg);
    send({ t: 'loaded', pluginId: msg.pluginId, handlers: [...reg.handlers.keys()] });
  } catch (err) {
    currentPlugin = null;
    reg.unload();
    send({ t: 'loadFailed', pluginId: msg.pluginId, detail: String(err).slice(0, 2000) });
  }
}

port.on('message', (event: { data: unknown }) => {
  const raw = event.data as Record<string, unknown>;
  if (typeof raw?.t !== 'string') return;
  const t = raw.t;
  if (t === 'load') {
    void loadPlugin(raw as unknown as Extract<ToPluginHost, { t: 'load' }>);
  } else if (t === 'unload') {
    const reg = plugins.get(String(raw.pluginId));
    if (reg) {
      reg.unload();
      plugins.delete(reg.manifest.id);
    }
  } else if (t === 'invoke') {
    void invoke(raw as unknown as Extract<ToPluginHost, { t: 'invoke' }>);
  } else if (t === 'cancel') {
    aborts.get(Number(raw.id))?.abort();
  } else if (t === 'config') {
    const reg = plugins.get(String(raw.pluginId));
    if (reg) reg.configChanged((raw.config as Record<string, unknown>) ?? {}, Array.isArray(raw.changed) ? (raw.changed as string[]) : []);
  } else if (t === 'reply') {
    const callId = Number(raw.callId);
    const pending = calls.get(callId);
    if (!pending) return;
    calls.delete(callId);
    if (raw.ok === true) pending.resolve(raw.value);
    else pending.reject(new Error(typeof raw.error === 'string' ? raw.error : 'call failed'));
  }
});

async function invoke(msg: Extract<ToPluginHost, { t: 'invoke' }>): Promise<void> {
  const reg = plugins.get(msg.pluginId);
  const handler = reg?.handlers.get(msg.handler);
  if (!reg || !handler) {
    send({ t: 'done', id: msg.id, result: { ok: false, error: 'pluginLoad', detail: `unknown handler: ${msg.pluginId}.${msg.handler}` } });
    return;
  }
  const abort = new AbortController();
  aborts.set(msg.id, abort);
  const inv = createInvocation(reg, msg.id, {
    command: msg.command,
    handler: msg.handler,
    trigger: msg.trigger,
    signal: abort.signal,
    text: msg.text,
    textSource: msg.textSource,
    config: msg.config,
  });
  currentPlugin = msg.pluginId;
  let result: Exclude<CommandResult, void> | { ok: true };
  try {
    const r = await handler(inv);
    result = r === undefined ? { ok: true } : (r as Exclude<CommandResult, void>);
    if (result.ok !== true && result.ok !== false) result = { ok: true };
  } catch (err) {
    result = abort.signal.aborted
      ? { ok: false, error: 'cancelled' as const, detail: String(err).slice(0, 2000) }
      : { ok: false, error: 'unknown' as const, detail: String(err).slice(0, 2000) };
  } finally {
    currentPlugin = null;
    aborts.delete(msg.id);
    inv.end();
  }
  send({ t: 'done', id: msg.id, result });
}

send({ t: 'ready', protocol: PROTOCOL_VERSION });
