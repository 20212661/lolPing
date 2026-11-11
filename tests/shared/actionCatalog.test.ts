import { describe, expect, it } from 'vitest';
import {
  ACTIONS, actionById, actionIconUrl, defaultActions, isActionId, isWheelItem, normalizeActions, parseActionResult,
} from '../../src/shared/actionCatalog';
import { DEFAULT_WHEEL } from '../../src/shared/pings';
import { isValidItemWheel } from '../../src/shared/wheelLayout';

describe('actionCatalog', () => {
  it('lists four actions with unique ids', () => {
    expect(ACTIONS.map((a) => a.id)).toEqual(['open-app', 'run-script', 'ai-explain', 'clipboard-search']);
  });

  it('knows an action id from anything else', () => {
    expect(isActionId('open-app')).toBe(true);
    expect(isActionId('danger')).toBe(false); // a ping id is never an action id
    expect(isActionId(42)).toBe(false);
  });

  it('still recognises the shape of a v2 binding, so an old settings file loads and repairs its wheel', () => {
    expect(isActionId('plugin:hello')).toBe(true);
    expect(isActionId('plugin:../hello')).toBe(false);
    expect(isActionId('plugin:')).toBe(false);
    expect(isWheelItem('plugin:hello')).toBe(true);
  });

  it('normalizes the four built-ins with bounded strings and http-only urls', () => {
    const normalized = normalizeActions({
      openApp: { target: '  https://x.com  ' },
      runScript: { command: 'x'.repeat(5000) },
      aiExplain: { baseUrl: 'not-a-url', apiKey: 'k', model: 'm' },
      clipboardSearch: { url: 'ftp://nope' },
    });
    expect(normalized.openApp.target).toBe('https://x.com');
    expect(normalized.runScript.command).toHaveLength(1024);
    expect(normalized.aiExplain.baseUrl).toBe('https://api.openai.com/v1');
    expect(normalized.clipboardSearch.url).toBe('https://www.bing.com/search?q=%s');
    expect(normalizeActions({ custom: [{ id: 'plugin:hello' }] })).toEqual(defaultActions()); // a v2 field is ignored
  });

  it('validates plugin results and bounds text without retaining extra fields', () => {
    expect(parseActionResult({ ok: true, detail: 'a'.repeat(5000), token: 'hidden' }))
      .toEqual({ ok: true, detail: 'a'.repeat(4000) });
    expect(parseActionResult({ ok: false, error: 'timeout' })).toEqual({ ok: false, error: 'timeout' });
    expect(parseActionResult({ ok: false, error: 'invalid' })).toBeNull();
  });

  it('gives every action its own icon, stable across calls', () => {
    for (const a of ACTIONS) {
      const icon = actionIconUrl(a.id);
      expect(icon.startsWith('data:image/svg+xml,')).toBe(true);
      expect(icon).toBe(actionIconUrl(a.id));
      expect(icon).toContain(encodeURIComponent(a.color.slice(1)));
    }
    expect(new Set(ACTIONS.map((a) => actionIconUrl(a.id))).size).toBe(ACTIONS.length);
  });

  it('returns defaults for missing or garbage action settings', () => {
    for (const raw of [undefined, null, 7, 'x', [], { openApp: 3 }]) expect(normalizeActions(raw)).toEqual(defaultActions());
  });

  it('keeps configured values, trimmed', () => {
    const s = normalizeActions({
      openApp: { target: '  https://example.com  ' },
      runScript: { command: ' echo hi ' },
      aiExplain: { baseUrl: 'https://api.example.com/v1/', apiKey: ' k-1 ', model: ' m-1 ' },
      clipboardSearch: { url: 'https://example.com/s?q=%s' },
    });
    expect(s.openApp.target).toBe('https://example.com');
    expect(s.runScript.command).toBe('echo hi');
    expect(s.aiExplain).toEqual({ baseUrl: 'https://api.example.com/v1/', apiKey: 'k-1', model: 'm-1' });
    expect(s.clipboardSearch.url).toBe('https://example.com/s?q=%s');
  });

  it('falls back to the default address when a URL field is not http(s)', () => {
    const d = defaultActions();
    const s = normalizeActions({ aiExplain: { baseUrl: 'ftp://x', apiKey: 'k', model: 'm' }, clipboardSearch: { url: 'javascript:alert(1)' } });
    expect(s.aiExplain.baseUrl).toBe(d.aiExplain.baseUrl);
    expect(s.clipboardSearch.url).toBe(d.clipboardSearch.url);
    expect(s.aiExplain.apiKey).toBe('k'); // only the bad field falls back
  });

  it('accepts a wheel of pings and actions, and rejects duplicates or unknown ids', () => {
    expect(isValidItemWheel([...DEFAULT_WHEEL.slice(0, 3), 'open-app', ...DEFAULT_WHEEL.slice(4)])).toBe(true);
    expect(isValidItemWheel(['open-app', ...DEFAULT_WHEEL.slice(1), 'open-app'])).toBe(false);
    expect(isValidItemWheel([...DEFAULT_WHEEL.slice(1), 'nope'])).toBe(false);
    expect(isValidItemWheel(DEFAULT_WHEEL.slice(1))).toBe(false);
  });

  it('knows the wheel item kinds apart', () => {
    expect(isWheelItem('danger')).toBe(true);
    expect(isWheelItem('ai-explain')).toBe(true);
    expect(isWheelItem('nope')).toBe(false);
  });

  it('looks actions up by id', () => {
    expect(actionById('ai-explain')?.feedback).toBe('result');
    expect(actionById('open-app')?.feedback).toBe('instant');
    expect(actionById('gone')).toBeUndefined();
  });
});
