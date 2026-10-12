import type { BodyView } from '../core/sketch/body';
import type { SketchPlane } from '../core/sketch/sketch';

/** Board tools. "curve" draws like "draw" but its dots are smooth. */
export type BoardTool = 'draw' | 'curve' | 'select' | 'rectangle' | 'circle';

export function isPenTool(tool: BoardTool): boolean {
  return tool === 'draw' || tool === 'curve';
}

export interface BoardState {
  tool: BoardTool;
  /** The dot the next line starts from while drawing, or null. */
  chainFrom: string | null;
  /** Selected dots and lines of the active blueprint (select tool). */
  selectedPoints: readonly string[];
  selectedLines: readonly string[];
  /** Plane for the next new blueprint when none is selected. */
  newPlane: SketchPlane;
  /** Sides used by the circle tool. */
  circleSides: number;
  /** Spin the 3D view slowly. */
  turntable: boolean;
  /** Show the Scene and Properties panels on the right. */
  sidebar: boolean;
  /** Share of the width taken by the board (the 3D view gets the rest). */
  split: number;
  /** Snap new and moved dots to the board grid. */
  snap: boolean;
  /** Board grid spacing in metres (separate from the 3D grid, drawings need finer steps). */
  snapSize: number;
  /** Which drawing of a body the board shows. */
  bodyView: BodyView;
  /** The reference picture being moved on the board, or null. */
  adjustingReference: string | null;
  /** Show the reference pictures panel. */
  referencesOpen: boolean;
}

/** Board snap steps; 0.28 m is one Roblox stud. */
export const BOARD_SNAP_SIZES: readonly { size: number; label: string }[] = [
  { size: 0.01, label: '1 cm' },
  { size: 0.025, label: '2.5 cm' },
  { size: 0.05, label: '5 cm' },
  { size: 0.1, label: '10 cm' },
  { size: 0.25, label: '25 cm' },
  { size: 0.28, label: '1 stud' },
  { size: 0.5, label: '50 cm' },
  { size: 1, label: '1 m' },
];

const PREFS_KEY = 'forgex.board.v1';
const PERSISTED = ['circleSides', 'sidebar', 'split', 'newPlane', 'snap', 'snapSize'] as const;

function loadPrefs(): Partial<BoardState> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Partial<BoardState>;
    const prefs: Partial<BoardState> = {};
    if (typeof data.circleSides === 'number' && data.circleSides >= 3 && data.circleSides <= 96) prefs.circleSides = Math.round(data.circleSides);
    if (typeof data.sidebar === 'boolean') prefs.sidebar = data.sidebar;
    if (typeof data.split === 'number' && data.split >= 0.2 && data.split <= 0.8) prefs.split = data.split;
    if (data.newPlane === 'front' || data.newPlane === 'side' || data.newPlane === 'top') prefs.newPlane = data.newPlane;
    if (typeof data.snap === 'boolean') prefs.snap = data.snap;
    if (BOARD_SNAP_SIZES.some((option) => option.size === data.snapSize)) prefs.snapSize = data.snapSize;
    return prefs;
  } catch {
    return {};
  }
}

/**
 * Board UI state, kept outside the editor store because it is not part of the project
 * and never needs undo. Components subscribe with useSyncExternalStore.
 */
class BoardStore {
  private state: BoardState = {
    tool: 'draw',
    chainFrom: null,
    selectedPoints: [],
    selectedLines: [],
    newPlane: 'front',
    circleSides: 24,
    turntable: false,
    sidebar: true,
    split: 0.5,
    snap: true,
    snapSize: 0.05,
    bodyView: 'side',
    adjustingReference: null,
    referencesOpen: false,
    ...(typeof window === 'undefined' ? {} : loadPrefs()),
  };
  private listeners = new Set<() => void>();

  getState = (): BoardState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<BoardState>): void {
    const changed = (Object.keys(patch) as (keyof BoardState)[]).some((key) => patch[key] !== this.state[key]);
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    if (PERSISTED.some((key) => key in patch)) this.savePrefs();
    this.listeners.forEach((listener) => listener());
  }

  setTool(tool: BoardTool): void {
    // Switching between the two pens keeps the line going.
    const keepChain = isPenTool(tool) && isPenTool(this.state.tool);
    this.set({
      tool,
      chainFrom: keepChain ? this.state.chainFrom : null,
      selectedPoints: tool === 'select' ? this.state.selectedPoints : [],
      selectedLines: tool === 'select' ? this.state.selectedLines : [],
      adjustingReference: null,
    });
  }

  clearSelection(): void {
    if (this.state.selectedPoints.length || this.state.selectedLines.length || this.state.chainFrom) {
      this.set({ selectedPoints: [], selectedLines: [], chainFrom: null });
    }
  }

  get hasSelection(): boolean {
    return this.state.selectedPoints.length > 0 || this.state.selectedLines.length > 0;
  }

  private savePrefs(): void {
    try {
      const prefs = Object.fromEntries(PERSISTED.map((key) => [key, this.state[key]]));
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Preferences are a convenience; the app works without storage.
    }
  }
}

export const boardStore = new BoardStore();
