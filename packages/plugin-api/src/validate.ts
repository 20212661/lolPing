/**
 * Runtime validation of plugin.json, called when the host scans the plugin folders. No field is trusted;
 * the result is either a normalized manifest or a list of coded errors. No third-party dependency, and
 * semver is checked only far enough to keep a plugin within the host's major version.
 *
 * Errors are codes, not text: the settings window renders them through src/shared/i18n.ts, so this
 * package carries no UI strings.
 */

import {
  API_VERSION, ID_PATTERN,
  type CommandContribution, type CommandRun, type ConfigProperty, type Permission, type PluginManifest,
} from './manifest';

/** Why a manifest was refused. Stable ids, like ActionError. */
export type ManifestErrorCode =
  | 'root'                // the file did not parse to an object
  | 'id'
  | 'name'
  | 'version'
  | 'engines'             // engines.lolping missing or malformed
  | 'enginesIncompatible'
  | 'main'
  | 'icon'
  | 'permissionUnknown'   // a permissions entry that is not a known capability
  | 'configuration'
  | 'configurationKey'
  | 'configurationProperty'
  | 'commands'            // contributes.commands missing, not an array, or empty
  | 'command'             // a commands entry is not an object
  | 'commandId'
  | 'commandIdDuplicate'
  | 'commandTitle'
  | 'commandJsMain'       // a js command, but the manifest declares no main
  | 'permissionMissing'   // the run kind needs a permission the manifest does not declare
  | 'run'                 // run missing, not an object, or of an unknown kind
  | 'runUrl'
  | 'runKeys'
  | 'runTarget'
  | 'runFile'
  | 'runProtocol';

export interface ManifestError {
  code: ManifestErrorCode;
  /** Where in plugin.json the problem is, e.g. 'contributes.commands[2].run'. */
  path?: string;
  /** Context for the message: a permission name, an engines range, a rejected value. */
  value?: string;
}

export type ManifestCheck = { ok: true; manifest: PluginManifest } | { ok: false; errors: ManifestError[] };

const PERMISSIONS: readonly Permission[] = [
  'selection', 'clipboard.read', 'clipboard.write', 'paste', 'keys', 'open', 'shell', 'network',
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
/** A relative path that cannot leave the plugin folder. */
const isRelPath = (v: unknown): v is string =>
  isStr(v, 512) && !/^([a-zA-Z]:)?[\\/]/.test(v) && !v.split(/[\\/]/).includes('..');
/** An icon: a safe in-folder path, or 1–2 characters of text like `text:Ab`. */
const isIconRef = (v: unknown): v is string => {
  if (!isStr(v, 512)) return false;
  return v.startsWith('text:') ? /^text:[\s\S]{1,2}$/.test(v) : isRelPath(v);
};
/** An exec file: a bare name runs from PATH; a path with separators must stay inside the plugin folder. */
const isExecFile = (v: unknown): v is string =>
  isStr(v, 512) && !/^([a-zA-Z]:)?[\\/]/.test(v) && !v.split(/[\\/]/).includes('..');

/**
 * Accepts "^x.y.z", "~x.y.z", ">=x.y.z" and plain "x.y.z". A range never crosses a major version: a plugin
 * written for another major is refused instead of loaded hopefully.
 */
export function engineSatisfied(range: string, host = API_VERSION): boolean {
  const m = /^(\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) return false;
  const want = [Number(m[2]), Number(m[3]), Number(m[4])];
  const have = host.split('.').map(Number);
  if (want[0] !== have[0]) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] > want[i]) return true;
    if (have[i] < want[i]) return false;
  }
  return true;
}

