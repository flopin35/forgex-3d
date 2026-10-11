/**
 * Viewport timings for the performance budgets (blueprint section 6).
 * Kept outside the editor store so per-frame updates never re-render the panels.
 */
export interface PerfSnapshot {
  /** CPU time of the last frame's render calls, in milliseconds. */
  renderMs: number;
  /** Time of the last construction-mesh rebuild, in milliseconds. */
  rebuildMs: number;
  triangles: number;
}

type Listener = () => void;

class PerfStats {
  private snapshot: PerfSnapshot = { renderMs: 0, rebuildMs: 0, triangles: 0 };
  private pending: PerfSnapshot = { ...this.snapshot };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  getSnapshot = (): PerfSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  report(patch: Partial<PerfSnapshot>): void {
    this.pending = { ...this.pending, ...patch };
    if (this.timer !== null) return;
    // Publish at most four times a second.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.snapshot = this.pending;
      this.listeners.forEach((listener) => listener());
    }, 250);
  }
}

export const perfStats = new PerfStats();
