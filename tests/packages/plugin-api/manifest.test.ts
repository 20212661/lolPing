import { describe, expect, it } from 'vitest';
import { commandRef, ID_PATTERN, isCommandRef } from '../../../packages/plugin-api/src/manifest';

describe('ID_PATTERN', () => {
  it('accepts lowercase ids with digits and dashes', () => {
    expect(ID_PATTERN.test('ai-chat')).toBe(true);
    expect(ID_PATTERN.test('py-upper')).toBe(true);
    expect(ID_PATTERN.test('a')).toBe(true);
  });

  it('rejects uppercase, dots, empty strings and a leading dash', () => {
    expect(ID_PATTERN.test('Ai-Chat')).toBe(false);
    expect(ID_PATTERN.test('a.b')).toBe(false);
    expect(ID_PATTERN.test('')).toBe(false);
    expect(ID_PATTERN.test('-x')).toBe(false);
  });
});

describe('commandRef', () => {
  it('joins the plugin id and the command id with a dot', () => {
    expect(commandRef('ai-chat', 'explain')).toBe('ai-chat.explain');
  });
});

describe('isCommandRef', () => {
  it('accepts two well-formed ids joined by a dot', () => {
    expect(isCommandRef('ai-chat.explain')).toBe(true);
    expect(isCommandRef('py-upper.upper')).toBe(true);
  });

  it('rejects everything a slot binding should never contain', () => {
    expect(isCommandRef('plugin:ai-chat')).toBe(false); // the old v2 binding format
    expect(isCommandRef('ai-chat.')).toBe(false);
    expect(isCommandRef('.explain')).toBe(false);
    expect(isCommandRef('ai-chat.explain.extra')).toBe(false);
    expect(isCommandRef('')).toBe(false);
    expect(isCommandRef(42)).toBe(false);
  });
});
