import { describe, expect, it } from 'vitest';
import { copySteps, encodeSteps, pasteSteps } from '../../src/shared/keySteps';
import { grabSelection, pasteText, PASTE_SETTLE_MS, type ClipboardItemSnapshot, type SelectionClipboard, type SelectionDeps } from '../../src/main/selectionGrab';

const TEXT = 'text/plain';

/** A clipboard fake with whole-item replace semantics, like Electron's write(). */
function fakeClipboard(initial: { text?: string; extra?: ClipboardItemSnapshot[] } = {}): SelectionClipboard & { wrote: string[] } {
  let items: ClipboardItemSnapshot[] = [
    ...(initial.text !== undefined ? [{ mimetype: TEXT, blob: new Blob([initial.text]) }] : []),
    ...(initial.extra ?? []),
  ];
  const wrote: string[] = [];
  const textOf = async (list: ClipboardItemSnapshot[]): Promise<string> => {
    const plain = list.find((i) => i.mimetype === TEXT);
    return plain ? await plain.blob.text() : '';
  };
  return {
    wrote,
    readText: () => textOf(items),
    readAll: async () => [...items],
    writeAll: async (next) => {
      items = [...next];
      wrote.push(next.length === 0 ? 'clear' : next.map((i) => i.mimetype).join('+'));
    },
    clear: () => {
      items = [];
      wrote.push('clear');
    },
  };
}

function deps(clipboard: SelectionClipboard, opts: {
  triggerVk?: number | null;
  tapResult?: boolean;
  afterTap?: (c: SelectionClipboard) => void;
  sleepMs?: number;
} = {}): SelectionDeps {
  const vk = opts.triggerVk === undefined ? 0x12 : opts.triggerVk;
  let tick = 0;
  return {
    clipboard,
    tap: (steps) => {
      expect(steps).toBe(encodeSteps(copySteps(vk)));
      opts.afterTap?.(clipboard);
      return Promise.resolve(opts.tapResult ?? true);
    },
    sleep: () => {
      tick += opts.sleepMs ?? 40;
      return Promise.resolve();
    },
    now: () => 1000 + tick,
  };
}

describe('grabSelection', () => {
  it('simulates the copy, waits for the text to change and restores every format', async () => {
    const clip = fakeClipboard({ text: 'old', extra: [{ mimetype: 'text/html', blob: new Blob(['<b>old</b>']) }] });
    const d = deps(clip, { afterTap: (c) => void c.writeAll([{ mimetype: TEXT, blob: new Blob(['selected']) }]) });
    await expect(grabSelection(d, 0x12)).resolves.toBe('selected');
    expect(clip.wrote.at(-1)).toBe(`${TEXT}+text/html`);
    await expect(clip.readText()).resolves.toBe('old');
  });

  it('keeps polling until the app lands the text, within the timeout', async () => {
    const clip = fakeClipboard({ text: 'old' });
    let polls = 0;
    const d: SelectionDeps = {
      clipboard: clip,
      tap: () => Promise.resolve(true),
      sleep: () => {
        polls += 1;
        if (polls === 3) void clip.writeAll([{ mimetype: TEXT, blob: new Blob(['late']) }]);
        return Promise.resolve();
      },
      now: () => 1000 + polls * 40,
    };
    await expect(grabSelection(d, 0x12)).resolves.toBe('late');
  });

  it('returns null, not the stale clipboard, when nothing is selected', async () => {
    // With no selection the app ignores Ctrl+C: the old clipboard (maybe a password) must not come back.
    const clip = fakeClipboard({ text: 'secret copied earlier' });
    const d = deps(clip, { sleepMs: 500 });
    await expect(grabSelection(d, 0x12, { timeoutMs: 600 })).resolves.toBeNull();
    await expect(clip.readText()).resolves.toBe('secret copied earlier');
  });

  it('still returns a selection that equals the old clipboard text', async () => {
    const clip = fakeClipboard({ text: 'same' });
    const d = deps(clip, { afterTap: (c) => void c.writeAll([{ mimetype: TEXT, blob: new Blob(['same']) }]) });
    await expect(grabSelection(d, 0x12)).resolves.toBe('same');
  });

  it('clears the clipboard before the copy, so the poll only sees what the copy put there', async () => {
    const clip = fakeClipboard({ text: 'old' });
    let textAtTap: string | null = null;
    const d = deps(clip, { afterTap: (c) => { void c.readText().then((t) => { textAtTap = t; }); void c.writeAll([{ mimetype: TEXT, blob: new Blob(['sel']) }]); } });
    await expect(grabSelection(d, 0x12)).resolves.toBe('sel');
    expect(textAtTap).toBe('');
    expect(clip.wrote[0]).toBe('clear');
  });

  it('returns null when the helper never acks, with the clipboard restored', async () => {
    const clip = fakeClipboard({ text: 'old' });
    const d = deps(clip, { tapResult: false });
    await expect(grabSelection(d, 0x12)).resolves.toBeNull();
    await expect(clip.readText()).resolves.toBe('old');
  });

  it('returns null when nothing lands and the clipboard was empty', async () => {
    const clip = fakeClipboard({});
    const d = deps(clip, { triggerVk: null, sleepMs: 500 });
    await expect(grabSelection(d, null, { timeoutMs: 400 })).resolves.toBeNull();
    expect(clip.wrote).toContain('clear'); // an empty snapshot restores to empty, not to the copy's nothing
  });
});

describe('pasteText', () => {
  it('writes the text, taps Ctrl+V with the trigger lift, waits, then restores the clipboard', async () => {
    const clip = fakeClipboard({ text: 'old' });
    const order: string[] = [];
    const d: SelectionDeps = {
      clipboard: clip,
      tap: (steps) => { order.push(`tap:${steps}`); return Promise.resolve(true); },
      sleep: (ms) => { order.push(`sleep:${ms}`); return Promise.resolve(); },
      now: () => 0,
    };
    await expect(pasteText(d, 0x12, 'NEW')).resolves.toBe(true);
    expect(order).toEqual([`tap:${encodeSteps(pasteSteps(0x12))}`, `sleep:${PASTE_SETTLE_MS}`]);
    expect(clip.wrote).toEqual([TEXT, TEXT]); // the paste's write, then the snapshot's restore
    await expect(clip.readText()).resolves.toBe('old');
  });

  it('returns false when the helper never acks, with the clipboard restored', async () => {
    const clip = fakeClipboard({ text: 'old' });
    const d: SelectionDeps = {
      clipboard: clip,
      tap: () => Promise.resolve(false),
      sleep: () => Promise.resolve(),
      now: () => 0,
    };
    await expect(pasteText(d, null, 'NEW')).resolves.toBe(false);
    await expect(clip.readText()).resolves.toBe('old');
  });
});
