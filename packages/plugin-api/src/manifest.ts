/**
 * plugin.json, the declarative manifest of a plugin.
 *
 * Following VSCode's package.json "contributes" idea: the host reads this file alone, without running any
 * plugin code, and learns which commands the plugin offers, what it wants permission for and what the user
 * can configure. The settings window lists commands from here; the user only binds a command to a wheel slot.
 *
 * A plugin is a folder:
 *   my-plugin/
 *     plugin.json        the structure this file describes
 *     dist/index.js      optional; a purely declarative plugin (url / keys / open commands only) ships no code
 *     icon.svg           optional
 */

/** The shared shape of plugin ids and command ids; matches the existing isPluginActionId rule for migration. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The API version the host implements. Plugins state a semver range in engines.lolping. */
export const API_VERSION = '1.0.0';

export interface PluginManifest {
  /** JSON Schema path, for editor completion only; the host ignores it. */
  $schema?: string;
  /** Globally unique, see ID_PATTERN. Also the prefix of command refs: `<id>.<commandId>`. */
  id: string;
  /** Display name, 64 characters at most. */
  name: string;
  /** semver. */
  version: string;
  description?: string;
  author?: string;
  /** A path inside the plugin folder; svg or png. Used by commands that set no icon of their own. */
  icon?: string;
  engines: {
    /** Example: "^1.0.0". The host refuses to load outside this range and says so in the settings. */
    lolping: string;
  };
  /**
   * The JS entry (relative to the plugin folder, .js/.mjs/.cjs). Exports activate(ctx) and optionally
   * deactivate(). Required when any command has run.kind === 'js'.
   */
  main?: string;
  /**
   * true: keep today's "one throwaway process per trigger" model (strong isolation, stateless, slower).
   * false or missing: load into the shared resident plugin host (lazily started, reclaimed when idle).
   */
  isolated?: boolean;
  /**
   * Capabilities the plugin asks for. Calling a host action without its permission is rejected at runtime
   * with error 'permission'. This is a display of intent, not a sandbox: plugin code is still a trusted
   * local program with direct fs and net access.
   */
  permissions?: Permission[];
  /** User-editable settings; the settings window builds a form from this. */
  configuration?: Record<string, ConfigProperty>;
  contributes: {
    commands: CommandContribution[];
  };
  /** Set by adapters to record where the plugin came from. The host only shows it. */
  origin?: { kind: 'popclip'; source?: string };
}

/**
 * The capability list. It covers only what a plugin does *through the host*; plugin code itself stays a
 * trusted local Node program that can use fs and net directly — this is about what the user can see the
 * plugin asking for, and what the host API can hold a plugin to.
 */
export type Permission =
  | 'selection'        // read the current text selection (the host may simulate Ctrl+C and restore the clipboard)
  | 'clipboard.read'
  | 'clipboard.write'
  | 'paste'            // paste text into the foreground app (replacing the selection)
  | 'keys'             // synthesize key presses
  | 'open'             // open a URL / file / program
  | 'shell'            // run.kind === 'exec' or host.exec()
  | 'network';         // display only; the host does not intercept the plugin's own requests

export type ConfigProperty =
  | { type: 'string'; title: string; description?: string; default?: string; enum?: string[]; multiline?: boolean }
  | { type: 'secret'; title: string; description?: string }   // stored in the system credential store, not settings.json
  | { type: 'number'; title: string; description?: string; default?: number; minimum?: number; maximum?: number }
  | { type: 'boolean'; title: string; description?: string; default?: boolean };

/** What the host must prepare before a command runs. When it cannot, the command fails locally without starting anything. */
export type Requirement = 'text' | 'url';

export interface CommandContribution {
  /** Unique within the plugin, see ID_PATTERN. The full ref `<pluginId>.<id>` goes into wheel bindings. */
  id: string;
  title: string;
  description?: string;
  /** A path inside the plugin folder, or `text:Ab` (1–2 characters of text, like PopClip). */
  icon?: string;
  /** Accent color for the wheel slice and the icon. */
  color?: string;
  requires?: Requirement[];
  /**
   * 'instant': a bubble only on failure (open-a-program, key-press commands).
   * 'result': a result bubble at the cursor (explain, translate).
   * Same meaning as the existing ActionFeedback.
   */
  feedback?: 'instant' | 'result';
  /** Milliseconds, default 15000, range 1000–120000. Covers startup, selection, the run and cleanup. */
  timeoutMs?: number;
  run: CommandRun;
}

/**
 * How a command runs. The first three kinds are purely declarative: the host executes them itself, with no
 * process at all. Text placeholders: {text} the raw text, {text:url} URL-encoded, {config.<key>} a config value.
 * Nothing else is expanded — in particular not environment variables.
 */
export type CommandRun =
  | { kind: 'url'; url: string; /** trim whitespace and newlines before filling it in (PopClip's clean query) */ cleanText?: boolean }
  | { kind: 'keys'; /** pressed in order, e.g. ["ctrl+c"] or ["ctrl+k", "ctrl+s"] */ keys: string[]; delayMs?: number }
  | { kind: 'open'; target: string; args?: string[] }
  | { kind: 'js'; /** the handler name registered in activate; defaults to the command id */ handler?: string }
  | {
    kind: 'exec';
    /** A bare file name runs from PATH; a path with separators must stay inside the plugin folder. */
    file: string;
    args?: string[];
    /**
     * 'stdio-json': one ExecRequest line in, ExecEvent lines out, per protocol.ts; can stream.
     * 'plain': the selected text arrives on stdin (also in the LOLPING_TEXT env var), stdout is the result.
     */
    protocol: 'stdio-json' | 'plain';
  };

/** A command's full name: what a wheel slot in settings.json stores. */
export type CommandRef = `${string}.${string}`;

export const commandRef = (pluginId: string, commandId: string): CommandRef => `${pluginId}.${commandId}`;

/** Runtime guard for a command ref that arrived from a settings file or IPC. */
export const isCommandRef = (v: unknown): v is CommandRef =>
  typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/.test(v);
