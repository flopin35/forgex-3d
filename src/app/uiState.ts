/**
 * Window-level UI state: which panels and pop-ups are open. Not part of the project and
 * never undone. Components subscribe with useSyncExternalStore.
 */

export type DrawerTab = 'parts' | 'properties' | 'library' | 'versions';
export const DRAWER_TABS: readonly DrawerTab[] = ['parts', 'properties', 'library', 'versions'];

export interface UiState {
  /** The side drawer over the 3D view: parts list, properties, My Parts and versions. */
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  /** Quick search (Ctrl+K). */
  paletteOpen: boolean;
  /** The activity pop-over: messages, history and performance. */
  activityOpen: boolean;
  /** The Connect AI panel. */
  connectOpen: boolean;
  /** The start screen shown when the app opens. */
  startOpen: boolean;
  /** The keyboard shortcuts sheet. */
  shortcutsOpen: boolean;
  /** Bumped when My Parts changes, so open lists reload. */
  libraryRevision: number;
  /** The newest message id seen in the activity pop-over; newer problems show a badge. */
  activitySeen: number;
}

const PREFS_KEY = 'forgex.ui.v1';

function loadPrefs(): Partial<UiState> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<UiState>;
    const prefs: Partial<UiState> = {};
    if (DRAWER_TABS.includes(raw.drawerTab as DrawerTab)) prefs.drawerTab = raw.drawerTab;
    return prefs;
  } catch {
    return {};
  }
}

class UiStore {
  private state: UiState = {
    drawerOpen: false,
    drawerTab: 'parts',
    paletteOpen: false,
    activityOpen: false,
    connectOpen: false,
    startOpen: false,
    shortcutsOpen: false,
    libraryRevision: 0,
    activitySeen: 0,
    ...(typeof window === 'undefined' ? {} : loadPrefs()),
  };
  private listeners = new Set<() => void>();

  getState = (): UiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<UiState>): void {
    const changed = (Object.keys(patch) as (keyof UiState)[]).some((key) => patch[key] !== this.state[key]);
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    if ('drawerTab' in patch) {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ drawerTab: this.state.drawerTab }));
      } catch {
        // A convenience only.
      }
    }
    this.listeners.forEach((listener) => listener());
  }

  /** Opens the drawer on a tab, or closes it when that tab is already showing. */
  toggleDrawer(tab?: DrawerTab): void {
    const target = tab ?? this.state.drawerTab;
    if (this.state.drawerOpen && this.state.drawerTab === target) this.set({ drawerOpen: false });
    else this.set({ drawerOpen: true, drawerTab: target });
  }

  /** Closes whichever pop-up is open. Returns false when none was. */
  closeTopmost(): boolean {
    const s = this.state;
    if (s.paletteOpen) return this.set({ paletteOpen: false }), true;
    if (s.shortcutsOpen) return this.set({ shortcutsOpen: false }), true;
    if (s.connectOpen) return this.set({ connectOpen: false }), true;
    if (s.activityOpen) return this.set({ activityOpen: false }), true;
    if (s.startOpen) return this.set({ startOpen: false }), true;
    return false;
  }

  libraryChanged(): void {
    this.set({ libraryRevision: this.state.libraryRevision + 1 });
  }
}

export const uiStore = new UiStore();
