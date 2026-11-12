import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../../packages/plugin-api/src/manifest';
import { openSecret, publicConfig, SEALED_PREFIX, sealSecrets, secretKeys, type Sealer } from '../../src/main/pluginSecrets';

const manifest = {
  id: 'ai', name: 'AI', version: '1.0.0', engines: { lolping: '^1.0.0' },
  configuration: {
    model: { type: 'string', title: 'Model' },
    apiKey: { type: 'secret', title: 'Key' },
  },
  contributes: { commands: [] },
} as unknown as PluginManifest;

/** Reversible fake "encryption", so tests can see sealing happened and undo it. */
const sealer = (available = true): Sealer => ({
  available: () => available,
  seal: (p) => Buffer.from(`enc(${p})`).toString('base64'),
  open: (s) => {
    const t = Buffer.from(s, 'base64').toString();
    if (!t.startsWith('enc(')) throw new Error('not mine');
    return t.slice(4, -1);
  },
});
const manifestOf = (id: string): PluginManifest | undefined => (id === 'ai' ? manifest : undefined);

describe('pluginSecrets', () => {
  it('finds the secret keys of a manifest', () => {
    expect(secretKeys(manifest)).toEqual(['apiKey']);
    expect(secretKeys(undefined)).toEqual([]);
  });

  it('keeps secrets out of the config plugins receive', () => {
    expect(publicConfig(manifest, { model: 'deepseek-chat', apiKey: 'sk-123' })).toEqual({ model: 'deepseek-chat' });
    expect(publicConfig(manifest, undefined)).toEqual({});
  });

  it('seals plain secrets once, leaves other values and empties alone', () => {
    const configs = { ai: { model: 'm', apiKey: 'sk-123' }, other: { apiKey: 'not a secret here' } };
    const sealed = sealSecrets(configs, manifestOf, sealer());
    expect(sealed.ai.apiKey).toMatch(new RegExp(`^${SEALED_PREFIX}`));
    expect(sealed.ai.apiKey).not.toContain('sk-123');
    expect(sealed.ai.model).toBe('m');
    expect(sealed.other).toBe(configs.other);
    expect(sealSecrets(sealed, manifestOf, sealer())).toBe(sealed); // already sealed: same object, no write
    const empty = { ai: { apiKey: '' } };
    expect(sealSecrets(empty, manifestOf, sealer())).toBe(empty);
  });

  it('leaves values as typed when the OS cannot encrypt', () => {
    const configs = { ai: { apiKey: 'sk-123' } };
    expect(sealSecrets(configs, manifestOf, sealer(false))).toBe(configs);
  });

  it('opens sealed secrets, passes legacy plain ones, and treats foreign ciphertext as unset', () => {
    const sealed = sealSecrets({ ai: { apiKey: 'sk-123' } }, manifestOf, sealer());
    expect(openSecret(sealed.ai.apiKey, sealer())).toBe('sk-123');
    expect(openSecret('sk-legacy', sealer())).toBe('sk-legacy');
    expect(openSecret(`${SEALED_PREFIX}${Buffer.from('junk').toString('base64')}`, sealer())).toBeUndefined();
    expect(openSecret('', sealer())).toBeUndefined();
    expect(openSecret(42, sealer())).toBeUndefined();
  });
});
