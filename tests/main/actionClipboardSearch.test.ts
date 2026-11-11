import { describe, expect, it } from 'vitest';
import { searchUrlFor } from '../../src/main/actionClipboardSearch';

describe('searchUrlFor', () => {
  it('puts the text where the template says, encoded for a query string', () => {
    expect(searchUrlFor('https://example.com/s?q=%s&lang=en', 'a b&c')).toBe('https://example.com/s?q=a%20b%26c&lang=en');
  });

  it('appends the text when the template has no placeholder', () => {
    expect(searchUrlFor('https://example.com/s?q=', 'boot')).toBe('https://example.com/s?q=boot');
  });

  it('falls back to the default engine for an empty template', () => {
    expect(searchUrlFor('   ', 'boot')).toBe('https://www.bing.com/search?q=boot');
  });
});
