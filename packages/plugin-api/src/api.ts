/**
 * @lolping/api — everything plugin code gets to see.
 *
 * Rules:
 *   - A plugin depends on this package only (types plus one helper) — not on Cordis, not on Electron.
 *     The host can keep using Cordis for its own lifecycle, or drop it later; plugins will not notice.
 *   - The built-in actions (AI explain, clipboard search, open app, run script) are implemented against
 *     this same API, so a third-party plugin can do everything a built-in can.
 *   - Every API change bumps API_VERSION; breaking changes bump the major version.
 */

import type { CommandContribution } from './manifest';

export interface Disposable {
  dispose(): void;
}

/** The plugin entry point: `export function activate(ctx: PluginContext): void | Promise<void>` */
export type Activate = (ctx: PluginContext) => void | Promise<void>;
/** Optional: `export function deactivate(): void | Promise<void>`, called before the plugin host is reclaimed. */
export type Deactivate = () => void | Promise<void>;

export interface PluginContext {
  readonly pluginId: string;
  /** Absolute path of the plugin's folder. */
  readonly pluginPath: string;
  /** The API version of the host, e.g. "1.0.0". */
  readonly apiVersion: string;
  /** Disposables pushed here are released in reverse order when the plugin unloads (VSCode's ctx.subscriptions, Cordis's ctx.effect). */
  readonly subscriptions: Disposable[];
  readonly commands: Commands;
  readonly config: Config;
  readonly secrets: Secrets;
  /** The plugin's own persistent key-value store (JSON-serializable values) in its data folder. */
  readonly storage: Storage;
  readonly log: Logger;
}

export interface Commands {
  /**
   * Registers a handler for a command with run.kind === 'js' in the manifest. The name is run.handler
   * (defaulting to the command id). Registering a name the manifest does not declare throws — the host
   * only trusts the manifest.
   */
  register(name: string, handler: CommandHandler): Disposable;
}

export type CommandHandler = (inv: Invocation) => Promise<CommandResult> | CommandResult;

/** One trigger. It lives until the handler returns (or its stream ends); calls on it afterwards are ignored. */
export interface Invocation {
  /** The command id from the manifest. */
  readonly command: string;
  readonly trigger: Trigger;
  /** Aborts on timeout, user cancel, a settings change, or quit. Handlers should pass it to fetch and friends. */
  readonly signal: AbortSignal;
  /**
   * When the command declares requires: ['text'], the text the host collected before calling (16,384
   * characters at most). The selection first, the clipboard as a fallback; see textSource.
   */
  readonly text: string | undefined;
  readonly textSource: 'selection' | 'clipboard' | undefined;
  /** The foreground app, so commands can behave per app (PopClip's requiredApps). May be unavailable. */
  readonly app: ForegroundApp | undefined;
  /** This plugin's config snapshot (secrets excluded; read those with ctx.secrets.get). */
  readonly config: Readonly<Record<string, unknown>>;
  readonly host: HostActions;
  /** Commands with feedback === 'result' can show output as it is produced (AI streaming). */
  readonly result: ResultView;
}

export interface Trigger {
  /** Where the trigger came from: a wheel release, the command palette, a global hotkey. */
  source: 'wheel' | 'palette' | 'hotkey';
  displayId: number;
  /** CSS pixels relative to that display's overlay. */
  x: number;
  y: number;
}

export interface ForegroundApp {
  /** Windows: the exe file name (lowercase), e.g. "code.exe"; macOS: the bundle id. */
  id: string;
  title?: string;
}

/**
 * Actions executed by the host. Every method needs its permission in the manifest, or it rejects with
 * error 'permission'. These are exactly what CommandHostDeps used to reserve for the built-in actions.
 */
export interface HostActions {
  /** permission: 'selection'. Re-reads the selection (Invocation.text is the snapshot from trigger time). */
  getSelection(): Promise<string>;
  /** permission: 'clipboard.read' */
  readClipboard(): Promise<string>;
  /** permission: 'clipboard.write' */
  writeClipboard(text: string): Promise<void>;
  /** permission: 'paste'. Pastes into the app that was foreground at trigger time (replacing the selection), then restores the clipboard. */
  paste(text: string): Promise<void>;
  /** permission: 'keys'. Example: pressKeys(['ctrl+shift+v']). On failure the host releases every key it pressed. */
  pressKeys(keys: string[], opts?: { delayMs?: number }): Promise<void>;
  /** permission: 'open'. A URL, file or program. */
  open(target: string, args?: string[]): Promise<void>;
  /** permission: 'shell'. The host kills the process with the plugin's lifecycle (fixing today's "child outlives the timeout"). */
  exec(file: string, args: string[], opts?: { stdin?: string; cwd?: string }): Promise<ExecOutput>;
  /** No permission needed: a short toast that does not take over the result bubble. */
  notify(text: string): void;
}

export interface ExecOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** The result bubble. Only the newest trigger on a display can update it (today's ActionRuns rule). */
export interface ResultView {
  /** Replaces the bubble text (plain text, 4,000 characters at most, truncated beyond). */
  set(text: string): void;
  /** Appends text, for streaming. The host coalesces frequent calls (about 30 fps) before sending to the overlay. */
  append(chunk: string): void;
  /** Buttons under the bubble; the host calls the matching action on click. v1 supports these kinds only. */
  setActions(actions: ResultAction[]): void;
}

export type ResultAction =
  | { kind: 'copy'; label?: string }      // copy the whole bubble text
  | { kind: 'paste'; label?: string }     // replace the original selection with the bubble text (needs 'paste')
  | { kind: 'open'; label: string; target: string };  // needs 'open'

/**
 * What a handler returns.
 *   - undefined / { ok: true }: success; if result.append/set were used, the bubble keeps its current content.
 *   - { ok: true, detail }: success, and detail is shown (replacing the bubble).
 *   - { ok: false, error }: a localized error; detail goes to the log only.
 * Throwing is treated as { ok: false, error: 'unknown' }.
 */
export type CommandResult =
  | void
  | { ok: true; detail?: string }
  | { ok: false; error: ErrorCode; detail?: string };

/** The existing ActionError plus 'permission' and 'noText' (which replaces the clipboard-only 'emptyClipboard'). */
export type ErrorCode =
  | 'unknown' | 'unconfigured' | 'noText' | 'emptyClipboard'
  | 'network' | 'http' | 'parse' | 'timeout' | 'busy' | 'disabled'
  | 'pluginLoad' | 'pluginConfig' | 'spawn' | 'permission' | 'cancelled';

export interface Config {
  get<T = unknown>(key: string): T | undefined;
  /** Fires when the user edits this plugin's settings. */
  onDidChange(listener: (keys: string[]) => void): Disposable;
}

export interface Secrets {
  /** Reads a configuration entry of type 'secret'. */
  get(key: string): Promise<string | undefined>;
}

export interface Storage {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** An identity function that only exists for type inference: `export const activate = definePlugin(async (ctx) => { ... })`. */
export function definePlugin(activate: Activate): Activate {
  return activate;
}

/** For host internals: a command as it looks at runtime. */
export interface ResolvedCommand extends CommandContribution {
  pluginId: string;
  ref: `${string}.${string}`;
}
