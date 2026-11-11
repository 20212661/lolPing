/**
 * A scanned plugin's persistent key-value store: one JSON file per plugin under plugins/data. Values
 * are JSON-serializable and bounded; writes are atomic (temp file + rename) so a crash mid-write
 * never leaves a torn file behind.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_KEYS = 256;
const MAX_VALUE_BYTES = 64 * 1024;

/** Reads a plugin's whole store; a missing or broken file is an empty store, not an error. */
export function readPluginStore(dataDir: string, pluginId: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, `${pluginId}.json`), 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw).slice(0, MAX_KEYS)) {
      if (JSON.stringify(v ?? null)?.length <= MAX_VALUE_BYTES) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Atomically replaces a plugin's store file. */
export function writePluginStore(dataDir: string, pluginId: string, store: Record<string, unknown>): void {
  mkdirSync(dataDir, { recursive: true });
  const bounded = Object.fromEntries(Object.entries(store).slice(0, MAX_KEYS));
  const file = join(dataDir, `${pluginId}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(bounded), 'utf8');
  renameSync(tmp, file);
}
