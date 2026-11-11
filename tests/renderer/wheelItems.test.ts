import { describe, expect, it } from 'vitest';
import { centerIcons, emoteItem, wheelItemFor, wheelItemsFor } from '../../src/renderer/overlay/wheelItems';
import { actionIconUrl } from '../../src/shared/actionCatalog';
import { customStillUrl, emoteIconUrl } from '../../src/shared/emotes';
import { textureUrl } from '../../src/shared/pings';

const HASH = 'a'.repeat(32);
const custom = [{ id: `c:${HASH}`, name: 'Mine', animated: false }];

describe('wheelItems', () => {
  it('shows the chosen click emote and click ping in the centres, not the first defaults', () => {
    expect(centerIcons({ clickPingId: 'push', clickEmoteId: 'poro_snax', customEmotes: [] }))
      .toEqual({ ping: textureUrl('push'), emote: emoteIconUrl('poro_snax') });
  });

  it("shows an imported click emote's still in the centre", () => {
    expect(centerIcons({ clickPingId: 'push', clickEmoteId: `c:${HASH}`, customEmotes: custom }).emote).toBe(customStillUrl(HASH));
  });

  it('falls back to the generic ping for an emote this app does not know', () => {
    expect(emoteItem(`c:${'b'.repeat(32)}`, custom).icon).toBe(textureUrl('generic_ping'));
  });
});

describe('wheel items with actions', () => {
  it('keeps a custom command id through the displayed wheel item', () => {
    expect(wheelItemFor('plugin:hello')).toEqual({ key: 'plugin:hello', icon: actionIconUrl('plugin:hello') });
  });
  it('gives an action slot its own icon and keeps its id as the key', () => {
    expect(wheelItemFor('ai-explain')).toEqual({ key: 'ai-explain', icon: actionIconUrl('ai-explain') });
  });

  it('builds the wheel with pings and actions in their configured slots', () => {
    const items = wheelItemsFor(['danger', 'open-app', 'push', 'omw', 'allin', 'assist', 'needvision', 'missing']);
    expect(items[0]).toEqual({ key: 'danger', icon: textureUrl('pingwheel_retreatrender') });
    expect(items[1]).toEqual({ key: 'open-app', icon: actionIconUrl('open-app') });
    expect(items[7]).toEqual({ key: 'missing', icon: textureUrl('enemy_missing') });
  });
});
