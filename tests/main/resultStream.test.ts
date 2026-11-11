import { describe, expect, it } from 'vitest';
import { ResultCoalescer } from '../../src/main/resultStream';

/** A clock the tests run by hand: schedule stores tasks, fire(ms) runs those due. */
function fakeClock() {
  let now = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  let seq = 0;
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = ++seq;
      tasks.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (id: ReturnType<typeof setTimeout>) => tasks.delete(id as unknown as number),
    fire: (ms: number) => {
      now += ms;
      for (const [id, t] of [...tasks.entries()]) {
        if (t.at <= now) {
          tasks.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe('ResultCoalescer', () => {
  it('flushes a set immediately', () => {
    const out: string[] = [];
    const c = new ResultCoalescer(33, (t) => out.push(t));
    c.set('answer');
    expect(out).toEqual(['answer']);
    expect(c.current).toBe('answer');
  });

  it('merges bursts of appends into one flush per window', () => {
    const out: string[] = [];
    const clock = fakeClock();
    const c = new ResultCoalescer(33, (t) => out.push(t), clock.schedule, clock.cancel);
    c.append('a');
    c.append('b');
    c.append('c');
    expect(out).toEqual([]); // nothing before the window closes
    clock.fire(34);
    expect(out).toEqual(['abc']);
    c.append('d');
    clock.fire(34);
    expect(out).toEqual(['abc', 'abcd']);
  });

  it('caps the accumulated text at 4000 characters', () => {
    const out: string[] = [];
    const c = new ResultCoalescer(33, (t) => out.push(t));
    c.append('x'.repeat(5000));
    c.flushNow();
    expect(out[0].length).toBe(4000);
  });

  it('flushNow cancels the pending window and emits once', () => {
    const out: string[] = [];
    const clock = fakeClock();
    const c = new ResultCoalescer(33, (t) => out.push(t), clock.schedule, clock.cancel);
    c.append('q');
    c.flushNow();
    clock.fire(100);
    expect(out).toEqual(['q']);
  });
});
