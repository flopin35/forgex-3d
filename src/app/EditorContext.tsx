import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { EditorState } from '../core/editor/editorStore';
import type { EditorActions } from './editorActions';

const ActionsContext = createContext<EditorActions | null>(null);

export function EditorProvider({ actions, children }: { actions: EditorActions; children: ReactNode }) {
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

export function useActions(): EditorActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useActions must be used inside EditorProvider');
  return actions;
}

/**
 * Subscribes a component to part of the editor state. The selector must return
 * an existing value from the state (or a primitive), not a newly built object.
 */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  const { store } = useActions();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
