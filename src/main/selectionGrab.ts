/**
 * Reading the text selection by simulating Ctrl+C (the UI-Automation-first path lands later). The
 * clipboard is captured before and restored after, so the user's clipboard looks untouched; formats
 * Electron cannot round-trip (bookmark objects and the like) are the known cost, stated in the README.
 * Everything OS-shaped is injected, so tests drive the whole flow with fakes.
 */

import { encodeSteps, copySteps } from '../shared/keySteps';

/** One clipboard format, as Electron 44's mimetype-based clipboard items see it. */
export interface ClipboardItemSnapshot {
  mimetype: string;
  blob: Blob;
}

export interface SelectionClipboard {
  readText(): Promise<string>;
  /** Every format the clipboard currently holds; an empty list means the clipboard was empty. */
  readAll(): Promise<ClipboardItemSnapshot[]>;
  writeAll(items: ClipboardItemSnapshot[]): Promise<void>;
  clear(): void;
}

export interface SelectionDeps {
  /** Sends a synthesized key sequence to the helper; false when it was not acked. */
  tap(steps: string): Promise<boolean>;
  clipboard: SelectionClipboard;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Simulates the copy, waits for the clipboard text to change (the app needs a moment), then restores
 * every format. Returns the selected text, or null when nothing was selected, the helper is gone, or
 * nothing arrived in time. An unchanged clipboard after the timeout still yields its text: the
 * selection may simply equal what was there before.
 */
export async function grabSelection(
  deps: SelectionDeps,
  triggerVk: number | null,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string | null> {
  const { timeoutMs = 800, pollMs = 40 } = opts;
  const snapshot = await deps.clipboard.readAll();
  try {
    const before = await deps.clipboard.readText();
    const tapped = await deps.tap(encodeSteps(copySteps(triggerVk)));
    if (!tapped) return null;
    const deadline = deps.now() + timeoutMs;
    let text = await deps.clipboard.readText();
    while (text === before && deps.now() < deadline) {
      await deps.sleep(pollMs);
      text = await deps.clipboard.readText();
    }
    return text.trim() ? text : null;
  } finally {
    if (snapshot.length > 0) await deps.clipboard.writeAll(snapshot);
    else deps.clipboard.clear();
  }
}
