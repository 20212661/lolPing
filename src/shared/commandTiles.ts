/**
 * What the settings window and the overlays need to know about a scanned plugin's commands, and the icon
 * data URLs its tiles use. The main process builds a PluginListResult from a scan (pluginScan.ts); the
 * settings window re-validates it with parsePluginList before use, the way every IPC payload is treated.
 */

import type { Permission } from '../../packages/plugin-api/src/manifest';
import { KNOWN_PERMISSIONS, MANIFEST_ERROR_CODES } from '../../packages/plugin-api/src/validate';

/** Which of the manifest's run kinds a command uses; url/keys/open run in the host with no process. */
export type RunKind = 'url' | 'keys' | 'open' | 'js' | 'exec';

/** One command as a draggable tile: on a wheel slice in the settings, on the wheel itself for the icon. */
export interface CommandTile {
  /** The full command ref (`pluginId.commandId`), what a wheel slot stores. */
  ref: string;
  title: string;
  /** An icon data URL, already resolved (a text glyph or a file icon read by the main process). */
  icon: string;
  color: string | undefined;
  feedback: 'instant' | 'result';
  runKind: RunKind;
}

export interface ConfigPropView {
  key: string;
  type: 'string' | 'secret' | 'number' | 'boolean';
  title: string;
  description: string | undefined;
  default: string | number | boolean | undefined;
  enum: string[] | undefined;
  multiline: boolean;
}

/** One scanned plugin as the settings window shows it. */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  description: string | undefined;
  dir: string;
  permissions: Permission[];
  commands: CommandTile[];
  configuration: ConfigPropView[];
}

export interface PluginListResult {
  plugins: PluginView[];
  failures: Array<{ dir: string; errors: Array<{ code: string; path?: string; value?: string }> }>;
}

const GLYPH_ICONS = new Map<string, string>();

const escapeXml = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

const svgUrl = (inner: string): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`)}`;

/** The tile icon for a `text:Xy` manifest icon: the characters inside the usual action circle. */
export function commandGlyphUrl(label: string, color: string): string {
  const key = `${label}|${color}`;
  const cached = GLYPH_ICONS.get(key);
  if (cached) return cached;
  const url = svgUrl(
    `<circle cx="32" cy="32" r="30" fill="#14181c" stroke="${color}" stroke-width="2.5"/>`
    + `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="'Segoe UI', system-ui, sans-serif"`
    + ` font-size="${label.length > 1 ? 24 : 30}" font-weight="600" fill="${color}">${escapeXml(label)}</text>`,
  );
  GLYPH_ICONS.set(key, url);
  return url;
}

/** The tile icon when a command sets none: the same plug glyph the v2 plugin actions use. */
export function fallbackTileUrl(color: string | undefined): string {
  return commandGlyphUrl('⌁', color ?? '#55c9ba');
}

/** A command's tile icon from its manifest icon: a text glyph, an already-read file icon, or the fallback. */
export function tileIconUrl(icon: string | undefined, fileIcon: string | null | undefined, color: string | undefined): string {
  if (icon?.startsWith('text:')) return commandGlyphUrl(icon.slice(5), color ?? '#55c9ba');
  if (fileIcon) return fileIcon;
  return fallbackTileUrl(color);
}

/** ref → icon for the overlays' wheel slices: one entry per command of every scanned plugin. */
export function commandIcons(list: PluginListResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of list.plugins) for (const c of p.commands) out[c.ref] = c.icon;
  return out;
}

const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const isIconUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('data:image/') && v.length <= 100_000;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Validates a PluginListResult that arrived over IPC; null when the payload is not a plugin list. */
export function parsePluginList(raw: unknown): PluginListResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.plugins) || !Array.isArray(r.failures)) return null;
  const plugins: PluginView[] = [];
  for (const p of r.plugins.slice(0, 64)) {
    if (typeof p !== 'object' || p === null) continue;
    const pv = p as Record<string, unknown>;
    if (typeof pv.id !== 'string' || !pv.id || typeof pv.name !== 'string' || !pv.name) continue;
    if (!Array.isArray(pv.commands) || !Array.isArray(pv.permissions) || !Array.isArray(pv.configuration)) continue;
    const commands: CommandTile[] = [];
    for (const c of pv.commands.slice(0, 64)) {
      if (typeof c !== 'object' || c === null) continue;
      const cv = c as Record<string, unknown>;
      if (typeof cv.ref !== 'string' || !cv.ref.includes('.') || typeof cv.title !== 'string' || !cv.title) continue;
      if (!['url', 'keys', 'open', 'js', 'exec'].includes(cv.runKind as string)) continue;
      commands.push({
        ref: cv.ref.slice(0, 140),
        title: cv.title.slice(0, 64),
        icon: isIconUrl(cv.icon) ? cv.icon : fallbackTileUrl(isHexColor(cv.color) ? cv.color : undefined),
        color: isHexColor(cv.color) ? cv.color : undefined,
        feedback: cv.feedback === 'result' ? 'result' : 'instant',
        runKind: cv.runKind as RunKind,
      });
    }
    const permissions = pv.permissions.filter((x): x is Permission => typeof x === 'string' && (KNOWN_PERMISSIONS as readonly string[]).includes(x));
    const configuration: ConfigPropView[] = [];
    for (const prop of pv.configuration.slice(0, 64)) {
      if (typeof prop !== 'object' || prop === null) continue;
      const lv = prop as Record<string, unknown>;
      if (typeof lv.key !== 'string' || !['string', 'secret', 'number', 'boolean'].includes(lv.type as string)) continue;
      const title = str(lv.title, 128);
      if (!title) continue;
      configuration.push({
        key: lv.key.slice(0, 64),
        type: lv.type as ConfigPropView['type'],
        title,
        description: str(lv.description, 256),
        default: typeof lv.default === 'string' || typeof lv.default === 'number' || typeof lv.default === 'boolean' ? lv.default : undefined,
        enum: Array.isArray(lv.enum) ? lv.enum.filter((x): x is string => typeof x === 'string').slice(0, 16) : undefined,
        multiline: lv.multiline === true,
      });
    }
    plugins.push({
      id: pv.id.slice(0, 64),
      name: pv.name.slice(0, 64),
      version: str(pv.version, 32) ?? '0.0.0',
      description: str(pv.description, 512),
      dir: str(pv.dir, 256) ?? pv.id,
      permissions,
      commands,
      configuration,
    });
  }
  const failures: PluginListResult['failures'] = [];
  for (const f of r.failures.slice(0, 64)) {
    if (typeof f !== 'object' || f === null || !Array.isArray(f.errors)) continue;
    const fv = f as Record<string, unknown>;
    const errors = (f.errors as unknown[])
      .filter((e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).code === 'string')
      .map((e) => ({
        code: (MANIFEST_ERROR_CODES as readonly string[]).includes(e.code as string) ? e.code as string : 'root',
        path: typeof e.path === 'string' ? e.path.slice(0, 128) : undefined,
        value: typeof e.value === 'string' ? e.value.slice(0, 128) : undefined,
      }));
    if (errors.length) failures.push({ dir: str(fv.dir, 256) ?? '?', errors });
  }
  return { plugins, failures };
}
