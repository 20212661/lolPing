import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { engineSatisfied, validateManifest } from '../../../packages/plugin-api/src/validate';

const example = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../packages/plugin-api/examples/${name}/plugin.json`, import.meta.url)), 'utf8'));

describe('validateManifest', () => {
  it('accepts the three example manifests', () => {
    for (const name of ['quick-pack', 'ai-chat', 'py-upper']) {
      const r = validateManifest(example(name));
      expect(r.ok, `${name}: ${r.ok ? '' : r.errors.map((e) => `${e.code} at ${e.path}`).join('; ')}`).toBe(true);
    }
  });

  it('reports a coded error for every broken field at once', () => {
    const r = validateManifest({
      id: 'bad', name: 'x', version: '1.0.0', engines: { lolping: '^1.0.0' }, icon: '../secret.png',
      contributes: { commands: [
        { id: 'a', title: 'A', run: { kind: 'url', url: 'https://x.com/?q={text:url}' } },
        { id: 'b', title: 'B', run: { kind: 'js' } },
        { id: 'b', title: 'B2', run: { kind: 'keys', keys: ['ctrl+c'] } },
      ] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('icon');
    expect(codes).toContain('permissionMissing');
    expect(codes).toContain('commandJsMain');
    expect(codes).toContain('commandIdDuplicate');
    // the permission error says which permission the run kind needs
    const perm = r.errors.find((e) => e.code === 'permissionMissing');
    expect(perm?.value).toBe('open');
    expect(perm?.path).toBe('contributes.commands[0].run');
  });

  it('rejects an absolute exec file, an escaping exec file and a three-character text icon', () => {
    const r = validateManifest({
      id: 'p', name: 'P', version: '1.0.0', engines: { lolping: '^1.0.0' }, permissions: ['shell', 'open'],
      contributes: { commands: [
        { id: 'abs', title: 'A', run: { kind: 'exec', file: 'C:\\tools\\x.exe', protocol: 'plain' } },
        { id: 'esc', title: 'E', run: { kind: 'exec', file: '../run.sh', protocol: 'plain' } },
        { id: 'long', title: 'L', icon: 'text:Abc', run: { kind: 'open', target: 'https://x.com' } },
      ] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain('contributes.commands[0].run.file');
    expect(paths).toContain('contributes.commands[1].run.file');
    expect(paths).toContain('contributes.commands[2].icon');
  });

  it('accepts a bare exec file name for PATH lookup and a two-character text icon', () => {
    const r = validateManifest({
      id: 'p', name: 'P', version: '1.0.0', engines: { lolping: '^1.0.0' }, permissions: ['shell'],
      contributes: { commands: [
        { id: 'upper', title: 'U', icon: 'text:AA', run: { kind: 'exec', file: 'python', protocol: 'stdio-json' } },
      ] },
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a manifest written for another major version', () => {
    const r = validateManifest({
      id: 'p', name: 'P', version: '1.0.0', engines: { lolping: '^2.0.0' },
      contributes: { commands: [{ id: 'a', title: 'A', run: { kind: 'open', target: 'https://x.com' } }] },
      permissions: ['open'],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe('enginesIncompatible');
    expect(r.errors[0].value).toBe('^2.0.0');
  });

  it('normalizes timeout, feedback and unknown requires entries', () => {
    const r = validateManifest({
      id: 'p', name: 'P', version: '1.0.0', engines: { lolping: '^1.0.0' },
      contributes: { commands: [
        { id: 'a', title: 'A', requires: ['text', 'nonsense'], timeoutMs: 999_999, run: { kind: 'open', target: 'https://x.com' } },
      ] },
      permissions: ['open'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const command = r.manifest.contributes.commands[0];
    expect(command.requires).toEqual(['text']);
    expect(command.timeoutMs).toBe(120_000);
    expect(command.feedback).toBe('instant');
  });

  it('rejects an unknown permission with the entry as context', () => {
    const r = validateManifest({
      id: 'p', name: 'P', version: '1.0.0', engines: { lolping: '^1.0.0' },
      permissions: ['root'],
      contributes: { commands: [{ id: 'a', title: 'A', run: { kind: 'open', target: 'https://x.com' } }] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toEqual({ code: 'permissionUnknown', path: 'permissions', value: 'root' });
  });
});

describe('engineSatisfied', () => {
  it('accepts a range the host version satisfies within the same major', () => {
    expect(engineSatisfied('^1.0.0', '1.2.0')).toBe(true);
    expect(engineSatisfied('~1.2.0', '1.2.3')).toBe(true);
    expect(engineSatisfied('>=1.0.0', '1.9.0')).toBe(true);
    expect(engineSatisfied('1.2.0', '1.2.0')).toBe(true);
  });

  it('never crosses a major version, including for >= ranges', () => {
    expect(engineSatisfied('^1.0.0', '2.0.0')).toBe(false);
    expect(engineSatisfied('>=1.0.0', '2.0.0')).toBe(false);
    expect(engineSatisfied('^1.3.0', '1.2.0')).toBe(false);
  });

  it('refuses malformed ranges', () => {
    expect(engineSatisfied('latest', '1.2.0')).toBe(false);
    expect(engineSatisfied('', '1.2.0')).toBe(false);
    expect(engineSatisfied('1.x', '1.2.0')).toBe(false);
  });
});
