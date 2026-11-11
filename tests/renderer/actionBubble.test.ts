import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUBBLE_MS, placeBubble, showBubble } from '../../src/renderer/overlay/actionBubble';

/** The DOM the bubble builds itself with, without a browser. */
class FakeNode {
  className = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  offsetWidth = 320;
  offsetHeight = 90;
  parent: FakeLayer | FakeNode | null = null;
  children: FakeNode[] = [];
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  append(...nodes: FakeNode[]): void {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  remove(): void {
    const p = this.parent;
    if (p instanceof FakeLayer) p.nodes = p.nodes.filter((n) => n !== this);
    else if (p) p.children = p.children.filter((n) => n !== this);
  }
}

class FakeLayer {
  nodes: FakeNode[] = [];
  append(node: FakeNode): void {
    node.parent = this;
    this.nodes.push(node);
  }
  querySelectorAll(selector: string): FakeNode[] {
    return this.nodes.filter((n) => n.className.split(' ').includes(selector.slice(1)));
  }
}

const VIEW = { w: 1920, h: 1080 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new FakeNode() });
  vi.stubGlobal('window', { innerWidth: VIEW.w, innerHeight: VIEW.h });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('placeBubble', () => {
  it('sits below-right of the point', () => {
    expect(placeBubble(400, 300, VIEW.w, VIEW.h, 320, 90)).toEqual({ left: 420, top: 316 });
  });

  it('flips to the left of a point near the right edge', () => {
    expect(placeBubble(1880, 300, VIEW.w, VIEW.h, 320, 90).left).toBe(1880 - 20 - 320);
  });

  it('flips above a point near the bottom, and stays off every edge', () => {
    expect(placeBubble(400, 1060, VIEW.w, VIEW.h, 320, 90).top).toBe(1060 - 16 - 90);
    expect(placeBubble(1915, 1075, VIEW.w, VIEW.h, 320, 90)).toEqual({ left: 1915 - 20 - 320, top: 1075 - 16 - 90 });
    expect(placeBubble(100, 1075, VIEW.w, VIEW.h, 320, 90)).toEqual({ left: 120, top: 1075 - 16 - 90 });
    // on a viewport narrower than the bubble, the margin is all there is
    expect(placeBubble(150, 50, 200, 400, 320, 90)).toEqual({ left: 12, top: 66 });
  });
});

describe('showBubble', () => {
  it('shows the title and body with the state as its class', () => {
    const layer = new FakeLayer();
    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'done', title: 'Explain with AI', body: 'Because.' });
    const [card] = layer.nodes;
    expect(card.className).toBe('actionBubble done');
    expect(card.children[0].textContent).toBe('Explain with AI');
    expect(card.children[1].textContent).toBe('Because.');
  });

  it('skips the body element when there is no body', () => {
    const layer = new FakeLayer();
    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'error', title: 'Run script' });
    expect(layer.nodes[0].children).toHaveLength(1);
  });

  it('replaces the bubble still on screen', () => {
    const layer = new FakeLayer();
    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'running', title: 'Working' });
    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'done', title: 'Done', body: 'Yes' });
    expect(layer.nodes).toHaveLength(1);
    expect(layer.nodes[0].className).toBe('actionBubble done');
  });

  it('keeps a running bubble up, and fades a finished one out later', () => {
    const layer = new FakeLayer();
    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'running', title: 'Working' });
    vi.advanceTimersByTime(BUBBLE_MS * 2);
    expect(layer.nodes).toHaveLength(1);

    showBubble(layer as unknown as HTMLElement, { x: 100, y: 100, state: 'done', title: 'Done', body: 'Yes' });
    vi.advanceTimersByTime(BUBBLE_MS - 1);
    expect(layer.nodes[0].classes.has('out')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(layer.nodes[0].classes.has('out')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(layer.nodes).toHaveLength(0);
  });
});
