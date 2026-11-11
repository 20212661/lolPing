/**
 * PopClip extension -> lolPing manifest. Compatibility lives in this adapter, not in the core.
 *
 * Input: an already-parsed PopClip config object (snippet YAML or Config.json/yaml are parsed by the
 * caller; YAML parsing stays out so this file needs no dependency).
 * Output: a PluginManifest plus what was skipped or flagged, each with a reason code the host renders
 * through i18n.
 *
 * v1 converts URL actions and Key Press actions (command->ctrl, option->alt). v1 skips AppleScript
 * (will not run on Windows), Shell Script (usually zsh/macOS commands), Shortcut and Service actions.
 * v2 plan: JavaScript actions, via a small `popclip` global in the plugin host (see README).
 */

import { ID_PATTERN, type CommandContribution, type Permission, type PluginManifest } from './manifest';

/** Why an action was not converted. */
export type SkipReason = 'javascript' | 'applescript' | 'shell' | 'unsupported' | 'keyCombo';
/** Why a converted action still needs a second look. */
export type WarnReason = 'requiredApps';

export interface PopClipConversion {
  manifest: PluginManifest;
  skipped: Array<{ title: string; reason: SkipReason }>;
  warnings: Array<{ title: string; reason: WarnReason }>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** "Google Translate" -> "google-translate"; falls back when nothing usable remains (an all-CJK name). */
export function slug(name: string, fallback: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return ID_PATTERN.test(s) ? s : fallback;
}

/** PopClip's URL placeholders: *** and {popclip text}, both meaning the URL-encoded selection. */
export function convertUrl(url: string): string {
  return url.replace(/\*\*\*/g, '{text:url}').replace(/\{popclip text\}/gi, '{text:url}');
}

const MODIFIERS: Record<string, string> = {
  command: 'ctrl', cmd: 'ctrl', control: 'ctrl', ctrl: 'ctrl',
  option: 'alt', opt: 'alt', alt: 'alt', shift: 'shift',
};

/** "command shift =" -> "ctrl+shift+="; null when the combo names a modifier we do not know. */
export function convertKeyCombo(combo: unknown): string | null {
  if (typeof combo !== 'string') return null;
  const parts = combo.trim().toLowerCase().split(/\s+/);
  if (parts.length === 0) return null;
  const key = parts.pop()!;
  const mods: string[] = [];
  for (const p of parts) {
    const m = MODIFIERS[p];
    if (!m) return null;
    if (!mods.includes(m)) mods.push(m);
  }
  return [...mods, key].join('+');
}

export function fromPopClip(config: unknown, source?: string): PopClipConversion {
  const skipped: PopClipConversion['skipped'] = [];
  const warnings: PopClipConversion['warnings'] = [];
  const root = isObj(config) ? config : {};
  const name = str(root.name) ?? 'PopClip Extension';
  const id = slug(str(root.identifier)?.split('.').pop() ?? name, 'popclip-ext');
  // A single action writes its fields at the top level; multiple actions live in an array. Both shapes accepted.
  const rawActions: Obj[] = Array.isArray(root.actions) ? root.actions.filter(isObj) : [root];

  const commands: CommandContribution[] = [];
  const permissions = new Set<Permission>();
  rawActions.forEach((a, i) => {
    const title = str(a.title) ?? str(a.name) ?? (rawActions.length === 1 ? name : `${name} ${i + 1}`);
    const cmdId = slug(title, `action-${i + 1}`);
    const unique = commands.some((c) => c.id === cmdId) ? `${cmdId}-${i + 1}` : cmdId;
    const icon = str(a.icon) ?? str(root.icon);
    const base = {
      id: unique,
      title,
      icon: icon && icon.length <= 2 ? `text:${icon}` : undefined, // iconify: names and file icons wait for v2
      requires: ['text'] as CommandContribution['requires'],
    };

    const url = str(a.url);
    if (url) {
      commands.push({ ...base, feedback: 'instant', run: { kind: 'url', url: convertUrl(url), cleanText: a['clean query'] === true } });
      permissions.add('open');
      return;
    }
    const combos = Array.isArray(a.keyCombos) ? a.keyCombos : a.keyCombo !== undefined ? [a.keyCombo] : null;
    if (combos) {
      const keys = combos.map(convertKeyCombo);
      if (keys.some((k) => k === null)) { skipped.push({ title, reason: 'keyCombo' }); return; }
      if (Array.isArray(a.requiredApps) && a.requiredApps.length) {
        // requiredApps are macOS bundle ids with no Windows counterpart; the action stays, the limit does not.
        warnings.push({ title, reason: 'requiredApps' });
      }
      commands.push({ ...base, requires: undefined, feedback: 'instant', run: { kind: 'keys', keys: keys as string[] } });
      permissions.add('keys');
      return;
    }
    if (a.javascript !== undefined || a['javascript file'] !== undefined) skipped.push({ title, reason: 'javascript' });
    else if (a.applescript !== undefined || a['applescript file'] !== undefined) skipped.push({ title, reason: 'applescript' });
    else if (a['shell script'] !== undefined || a['shell script file'] !== undefined) skipped.push({ title, reason: 'shell' });
    else skipped.push({ title, reason: 'unsupported' });
  });

  return {
    manifest: {
      id,
      name,
      version: '0.0.0',
      description: str(root.description),
      engines: { lolping: '^1.0.0' },
      permissions: [...permissions],
      contributes: { commands },
      origin: { kind: 'popclip', source },
    },
    skipped,
    warnings,
  };
}
