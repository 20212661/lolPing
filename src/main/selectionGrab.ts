/**
 * Reading the text selection by simulating Ctrl+C (the UI-Automation-first path lands later). The
 * clipboard is captured before and restored after, so the user's clipboard looks untouched; formats
 * Electron cannot round-trip (bookmark objects and the like) are the known cost, stated in the README.
 * Everything OS-shaped is injected, so tests drive the whole flow with fakes.
 */

import { encodeSteps, copySteps, pasteSteps } from '../shared/keySteps';

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
 * Empties the clipboard, simulates the copy, waits for text to land (the app needs a moment), then
 * restores every format. Returns the selected text, or null when nothing was selected, the helper is
 * gone, or nothing arrived in time.
 *
 * The clipboard is cleared first so "nothing selected" is distinguishable: with no selection most apps
 * leave the clipboard alone, and comparing against the old text would hand back the stale clipboard
 * (a copied password, say) as if it were the selection, after waiting out the whole timeout.
 */
export async function grabSelection(
  deps: SelectionDeps,
  triggerVk: number | null,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string | null> {
  const { timeoutMs = 800, pollMs = 40 } = opts;
  const snapshot = await deps.clipboard.readAll();
  try {
    deps.clipboard.clear();
    const tapped = await deps.tap(encodeSteps(copySteps(triggerVk)));
    if (!tapped) return null;
    const deadline = deps.now() + timeoutMs;
    let text = await deps.clipboard.readText();
    while (text === '' && deps.now() < deadline) {
      await deps.sleep(pollMs);
      text = await deps.clipboard.readText();
    }
    return text.trim() ? text : null;
  } finally {
    if (snapshot.length > 0) await deps.clipboard.writeAll(snapshot);
    else deps.clipboard.clear();
  }
}

/**
 * Pastes `text` into the foreground app: clipboard snapshot, write the text, synthesize Ctrl+V (with the
 * trigger lift), give the app a moment to take it, then restore. False when the helper never acked.
 */
/**
 * How long the pasted text stays on the clipboard after Ctrl+V. Office and Electron-based apps can read
 * it well after 120 ms; restoring too early pastes the user's old clipboard instead.
 */
export const PASTE_SETTLE_MS = 400;

export async function pasteText(
  deps: SelectionDeps,
  triggerVk: number | null,
  text: string,
  settleMs = PASTE_SETTLE_MS,
): Promise<boolean> {
  const snapshot = await deps.clipboard.readAll();
  try {
    await deps.clipboard.writeAll([{ mimetype: 'text/plain', blob: new Blob([text.slice(0, 16_384)]) }]);
    const tapped = await deps.tap(encodeSteps(pasteSteps(triggerVk)));
    if (!tapped) return false;
    await deps.sleep(settleMs); // the app reads the clipboard while handling the synthesized Ctrl+V
    return true;
  } finally {
    if (snapshot.length > 0) await deps.clipboard.writeAll(snapshot);
    else deps.clipboard.clear();
  }
}
