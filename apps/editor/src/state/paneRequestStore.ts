import { create } from 'zustand';
import type { DockPaneId } from '../layout/dockModel';

interface PaneRequestState {
  /** The latest request; the id changes on every call so repeated requests still fire. */
  request: { id: number; pane: DockPaneId } | null;
  /** Brings a pane into view, reopening it if it was closed. */
  reveal: (pane: DockPaneId) => void;
  /** Changes on every request to put the docked panes back where Studio first placed them. */
  resetRequest: number;
  resetLayout: () => void;
}

export const usePaneRequestStore = create<PaneRequestState>((set, get) => ({
  request: null,
  reveal: (pane) => set({ request: { id: (get().request?.id ?? 0) + 1, pane } }),
  resetRequest: 0,
  resetLayout: () => set({ resetRequest: get().resetRequest + 1 }),
}));
