/**
 * The stored form of a sealed secret (see src/main/pluginSecrets.ts). Shared so the settings window can
 * tell an encrypted value from one the OS could not encrypt, without importing main-process code.
 */
export const SEALED_PREFIX = 'sealed:v1:';

export const isSealed = (v: unknown): v is string => typeof v === 'string' && v.startsWith(SEALED_PREFIX);
