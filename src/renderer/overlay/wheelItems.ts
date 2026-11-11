import { actionIconUrl, isActionId, isCommandRef, type ActionId, type WheelItem } from '../../shared/actionCatalog';
import { fallbackTileUrl } from '../../shared/commandTiles';
import { catalogEmote, customHash, customStillUrl, emoteIconUrl, type EmoteRef } from '../../shared/emotes';
import { pingById, textureUrl, type PingId } from '../../shared/pings';
import type { OverlaySettings } from '../../shared/settings';
import type { WheelItem as WheelSlot } from './wheel';

const UNKNOWN_ICON = textureUrl('generic_ping');

export const actionItem = (id: ActionId): WheelSlot => ({ key: id, icon: actionIconUrl(id) });

/** A scanned plugin's command slice: the icon the scan resolved for it, or the fallback plug. */
export const commandItem = (ref: string, commands: OverlaySettings['commands']): WheelSlot =>
  ({ key: ref, icon: commands[ref] ?? fallbackTileUrl(undefined) });

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

/** What a ping-wheel slot holds: a ping's icon, an action's, or a scanned command's. */
export function wheelItemFor(id: WheelItem, commands: OverlaySettings['commands']): WheelSlot {
  if (isActionId(id)) return actionItem(id);
  if (isCommandRef(id)) return commandItem(id, commands);
  return { key: id, icon: pingIcon(id) };
}

/** The whole ping wheel: one item per slot, pings, actions and commands in their configured places. */
export const wheelItemsFor = (wheel: readonly WheelItem[], commands: OverlaySettings['commands']): WheelSlot[] =>
  wheel.map((id) => wheelItemFor(id, commands));

/** What each wheel's centre shows: what trigger + click would place. */
export function centerIcons(s: Pick<OverlaySettings, 'clickPingId' | 'clickEmoteId' | 'customEmotes'>): { ping: string; emote: string } {
  return { ping: pingIcon(s.clickPingId), emote: emoteItem(s.clickEmoteId, s.customEmotes).icon };
}
