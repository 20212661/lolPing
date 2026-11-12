import { isCommandRef } from '../../packages/plugin-api/src/manifest';
import { isPingId, type PingId } from './pings';

export { isCommandRef };

/**
 * The built-in actions a wheel slice can hold. A released action runs instead of placing a ping; it is never sent
 * to the room. The ids stay clear of every ping id, so a wheel slot needs no prefix to say which it is.
 */
export type BuiltinActionId = 'open-app' | 'run-script' | 'ai-explain' | 'clipboard-search';
export type ActionId = BuiltinActionId;
/** A scanned plugin command's full name, from the manifest system (packages/plugin-api). */
export type CommandRef = import('../../packages/plugin-api/src/manifest').CommandRef;

/** Only the shape of a v2 binding, kept so old settings files load and repair instead of resetting the wheel. */
export const isPluginActionId = (v: unknown): v is `plugin:${string}` =>
  typeof v === 'string' && /^plugin:[a-z0-9][a-z0-9-]{0,63}$/.test(v);

/** How a released action answers: 'instant' just runs (a bubble only on failure), 'result' shows a bubble at the cursor. */
export type ActionFeedback = 'instant' | 'result';

/** What each action's settings row and slice icon need. The glyph is one stroke path in a 64×64 box. */
export interface ActionDef {
  id: BuiltinActionId;
  feedback: ActionFeedback;
  color: string;
  glyph: string;
}

/** Every action, in the order the settings window lists them. */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'open-app', feedback: 'instant', color: '#5cc8ff', glyph: 'M15 15h14v14H15z M35 15h14v14H35z M15 35h14v14H15z M35 35h14v14H35z' },
  { id: 'run-script', feedback: 'instant', color: '#c28a4b', glyph: 'M13 13h38v38H13z M21 26l8 7-8 7 M33 40h11' },
  { id: 'ai-explain', feedback: 'result', color: '#b48aff', glyph: 'M32 12l5.5 14.5L52 32l-14.5 5.5L32 52l-5.5-14.5L12 32l14.5-5.5z' },
  { id: 'clipboard-search', feedback: 'instant', color: '#35d27a', glyph: 'M27 17a13 13 0 1 0 0 26 13 13 0 0 0 0-26z M42 42l10 10' },
];

export const isActionId = (v: unknown): v is ActionId =>
  isPluginActionId(v) || (typeof v === 'string' && ACTIONS.some((a) => a.id === v));

export function actionById(id: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/**
 * A wheel slot holds a ping, an action, or a scanned plugin's command ref (`pluginId.commandId`). The centre
 * (trigger + click) stays a ping. A ref in a settings file stays put through normalizeSettings; the main
 * process repairs refs no scanned plugin provides (repairUnknownItems in wheelLayout.ts).
 */
export type WheelItem = PingId | ActionId | CommandRef;

export const isWheelItem = (v: unknown): v is WheelItem => isPingId(v) || isActionId(v) || isCommandRef(v);

const ICONS = new Map<ActionId, string>();

/** The slice and settings icon of an action: a small inline SVG, so nothing has to load from disk. */
export function actionIconUrl(id: ActionId): string {
  const cached = ICONS.get(id);
  if (cached) return cached;
  const def = isPluginActionId(id)
    ? { color: '#55c9ba', glyph: 'M24 13v10 M40 13v10 M18 23h28v8a14 14 0 0 1-28 0z M32 45v8' }
    : actionById(id);
  if (!def) return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<circle cx="32" cy="32" r="30" fill="#14181c" stroke="${def.color}" stroke-width="2.5"/>`
    + `<path d="${def.glyph}" fill="none" stroke="${def.color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  ICONS.set(id, url);
  return url;
}

/** An OpenAI-compatible chat API: the AI explain action posts the clipboard text here. */
export interface AiExplainConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ActionsSettings {
  /** What 'open-app' starts: a program, a file or a web address. Empty leaves the action unconfigured. */
  openApp: { target: string };
  /** What 'run-script' runs in a hidden shell. Empty leaves the action unconfigured. */
  runScript: { command: string };
  aiExplain: AiExplainConfig;
  /** Where 'clipboard-search' searches; '%s' is the text. */
  clipboardSearch: { url: string };
}

export const DEFAULT_SEARCH_URL = 'https://www.bing.com/search?q=%s';

export const defaultActions = (): ActionsSettings => ({
  openApp: { target: '' },
  runScript: { command: '' },
  aiExplain: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  clipboardSearch: { url: DEFAULT_SEARCH_URL },
});

const str = (raw: unknown, max: number, fallback: string): string => {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, max);
  return trimmed;
};

/** An http(s) address only; anything else a browser can't open falls back. */
const httpStr = (raw: unknown, max: number, fallback: string): string => {
  const s = str(raw, max, fallback);
  return /^https?:\/\//i.test(s) ? s : fallback;
};

/** Turns anything into complete action settings: trimmed strings, bounded lengths, sane fallbacks. */
export function normalizeActions(raw: unknown): ActionsSettings {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = defaultActions();
  const section = (name: keyof ActionsSettings): Record<string, unknown> => {
    const v = r[name];
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  };
  const openApp = section('openApp');
  const runScript = section('runScript');
  const ai = section('aiExplain');
  const search = section('clipboardSearch');
  return {
    openApp: { target: str(openApp.target, 512, d.openApp.target) },
    runScript: { command: str(runScript.command, 1024, d.runScript.command) },
    aiExplain: {
      baseUrl: httpStr(ai.baseUrl, 512, d.aiExplain.baseUrl),
      apiKey: str(ai.apiKey, 1024, d.aiExplain.apiKey), // sealed values are longer than plain ones
      model: str(ai.model, 128, d.aiExplain.model),
    },
    clipboardSearch: { url: httpStr(search.url, 1024, d.clipboardSearch.url) },
  };
}

/** Why an action failed; the bubble and the log read these, so the ids are stable. */
export type ActionError =
  | 'unknown'        // it threw, or its plugin wasn't loaded
  | 'unconfigured'   // the action's own settings are empty
  | 'emptyClipboard' // there was no text to work on
  | 'noText'         // a command that needs text ran without any (selection or clipboard)
  | 'network'        // the request never got an answer
  | 'http'           // the service answered with an error
  | 'parse'          // the answer couldn't be read
  | 'timeout'
  | 'busy'
  | 'disabled'
  | 'pluginLoad'
  | 'pluginConfig'
  | 'spawn';         // a program or command couldn't be started

/** `detail` is a short raw note (a status code, a system message); it never replaces the i18n text. */
export type ActionResult = { ok: true; detail?: string } | { ok: false; error: ActionError; detail?: string };

/** Copies only bounded, known fields from a plugin process. */
export function parseActionResult(raw: unknown): ActionResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const detail = typeof r.detail === 'string' ? r.detail.slice(0, 4000) : undefined;
  if (r.ok === true) return { ok: true, ...(detail ? { detail } : {}) };
  const errors: readonly string[] = [
    'unknown', 'unconfigured', 'emptyClipboard', 'noText', 'network', 'http', 'parse', 'spawn',
    'timeout', 'busy', 'disabled', 'pluginLoad', 'pluginConfig',
  ];
  if (r.ok === false && typeof r.error === 'string' && errors.includes(r.error)) {
    return { ok: false, error: r.error as ActionError, ...(detail ? { detail } : {}) };
  }
  return null;
}
