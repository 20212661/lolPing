/**
 * The import orchestration, pure: pasted text -> parsed config -> a converted manifest plus what was
 * skipped or flagged. The main process writes the manifest into the plugins folder; the settings
 * window re-validates the reply before showing it.
 */

import { fromPopClip } from '../../packages/plugin-api/src/popclip';
import { parsePopClipText } from './popclipYaml';

export interface PopClipSkipped {
  title: string;
  reason: string;
}

export type PopClipImport =
  | { ok: true; conversion: ReturnType<typeof fromPopClip> }
  | { ok: false; error: 'parse' | 'noCommands'; skipped: PopClipSkipped[] };

/** Turns pasted text into a manifest; `noCommands` keeps the reasons nothing survived. */
export function importPopClipText(text: string, source?: string): PopClipImport {
  const config = parsePopClipText(text);
  if (!config) return { ok: false, error: 'parse', skipped: [] };
  const conversion = fromPopClip(config, source);
  if (conversion.manifest.contributes.commands.length === 0) {
    return { ok: false, error: 'noCommands', skipped: conversion.skipped };
  }
  return { ok: true, conversion };
}

export interface PopClipImportReply {
  ok: boolean;
  /** 'parse' nothing readable; 'noCommands' every action was skipped; 'exists' the folder is taken. */
  error?: 'parse' | 'noCommands' | 'exists';
  dir?: string;
  skipped: PopClipSkipped[];
  warnings: PopClipSkipped[];
}

/** Re-validates what came back over IPC; null when the reply is not an import result. */
export function parseImportReply(raw: unknown): PopClipImportReply | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): PopClipSkipped[] => (Array.isArray(v)
    ? v.filter((e): e is PopClipSkipped => typeof e === 'object' && e !== null
      && typeof (e as PopClipSkipped).title === 'string' && typeof (e as PopClipSkipped).reason === 'string')
    : []);
  const error = r.error === 'parse' || r.error === 'noCommands' || r.error === 'exists' ? r.error : undefined;
  if (r.ok === true) {
    return { ok: true, dir: typeof r.dir === 'string' ? r.dir : undefined, skipped: list(r.skipped), warnings: list(r.warnings) };
  }
  if (r.ok === false && error !== undefined) {
    return { ok: false, error, dir: typeof r.dir === 'string' ? r.dir : undefined, skipped: list(r.skipped), warnings: [] };
  }
  return null;
}
