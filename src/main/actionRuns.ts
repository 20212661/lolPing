/** The id of a wheel item that runs: a v2 action id or a scanned command ref. */
type RunId = string;

interface ActionRun {
  id: RunId;
  displayId: number;
}

/** One run per action; only the newest invocation on a display may update its result bubble. */
export class ActionRuns {
  private readonly active = new Map<RunId, ActionRun>();
  private readonly latest = new Map<number, ActionRun>();

  start(id: RunId, displayId: number): ActionRun | null {
    if (this.active.has(id)) return null;
    const run = { id, displayId };
    this.active.set(id, run);
    this.latest.set(displayId, run);
    return run;
  }

  finish(run: ActionRun): boolean {
    if (this.active.get(run.id) !== run) return false;
    this.active.delete(run.id);
    if (this.latest.get(run.displayId) !== run) return false;
    this.latest.delete(run.displayId);
    return true;
  }
}
