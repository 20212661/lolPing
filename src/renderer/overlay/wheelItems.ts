import { actionIconUrl, isActionId, type ActionId, type WheelItem } from '../../shared/actionCatalog';
import { catalogEmote, customHash, customStillUrl, emoteIconUrl, type EmoteRef } from '../../shared/emotes';
import { pingById, textureUrl, type PingId } from '../../shared/pings';
import type { OverlaySettings } from '../../shared/settings';
import type { WheelItem as WheelSlot } from './wheel';

const UNKNOWN_ICON = textureUrl('generic_ping');

export const actionItem = (id: ActionId): WheelSlot => ({ key: id, icon: actionIconUrl(id) });

/** A wheel slot's icon: the bundled emote's, the imported emote's still, or the generic ping for one that isn't known. */
export function emoteItem(ref: EmoteRef, customEmotes: OverlaySettings['customEmotes']): WheelSlot {
  if (catalogEmote(ref)) return { key: ref, icon: emoteIconUrl(ref) };
  if (customEmotes.some((c) => c.id === ref)) return { key: ref, icon: customStillUrl(customHash(ref)) };
  return { key: ref, icon: UNKNOWN_ICON };
}

const pingIcon = (id: PingId): string => {
  const def = pingById(id);
  return def ? textureUrl(def.icon) : UNKNOWN_ICON;
};

/** What a ping-wheel slot holds: a ping's icon, or an action's. */
export function wheelItemFor(id: WheelItem): WheelSlot {
  return isActionId(id) ? actionItem(id) : { key: id, icon: pingIcon(id) };
}

/** The whole ping wheel: one item per slot, pings and actions in their configured places. */
export const wheelItemsFor = (wheel: readonly WheelItem[]): WheelSlot[] => wheel.map(wheelItemFor);

/** What each wheel's centre shows: what trigger + click would place. */
export function centerIcons(s: Pick<OverlaySettings, 'clickPingId' | 'clickEmoteId' | 'customEmotes'>): { ping: string; emote: string } {
  return { ping: pingIcon(s.clickPingId), emote: emoteItem(s.clickEmoteId, s.customEmotes).icon };
}
