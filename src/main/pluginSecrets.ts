/**
 * Plugin secrets: the manifest's `type: 'secret'` configuration entries.
 *
 * Two guarantees, both from the plugin contract:
 *   1. A secret never travels in a plugin's config. Plugins (js and exec) receive publicConfig();
 *      the only way to read a secret is ctx.secrets.get(), which goes through the host.
 *   2. A secret is not stored in plain text. Before a settings patch is saved, sealSecrets() encrypts
 *      each new secret value with the OS (Electron safeStorage: DPAPI on Windows, Keychain on macOS)
 *      and stores it as `sealed:v1:<base64>`. Where the OS offers no encryption (Linux without a
 *      keyring), values stay as typed and a warning is logged once.
 *
 * Pure over an injected Sealer, so the rules are testable without Electron.
 */

import type { PluginManifest } from '../../packages/plugin-api/src/manifest';

import { isSealed, SEALED_PREFIX } from '../shared/sealedSecret';

export { isSealed, SEALED_PREFIX };

type Values = Record<string, string | number | boolean>;

export interface Sealer {
  available(): boolean;
  /** Plain text in, base64 ciphertext out. */
  seal(plain: string): string;
  /** base64 ciphertext in, plain text out; throws when it cannot be opened (another user, a copied file). */
  open(sealed: string): string;
}

/** The configuration keys a manifest marks as secret. */
export function secretKeys(manifest: PluginManifest | undefined): string[] {
  return Object.entries(manifest?.configuration ?? {})
    .filter(([, prop]) => prop.type === 'secret')
    .map(([key]) => key);
}

/** A plugin's config without its secret entries: what js plugins, exec plugins and placeholders see. */
export function publicConfig(manifest: PluginManifest | undefined, values: Values | undefined): Values {
  const hidden = new Set(secretKeys(manifest));
  const out: Values = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!hidden.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Encrypts every secret value that is not sealed yet. Returns the same object when nothing changed, so
 * callers can skip a write. Empty strings stay empty: clearing a secret must not store ciphertext of ''.
 */
export function sealSecrets(
  configs: Record<string, Values>,
  manifestOf: (pluginId: string) => PluginManifest | undefined,
  sealer: Sealer,
): Record<string, Values> {
  if (!sealer.available()) return configs;
  let changed = false;
  const next: Record<string, Values> = {};
  for (const [pluginId, values] of Object.entries(configs)) {
    const keys = secretKeys(manifestOf(pluginId));
    let copy: Values | null = null;
    for (const key of keys) {
      const value = values[key];
      if (typeof value !== 'string' || value === '' || isSealed(value)) continue;
      copy ??= { ...values };
      copy[key] = SEALED_PREFIX + sealer.seal(value);
    }
    if (copy) changed = true;
    next[pluginId] = copy ?? values;
  }
  return changed ? next : configs;
}

/** A stored secret as plain text: sealed values are opened, legacy plain values pass through. */
export function openSecret(value: unknown, sealer: Sealer): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (!isSealed(value)) return value;
  try {
    return sealer.open(value.slice(SEALED_PREFIX.length));
  } catch {
    return undefined; // sealed by another user or machine: treat as not configured
  }
}

/**
 * The built-in AI explain action's API key, sealed by the same rules: plain text in, sealed out,
 * undefined when there is nothing to do (empty, already sealed, or no OS encryption). The key keeps
 * living in settings.actions.aiExplain.apiKey; only its stored form changes.
 */
export function sealAiKey(key: unknown, sealer: Sealer): string | undefined {
  if (!sealer.available()) return undefined;
  if (typeof key !== 'string' || key === '' || isSealed(key)) return undefined;
  return SEALED_PREFIX + sealer.seal(key);
}
