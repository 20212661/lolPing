/**
 * Turning key names from manifests ("ctrl+shift+v") into the synthesized step sequences the hook helper
 * runs: plain Windows virtual-key codes, encoded as "vk:1,vk:0" (down/up) for the helper's flat JSON.
 */

export interface KeyStep {
  vk: number;
  down: boolean;
}

const MODS: Record<string, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, cmd: 0x5b };
const NAMED: Record<string, number> = {
  enter: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08,
  delete: 0x2e, del: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
  '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde,
};
for (let i = 1; i <= 12; i++) NAMED[`f${i}`] = 0x6f + i;

/** One key's Windows virtual-key code, or null for a name this table does not know. */
export function vkOf(key: string): number | null {
  if (key.length === 1) {
    const c = key.charCodeAt(0);
    if (c >= 0x61 && c <= 0x7a) return 0x41 + (c - 0x61); // a-z
    if (c >= 0x30 && c <= 0x39) return c;                  // 0-9
  }
  return MODS[key] ?? NAMED[key] ?? null;
}

/** "ctrl+shift+v" → [VK_CONTROL, VK_SHIFT, V]; modifiers first, one main key last. Null when unparseable. */
export function parseKeyCombo(combo: string): number[] | null {
  if (combo === '+') return [0xbb]; // the plus key alone, since it is also the separator
  const parts = combo.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const main = vkOf(parts[parts.length - 1]);
  if (main === null) return null;
  const mods: number[] = [];
  for (const p of parts.slice(0, -1)) {
    const vk = MODS[p];
    if (vk === undefined || mods.includes(vk)) return null; // only modifiers may precede the key
    mods.push(vk);
  }
  return [...mods, main];
}

/** A combo as tap steps: modifiers and key down, then everything up in reverse. */
export function tapSteps(combo: string): KeyStep[] | null {
  const vks = parseKeyCombo(combo);
  if (!vks) return null;
  return [
    ...vks.map((vk) => ({ vk, down: true })),
    ...[...vks].reverse().map((vk) => ({ vk, down: false })),
  ];
}

/**
 * The Ctrl+C sequence for reading a selection: the wheel trigger is lifted first (the app must not see
 * Alt+Ctrl+C) and held again after, so the user's finger never notices. A mouse trigger needs no lift.
 */
export function copySteps(triggerVk: number | null): KeyStep[] {
  const lift = triggerVk !== null ? [{ vk: triggerVk, down: false }] : [];
  const hold = triggerVk !== null ? [{ vk: triggerVk, down: true }] : [];
  return [
    ...lift,
    { vk: 0x11, down: true }, { vk: 0x43, down: true },
    { vk: 0x43, down: false }, { vk: 0x11, down: false },
    ...hold,
  ];
}

/** Steps as the helper's "steps" string: "164:0,162:1,67:1". */
export const encodeSteps = (steps: readonly KeyStep[]): string =>
  steps.map((s) => `${s.vk}:${s.down ? 1 : 0}`).join(',');

const TRIGGER_VKS: Record<string, number> = { alt: 0x12, ctrl: 0x11, shift: 0x10, win: 0x5b, capslock: 0x14 };

/** A wheel trigger key's vk, for lifting it while a copy is synthesized; a mouse trigger stays held. */
export function triggerVkOf(t: { vk?: number } | string): number | null {
  if (typeof t === 'object') return t.vk ?? null;
  return TRIGGER_VKS[t] ?? null;
}
