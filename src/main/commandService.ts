import { Context, Service } from 'cordis';
import type { ActionResult } from '../shared/actionCatalog';

export interface ActionTrigger {
  displayId: number;
  x: number;
  y: number;
}

/** What a running action can reach: the clipboard text, and a signal that dies with the plugin that serves it. */
export interface ActionEnv {
  readClipboard(): Promise<string>;
  signal: AbortSignal;
  trigger?: ActionTrigger;
}

export type ActionHandler = (env: ActionEnv) => Promise<ActionResult>;

declare module 'cordis' {
  interface Context {
    commands: CommandService;
  }
}

/**
 * The registry action plugins register their handlers in: one handler per action id. Cordis owns the lifecycle —
 * the service lives on the host plugin's fiber, and a plugin that goes away takes its handler with it.
 */
export class CommandService extends Service {
  private readonly handlers = new Map<string, ActionHandler>();

  constructor(ctx: Context) {
    super(ctx, 'commands');
  }

  /** Registers a handler. The returned disposer removes it (only if still this handler's), for ctx.effect to call. */
  register(id: string, handler: ActionHandler): () => void {
    if (!id || this.handlers.has(id)) throw new Error(`duplicate or empty command: ${id}`);
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) this.handlers.delete(id);
    };
  }

  get(id: string): ActionHandler | undefined {
    return this.handlers.get(id);
  }

  /** The registered action ids, in registration order. */
  ids(): string[] {
    return [...this.handlers.keys()];
  }
}
