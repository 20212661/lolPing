# Local Cordis actions

lolPing turns a wheel release into one local command invocation. A binding in Settings → Actions has a stable
`plugin:<id>`, display name, absolute JavaScript entry path, command name, JSON config, enabled flag, clipboard flag
and timeout. Several bindings may use different commands or configurations from the same file.

Start with `tools/plugin-examples/hello.cjs`. It exports a Cordis function and needs no dependencies:

```js
module.exports = function myPlugin(ctx, config) {
  ctx.effect(() => ctx.commands.register('hello', async (env) => {
    return { ok: true, detail: config.message };
  }));
};
```

Use command `hello` and JSON config `{"message":"Hello from my plugin"}`. Add the resulting tile to a wheel slice.
Clicking a tile in the settings pool selects it; it does not execute code. A gesture release runs the command.

ESM entries can use `export default function (ctx, config) { ... }`. An object with `apply(ctx, config)` is also
accepted. Plugins use the installed `cordis` 4.0.0-rc.11 API. This is not the DeepSeek fork discussed in some guides.
Compile TypeScript to `.js`, `.mjs` or `.cjs` before selecting it. Install a plugin's extra packages beside that
plugin so Node can resolve them. Plugins that import Cordis should use the same version as the host.

## Command API

`ctx.commands.register(name, handler)` returns a disposer. Register it inside `ctx.effect` so Cordis removes it
when the plugin unloads. Command names are local to an invocation's context; duplicate names in one context fail.
The handler receives:

- `readClipboard(): Promise<string>`: a snapshot of clipboard text, capped at 16,384 characters. Empty unless the
  binding enables clipboard access. The host never overwrites the clipboard.
- `trigger`: `{ displayId, x, y }`, where x/y are CSS pixels relative to the overlay that received the gesture.
- `signal`: an abort signal cancelled during normal teardown. A hard timeout or host cancellation kills the process;
  it cannot guarantee that plugin cleanup code runs.

Return `{ ok: true }` for the localized completion message, or `{ ok: true, detail: text }` to display a result.
Result text is capped at 4,000 characters and rendered as text, never HTML. Plugins own the language of their supplied
content. Failure results use `{ ok: false, error }`, with a known error code from `src/shared/actionCatalog.ts`, such
as `emptyClipboard`, `network` or `unconfigured`. Raw failure details go to the log; the bubble uses localized text.

## Process and lifecycle

```text
native helper → overlay wheel release → validated Electron IPC → CommandHost
  → PluginRunner → utility process → Cordis Context → registered handler
  ← validated result ← cleanup ← handler result
  → result bubble on the originating display
```

The worker imports the file only on a gesture, waits for the plugin to load, invokes the selected command, aborts
its signal, disposes the Cordis fiber, and returns the result. The parent then terminates that worker, including any
timers it left behind. Edits to the plugin file take effect on the next gesture because each invocation is a fresh
process. The timeout includes startup, optional clipboard reads, the handler and cleanup. CPU loops are contained in
the worker and can be terminated by the parent. Do not start detached child processes if you need the timeout to stop
your work: the host terminates the plugin process, not arbitrary descendants it spawns.

The host suppresses repeated gestures for an action while it runs and allows at most four plugin invocations at a
time. Changing action settings or quitting cancels running work. Settings reloads are serialized; newer settings win.
On a display, only the latest action can replace the current result bubble. Plugin ids never enter the room protocol.

These are trusted local programs with normal Node file, process and network access, not sandboxed extensions.
No screenshot, global hook or key injection capability is added by this API. Keep such operations out of the input
helper; use OS-specific code in a plugin when needed, and always release any synthesized input on failure.
