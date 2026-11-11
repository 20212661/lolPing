/**
 * Runs the manifest's declarative command kinds (url, open) without starting anything. The keys kind waits
 * for the input synthesis step, js and exec for the plugin host; those come back as 'unsupported'.
 */

import type { CommandRun } from '../../packages/plugin-api/src/manifest';

/** What a declarative command resolved to, as an effect the main process applies with its OS abilities. */
export type RunOutcome =
  | { kind: 'openUrl'; url: string }
  | { kind: 'openTarget'; target: string; args: string[] }
  | { kind: 'noText' }     // the command needs text and none was there
  | { kind: 'unsupported' }; // keys / js / exec, whose executors land in later steps

/** Fills {text}, {text:url} and {config.<key>}; anything else, including %VAR%, passes through unchanged. */
export function fillPlaceholders(template: string, text: string, config: Readonly<Record<string, unknown>>): string {
  return template
    .replace(/\{text:url\}/g, () => encodeURIComponent(text))
    .replace(/\{text\}/g, () => text)
    .replace(/\{config\.([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key: string) => {
      const value = config[key];
      return value === undefined || value === null ? '' : String(value);
    });
}

/** PopClip's "clean query": the text as one line, no leading or trailing whitespace. */
export const cleanText = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Resolves a declarative command to its effect. `text` is undefined when nothing required it and none
 * was available; url commands that require text without any text fail as noText, not with an empty query.
 */
export function runDeclarative(
  command: { run: CommandRun; requires?: readonly string[]; },
  text: string | undefined,
  config: Readonly<Record<string, unknown>>,
): RunOutcome {
  if (command.run.kind === 'url' || command.run.kind === 'open') {
    const needsText = (command.requires ?? []).includes('text');
    if (needsText && !(text ?? '').trim()) return { kind: 'noText' };
    const filled = command.run.kind === 'url' && command.run.cleanText ? cleanText(text ?? '') : text ?? '';
    if (command.run.kind === 'url') {
      return { kind: 'openUrl', url: fillPlaceholders(command.run.url, filled, config) };
    }
    return {
      kind: 'openTarget',
      target: fillPlaceholders(command.run.target, filled, config),
      args: (command.run.args ?? []).map((a) => fillPlaceholders(a, filled, config)),
    };
  }
  return { kind: 'unsupported' };
}
