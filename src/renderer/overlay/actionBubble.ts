import type { OverlayEvents } from '../../shared/ipc';

export type ActionBubbleView = OverlayEvents['action:bubble'];

/** How long a finished bubble stays; 'running' stays until its answer replaces it. */
export const BUBBLE_MS = 8000;
/** Kept off the screen edges. */
const MARGIN = 12;
/** Wide enough for an answer's line, narrow enough to sit beside the cursor's work. */
const BUBBLE_W = 320;

/**
 * Where a bubble goes: below-right of its point, flipped and clamped back inside the viewport. Pure placement, so it
 * can be tested without a screen.
 */
export function placeBubble(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  w = BUBBLE_W,
  h: number,
): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, viewW - w - MARGIN);
  let left = x + 20;
  if (left > maxLeft) left = x - 20 - w; // flip to the left of the point
  left = Math.min(maxLeft, Math.max(MARGIN, left));
  let top = y + 16;
  if (top + h > viewH - MARGIN) top = y - 16 - h; // flip above the point
  return { left, top: Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewH - h - MARGIN)) };
}

/**
 * Shows an action's bubble at the cursor: the newest replaces any bubble still on screen (each action answers its own
 * release, and a 'running' bubble is only ever replaced by its own answer). A 'running' update on the running bubble
 * in place — that is how a streaming result grows without restarting the animation.
 */
export function showBubble(layer: HTMLElement, view: ActionBubbleView): void {
  if (view.state === 'running') {
    // These selectors only ever match the div/span showBubble itself builds, so the casts are sound.
    const found = layer.querySelectorAll('.actionBubble.running')[0] as HTMLElement | undefined;
    if (found) {
      if (view.body !== undefined && view.body !== '') {
        let body = found.querySelectorAll('.actionBubbleBody')[0] as HTMLElement | undefined;
        if (!body) {
          body = document.createElement('span');
          body.className = 'actionBubbleBody';
          found.append(body);
        }
        body.textContent = view.body;
      }
      const place = placeBubble(view.x, view.y, window.innerWidth, window.innerHeight, found.offsetWidth, found.offsetHeight);
      found.style.left = `${place.left}px`;
      found.style.top = `${place.top}px`;
      return;
    }
  }
  for (const old of layer.querySelectorAll('.actionBubble')) old.remove();
  const card = document.createElement('div');
  card.className = `actionBubble ${view.state}`;
  const title = document.createElement('b');
  title.textContent = view.title;
  card.append(title);
  if (view.body !== undefined && view.body !== '') {
    const body = document.createElement('span');
    body.className = 'actionBubbleBody';
    body.textContent = view.body;
    card.append(body);
  }
  layer.append(card);
  const place = placeBubble(view.x, view.y, window.innerWidth, window.innerHeight, card.offsetWidth, card.offsetHeight);
  card.style.left = `${place.left}px`;
  card.style.top = `${place.top}px`;
  if (view.state !== 'running') {
    setTimeout(() => {
      card.classList.add('out');
      setTimeout(() => card.remove(), 300);
    }, BUBBLE_MS);
  }
}
