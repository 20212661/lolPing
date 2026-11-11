/**
 * Scans the plugins folder (settings/plugins) for plugin.json manifests and turns them into what the app
 * needs: the settings window's plugin list and the overlays' command icons. The core is pure over folder
 * inputs; the fs side stays in listFolderInputs.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import { validateManifest, type ManifestError } from '../../packages/plugin-api/src/validate';
import { commandRef, isCommandRef } from '../../packages/plugin-api/src/manifest';
import { tileIconUrl, type PluginListResult, type PluginView } from '../shared/commandTiles';
import type { WheelItem } from '../shared/actionCatalog';

export interface ScannedPlugin {
  dir: string;
  manifest: PluginManifest;
}

export interface ScanResult {
  plugins: ScannedPlugin[];
  failures: Array<{ dir: string; errors: ManifestError[] }>;
}

export interface PluginFolderInput {
  /** The folder's name under the plugins folder. */
  dir: string;
  /** The parsed plugin.json, or null when it is missing or did not parse. */
  manifest: unknown;
}

const MAX_ICON_BYTES = 65_536;

/** One entry per subfolder, sorted by name; a missing or unreadable plugins folder scans as empty. */
export function listFolderInputs(root: string): PluginFolderInput[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const inputs: PluginFolderInput[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    let manifest: unknown = null;
    try {
      manifest = JSON.parse(readFileSync(join(root, e.name, 'plugin.json'), 'utf8'));
    } catch {
      // missing or broken JSON: validateManifest reports it as a coded error
    }
    inputs.push({ dir: e.name, manifest });
  }
  return inputs;
}

/** Validates each folder's manifest; a valid one joins the plugins, anything else joins the failures. */
export function scanPluginFolders(inputs: readonly PluginFolderInput[]): ScanResult {
  const plugins: ScannedPlugin[] = [];
  const failures: ScanResult['failures'] = [];
  for (const { dir, manifest } of inputs) {
    const check = validateManifest(manifest);
    if (check.ok) plugins.push({ dir, manifest: check.manifest });
    else failures.push({ dir, errors: check.errors });
  }
  return { plugins, failures };
}

/** Reads a plugin's icon file as a data URL, or null when it is missing, oversized or not svg/png. */
function readIconFile(root: string, dir: string, rel: string): string | null {
  const file = join(root, dir, rel);
  try {
    if (statSync(file).size > MAX_ICON_BYTES) return null;
    const raw = readFileSync(file);
    const mime = /\.svg$/i.test(rel) ? 'image/svg+xml' : /\.png$/i.test(rel) ? 'image/png' : null;
    return mime ? `data:${mime};base64,${raw.toString('base64')}` : null;
  } catch {
    return null;
  }
}

/** The plugin list for the settings window, with each command's tile icon resolved to a data URL. */
export function buildPluginList(scan: ScanResult, root: string): PluginListResult {
  const plugins: PluginView[] = scan.plugins.map(({ dir, manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    dir,
    permissions: manifest.permissions ?? [],
    commands: manifest.contributes.commands.map((c) => {
      const ref = commandRef(manifest.id, c.id);
      const iconRef = c.icon ?? manifest.icon;
      const fileIcon = iconRef && !iconRef.startsWith('text:') ? readIconFile(root, dir, iconRef) : null;
      return {
        ref,
        title: c.title,
        icon: tileIconUrl(iconRef, fileIcon, c.color),
        color: c.color,
        feedback: c.feedback ?? 'instant',
        runKind: c.run.kind,
      };
    }),
    configuration: Object.entries(manifest.configuration ?? {}).map(([key, prop]) => ({
      key,
      type: prop.type,
      title: prop.title,
      description: prop.description,
      default: 'default' in prop ? prop.default : undefined,
      enum: 'enum' in prop ? prop.enum : undefined,
      multiline: 'multiline' in prop ? prop.multiline === true : false,
    })),
  }));
  return {
    plugins,
    failures: scan.failures.map((f) => ({ dir: f.dir, errors: f.errors.map((e) => ({ code: e.code, path: e.path, value: e.value })) })),
  };
}

/** Finds the plugin and command a wheel slot's ref points at, or null when no scan has it. */
export function findCommand(scan: ScanResult, ref: string): { plugin: ScannedPlugin; command: PluginManifest['contributes']['commands'][number] } | null {
  if (!isCommandRef(ref)) return null;
  const [pluginId, commandId] = ref.split('.');
  const plugin = scan.plugins.find((p) => p.manifest.id === pluginId);
  const command = plugin?.manifest.contributes.commands.find((c) => c.id === commandId);
  return plugin && command ? { plugin, command } : null;
}

/** The ids every wheel item can be checked against: pings always, plus whatever this scan provides. */
export const scannedRefs = (scan: ScanResult): Set<string> =>
  new Set(scan.plugins.flatMap((p) => p.manifest.contributes.commands.map((c) => commandRef(p.manifest.id, c.id))));

/** Whether a wheel item still exists: this is what repairUnknownItems checks refs against. */
export function itemExists(scan: ScanResult, customActionIds: readonly string[], id: WheelItem): boolean {
  if (scannedRefs(scan).has(id)) return true;
  return id.startsWith('plugin:') ? customActionIds.includes(id) : !id.includes('.');
}
