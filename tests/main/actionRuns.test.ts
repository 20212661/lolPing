import { describe, expect, it } from 'vitest';
import { ActionRuns } from '../../src/main/actionRuns';

describe('ActionRuns', () => {
  it('suppresses duplicate gestures without losing the original result', () => {
    const runs = new ActionRuns();
    const first = runs.start('plugin:hello', 1);
    if (!first) throw new Error('expected a run');
    expect(runs.start('plugin:hello', 1)).toBeNull();
    expect(runs.finish(first)).toBe(true);
    expect(runs.start('plugin:hello', 1)).not.toBeNull();
  });

  it('does not let an older result replace a newer result on the same display', () => {
    const runs = new ActionRuns();
    const first = runs.start('plugin:hello', 1);
    const second = runs.start('plugin:other', 1);
    if (!first || !second) throw new Error('expected two runs');
    expect(runs.finish(second)).toBe(true);
    expect(runs.finish(first)).toBe(false);
    expect(runs.start('plugin:hello', 1)).not.toBeNull();
  });

  it('keeps independent result bubbles on separate displays', () => {
    const runs = new ActionRuns();
    const first = runs.start('plugin:hello', 1);
    const second = runs.start('plugin:other', 2);
    if (!first || !second) throw new Error('expected two runs');
    expect(runs.finish(first)).toBe(true);
    expect(runs.finish(second)).toBe(true);
    expect(runs.finish(second)).toBe(false);
  });
});
