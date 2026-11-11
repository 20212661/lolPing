import { isWheelItem, type WheelItem } from './actionCatalog';
import { DEFAULT_CLICK_PING, DEFAULT_WHEEL, WHEEL_SLOTS, isPingId, type PingId } from './pings';

/** A wheel is exactly WHEEL_SLOTS known pings, each at most once. */
export function isValidWheel(v: unknown): v is PingId[] {
  return Array.isArray(v) && v.length === WHEEL_SLOTS && v.every(isPingId) && new Set(v).size === v.length;
}

/** A wheel that may hold actions too: exactly WHEEL_SLOTS pings or actions, each at most once. */
export function isValidItemWheel(v: unknown): v is WheelItem[] {
  return Array.isArray(v) && v.length === WHEEL_SLOTS && v.every(isWheelItem) && new Set(v).size === v.length;
}

/**
 * Wheel slots whose item no longer exists — an action the settings dropped, a command ref no scanned
 * plugin provides — go back to distinct default pings that aren't already on the wheel. Returns the
 * wheel unchanged when every item is known.
 */
export function repairUnknownItems(wheel: readonly WheelItem[], isKnown: (id: WheelItem) => boolean): WheelItem[] {
  if (wheel.every(isKnown)) return [...wheel];
  const used = new Set(wheel.filter((id) => isKnown(id) && isPingId(id)));
  const replacement = (): PingId => {
    const ping = DEFAULT_WHEEL.find((p) => !used.has(p)) ?? DEFAULT_CLICK_PING;
    used.add(ping); // two gone items must not become the same ping: duplicates would void the wheel
    return ping;
  };
  return wheel.map((id) => (isKnown(id) ? id : replacement()));
}

/** Puts `id` in `slot`. If it is already elsewhere on the wheel, the two slots swap so nothing appears twice. */
export function placeOnSlot<T extends string>(wheel: readonly T[], id: T, slot: number): T[] {
  const from = wheel.indexOf(id);
  if (from >= 0) return swapSlots(wheel, from, slot);
  const next = [...wheel];
  next[slot] = id;
  return next;
}

export function swapSlots<T extends string>(wheel: readonly T[], a: number, b: number): T[] {
  const next = [...wheel];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Where a dragged or click-selected item in the wheel editor came from (a ping id, or an emote ref). */
export type WheelSource<T extends string> =
  | { from: 'pool'; id: T }
  | { from: 'slot'; id: T; slot: number }
  | { from: 'center'; id: T };
/** A wheel slot index, or the centre (the trigger + click item). */
export type WheelTarget = number | 'center';
export type WheelPatch<T extends string> = { wheel?: T[]; center?: T };

/** The change for dropping `src` on `target`, or null when nothing changes. */
export function dropPatch<T extends string>(wheel: readonly T[], center: T, src: WheelSource<T>, target: WheelTarget): WheelPatch<T> | null {
  if (target === 'center') return src.id === center ? null : { center: src.id };
  if (src.from === 'slot') return src.slot === target ? null : { wheel: swapSlots(wheel, src.slot, target) };
  return wheel[target] === src.id ? null : { wheel: placeOnSlot(wheel, src.id, target) };
}