export function validateManifest(raw: unknown): ManifestCheck {
  const errors: ManifestError[] = [];
  const err = (code: ManifestErrorCode, path?: string, value?: string): void => { errors.push({ code, path, value }); };
  if (!isObj(raw)) return { ok: false, errors: [{ code: 'root' }] };

  if (!isStr(raw.id, 64) || !ID_PATTERN.test(raw.id)) err('id', 'id');
  if (!isStr(raw.name, 64)) err('name', 'name');
  if (!isStr(raw.version, 32)) err('version', 'version');
  if (!isObj(raw.engines) || !isStr(raw.engines.lolping, 32)) err('engines', 'engines.lolping');
  else if (!engineSatisfied(raw.engines.lolping)) err('enginesIncompatible', 'engines.lolping', raw.engines.lolping);
  if (raw.main !== undefined && (!isRelPath(raw.main) || !/\.(c|m)?js$/i.test(raw.main))) err('main', 'main');
  if (raw.icon !== undefined && !isIconRef(raw.icon)) err('icon', 'icon');

  const permissions: Permission[] = [];
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) err('permissionUnknown', 'permissions');
    else for (const p of raw.permissions) {
      if (PERMISSIONS.includes(p as Permission)) permissions.push(p as Permission);
      else err('permissionUnknown', 'permissions', String(p));
    }
  }

  const configuration: Record<string, ConfigProperty> = {};
  if (raw.configuration !== undefined) {
    if (!isObj(raw.configuration)) err('configuration', 'configuration');
    else for (const [key, prop] of Object.entries(raw.configuration)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) { err('configurationKey', `configuration.${key}`); continue; }
      if (!isObj(prop) || !['string', 'secret', 'number', 'boolean'].includes(prop.type as string) || !isStr(prop.title, 128)) {
        err('configurationProperty', `configuration.${key}`);
        continue;
      }
      configuration[key] = prop as unknown as ConfigProperty;
    }
  }

  const commands: CommandContribution[] = [];
  const contributes = isObj(raw.contributes) ? raw.contributes : undefined;
  if (!contributes || !Array.isArray(contributes.commands) || contributes.commands.length === 0) {
    err('commands', 'contributes.commands');
  } else {
    contributes.commands.forEach((c, i) => {
      const where = `contributes.commands[${i}]`;
      if (!isObj(c)) { err('command', where); return; }
      if (!isStr(c.id, 64) || !ID_PATTERN.test(c.id)) { err('commandId', `${where}.id`); return; }
      if (commands.some((x) => x.id === c.id)) { err('commandIdDuplicate', `${where}.id`, c.id); return; }
      if (!isStr(c.title, 64)) { err('commandTitle', `${where}.title`); return; }
      const run = checkRun(c.run, where, err, permissions);
      if (!run) return;
      if (run.kind === 'js' && raw.main === undefined) err('commandJsMain', where);
      if (c.icon !== undefined && !isIconRef(c.icon)) err('icon', `${where}.icon`);
      const timeout = typeof c.timeoutMs === 'number' && Number.isFinite(c.timeoutMs)
        ? Math.min(120_000, Math.max(1000, Math.round(c.timeoutMs))) : 15_000;
      const requires = Array.isArray(c.requires) ? c.requires.filter((r) => r === 'text' || r === 'url') : undefined;
      commands.push({
        id: c.id,
        title: c.title,
        description: isStr(c.description, 256) ? c.description : undefined,
        icon: isIconRef(c.icon) ? c.icon : undefined,
        color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : undefined,
        requires: requires as CommandContribution['requires'],
        feedback: c.feedback === 'result' ? 'result' : 'instant',
        timeoutMs: timeout,
        run,
      });
    });
  }

  if (errors.length) return { ok: false, errors };
  const r = raw as Obj & { engines: { lolping: string } };
  return {
    ok: true,
    manifest: {
      id: r.id as string,
      name: r.name as string,
      version: r.version as string,
      description: isStr(r.description, 512) ? r.description : undefined,
      author: isStr(r.author, 128) ? r.author : undefined,
      icon: r.icon as string | undefined,
      engines: { lolping: r.engines.lolping },
      main: r.main as string | undefined,
      isolated: r.isolated === true,
      permissions,
      configuration,
      contributes: { commands },
      origin: isObj(r.origin) && r.origin.kind === 'popclip' ? { kind: 'popclip', source: isStr(r.origin.source) ? r.origin.source : undefined } : undefined,
    },
  };
}

function checkRun(run: unknown, where: string, err: (code: ManifestErrorCode, path?: string, value?: string) => void, perms: Permission[]): CommandRun | null {
  const need = (p: Permission): void => { if (!perms.includes(p)) err('permissionMissing', `${where}.run`, p); };
  if (!isObj(run)) { err('run', `${where}.run`); return null; }
  switch (run.kind) {
    case 'url':
      if (!isStr(run.url, 2048) || !/^https?:\/\//i.test(run.url)) { err('runUrl', `${where}.run.url`); return null; }
      need('open');
      return { kind: 'url', url: run.url, cleanText: run.cleanText === true };
    case 'keys':
      if (!Array.isArray(run.keys) || run.keys.length === 0 || !run.keys.every((k) => isStr(k, 64))) {
        err('runKeys', `${where}.run.keys`);
        return null;
      }
      need('keys');
      return { kind: 'keys', keys: run.keys as string[], delayMs: typeof run.delayMs === 'number' ? run.delayMs : undefined };
    case 'open':
      if (!isStr(run.target, 2048)) { err('runTarget', `${where}.run.target`); return null; }
      need('open');
      return { kind: 'open', target: run.target, args: Array.isArray(run.args) ? run.args.filter((a) => typeof a === 'string') : undefined };
    case 'js':
      return { kind: 'js', handler: isStr(run.handler, 64) ? run.handler : undefined };
    case 'exec':
      if (!isExecFile(run.file)) { err('runFile', `${where}.run.file`); return null; }
      if (run.protocol !== 'stdio-json' && run.protocol !== 'plain') { err('runProtocol', `${where}.run.protocol`); return null; }
      need('shell');
      return {
        kind: 'exec', file: run.file, protocol: run.protocol,
        args: Array.isArray(run.args) ? run.args.filter((a) => typeof a === 'string') : undefined,
      };
    default:
      err('run', `${where}.run.kind`, String(run.kind));
      return null;
  }
}
