/**
 * Coalesces a plugin's streaming result updates to about 30 fps: appends land in a buffer, one flush
 * per frame window goes out, and a set replaces the buffer immediately. Pure bookkeeping with injected
 * time and flush, so the timing is testable.
 */

export class ResultCoalescer {
  private text = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flushMs: number,
    private readonly emit: (text: string) => void,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly cancel: (t: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {}

  /** The accumulated text so far (what a done bubble would show). */
  get current(): string {
    return this.text;
  }

  set(text: string): void {
    this.text = text.slice(0, 4000);
    this.flushNow();
  }

  append(chunk: string): void {
    this.text = (this.text + chunk).slice(0, 4000);
    if (this.timer === null) {
      this.timer = this.schedule(() => {
        this.timer = null;
        this.emit(this.text);
      }, this.flushMs);
    }
  }

  /** Sends whatever is buffered and stops the timer; the final state after a stream ends. */
  flushNow(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.emit(this.text);
  }
}
