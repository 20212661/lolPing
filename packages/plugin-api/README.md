# @lolping/api: the plugin contract (draft)

This package is the contract between lolPing and its plugins: the `plugin.json` manifest, the API plugin
code sees, the messages between the host processes, and adapters that turn foreign formats into manifests.
It holds types, validators and adapters only — no host implementation. The host lands in stages
("Implementation steps" below); until a stage ships, the system in `docs/plugins.md` keeps working.

| File | Audience | What it defines |
|---|---|---|
| `src/manifest.ts` | plugin authors + host | the `plugin.json` shape: commands, permissions, config, run kinds |
| `src/api.ts` | plugin authors | `activate(ctx)`, `Invocation`, `HostActions`, `ResultView` (streaming results) |
| `src/protocol.ts` | host internals | main process <-> shared plugin host messages; the stdio-json protocol for external programs |
| `src/validate.ts` | host | `validateManifest()`, the runtime check for the plugin-folder scan |
| `src/popclip.ts` | host | `fromPopClip()`: PopClip extension -> manifest (v1: URL and Key Press actions) |
| `plugin.schema.json` | editors | generated from manifest.ts, for completion while writing plugin.json |
| `examples/` | reference | declarative pack / streaming AI in JS / Python external program |

## Resolved decisions

1. **The host only trusts the manifest.** The settings window reads `plugin.json` to list commands; the
   user only binds a command ref `<pluginId>.<commandId>` to a wheel slot. The old hand-typed entry path,
   command name and JSON config go away.
2. **Plugins do not depend on Cordis.** A plugin depends on `@lolping/api` only (its version declared in
   `engines.lolping`). Cordis may stay inside the host for lifecycle; `ctx.subscriptions` is the old
   `ctx.effect`.
3. **Built-in actions and third-party plugins share one API.** `CommandHostDeps`, today reserved for the
   built-ins, becomes `HostActions`, open to every plugin, each method gated by `permissions`.
4. **Three execution tiers.**
   - `url / keys / open`: executed by the host directly, no process at all (most PopClip extensions land here).
   - `js`: all plugins share one resident plugin host process, lazily started, reclaimed after five idle
     minutes, restarted when a call times out. A plugin whose calls time out twice in a row is demoted to
     `isolated` automatically, with a note in the settings. `isolated: true` keeps today's one throwaway
     process per trigger.
   - `exec`: an external program speaking stdin/stdout NDJSON; plugins in any language.
5. **Input is the selection, not just the clipboard.** A command declaring `requires: ["text"]` gets its
   text collected before it starts: the selection first, the clipboard as a fallback.
   - Reading the selection on Windows: UI Automation first. When that yields nothing, the host simulates
     Ctrl+C — only if the user's setting allows it (default on) — after saving the clipboard, and restores
     the clipboard afterwards. Clipboard managers may still capture the transient content; the README's
     privacy notes say so. Before simulating, the host releases the wheel modifier (the app must not see
     Alt+Ctrl+C), and the synthesized events are marked so the input helper ignores them. macOS reads the
     selection through the Accessibility API instead, so the setting is Windows-only.
6. **Results can stream.** `inv.result.append()` appends as output arrives; `setActions()` offers Copy and
   Replace-selection buttons. One shared host, not one per plugin: a restart loses only warm state, and the
   demotion rule above contains a misbehaving plugin without paying resident memory for all of them.
7. **PopClip JavaScript actions wait for v2**, and v2 will cover the six synchronous methods only
   (`input.text`, `showText`, `copyText`, `pasteText`, `pressKey`, `openUrl`), mapped 1:1 onto
   `HostActions` and `ResultView`. No `showHtml`, no browser control, no persistent globals across
   invocations, no network helpers (plugins have fetch).

## Placeholders

`{text}` the raw text, `{text:url}` URL-encoded, `{config.<key>}` a config value. Nothing else is
expanded — in particular not environment variables like `%USERPROFILE%`.

## Validation errors

`validateManifest` returns coded errors (`ManifestError`); the settings window maps the codes to text in
`src/shared/i18n.ts` when the plugin UI ships. This package carries no user-facing strings, and plugin
authors keep the language of their own titles and results.

## Migration map

| Today | Becomes |
|---|---|
| `CustomAction` (hand-typed entry/command/config) | scan `%APPDATA%/lolPing/plugins/*/plugin.json` + `validateManifest` |
| `ActionId = plugin:<id>` | wheel bindings store `CommandRef = <pluginId>.<commandId>`; old `plugin:<id>` bindings keep reading during migration |
| `ActionEnv { readClipboard, trigger, signal }` | `Invocation` (adds text, app, config, host, result) |
| `ActionResult` / `ActionError` | `CommandResult` / `ErrorCode` (adds noText, permission, cancelled) |
| `PluginRunner` forking per trigger | `isolated` plugins keep it; the rest share a host, reusing the timeout and kill logic |
| `CommandService` inside pluginRuntime | one `PluginContext` per plugin in the shared host; `register` accepts only manifest-declared handlers |
| the four built-in actions | rewritten as built-in plugins (with plugin.json), calling only `HostActions` |

## Implementation steps

Status: steps 1–3 have landed (the scan, the settings list and configuration forms, `CommandRef` wheel
bindings, and the `url`/`open` declarative executors; `keys` reports "not available yet" until step 4).
Each step leaves the app working and independently testable.

1. Land this package in `packages/plugin-api`; the host imports its types and `validateManifest` directly.
2. **Plugin folder scan**: validate with `validateManifest`, list commands in the settings (with permission
   display and the configuration form), switch wheel bindings to `CommandRef`.
3. **Declarative executors**: the `url / keys / open` run kinds, plus `{text}` / `{text:url}` / `{config.x}`
   placeholder substitution.
4. **HostActions** in the main process: getSelection (Windows: UI Automation first, Ctrl+C with clipboard
   restore as the allowed fallback — decision 5), paste, pressKeys, open, exec.
5. **The shared plugin host**: `ToPluginHost` / `FromPluginHost` from protocol.ts, lazy start, idle
   reclaim, timeout restart and the demotion rule; ResultView streaming to the overlay (coalesced to
   about 30 fps).
6. **The exec executor**: stdio-json and plain modes; the `then` follow-up actions.
7. **Rewrite the four built-in actions as built-in plugins**, deleting the `CommandHostDeps` privilege
   channel.
8. **PopClip import**: paste a snippet in the settings -> parse YAML -> `fromPopClip` -> list skipped and
   flagged actions -> save into the plugin folder.

## The JSON schema

`plugin.schema.json` is generated from `src/manifest.ts`. Regenerate it when the manifest types change:

    npx ts-json-schema-generator@2.4.0 -p src/manifest.ts -t PluginManifest -o plugin.schema.json --no-type-check

The generator is not a repo dependency; run it on demand.
