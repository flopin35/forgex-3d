import { useEffect, useState, useSyncExternalStore } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { uiStore } from '../app/uiState';
import type { LibraryEntry } from '../core/library/libraryPart';
import { Icon } from './icons';

/**
 * My Parts: reusable parts shared by every project (and by AI assistants through the MCP
 * server). Click a part to add a copy; save the selected object to keep it here.
 */
export function LibraryPanel() {
  const actions = useActions();
  const revision = useSyncExternalStore(uiStore.subscribe, () => uiStore.getState().libraryRevision);
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const desktop = actions.files.kind === 'desktop';

  useEffect(() => {
    let live = true;
    actions.files.library.list().then(
      (list) => live && (setEntries(list), setError(null)),
      (reason) => live && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      live = false;
    };
  }, [actions, revision]);

  const query = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter((entry) => !query || `${entry.name} ${entry.description}`.toLowerCase().includes(query));

  return (
    <section className="library-panel" aria-label="My Parts">
      <div className="panel-toolbar">
        <label className="filter-field">
          <Icon name="search" size={14} />
          <span className="visually-hidden">Find a saved part</span>
          <input value={filter} placeholder="Find a saved part" onChange={(event) => setFilter(event.target.value)} />
        </label>
        <button type="button" className="text-button is-primary" onClick={() => void actions.saveToLibrary()} disabled={!selected} title={selected ? `Save ${selected.name} here` : 'Select an object first'}>
          <Icon name="plus" size={14} /> Save selected
        </button>
      </div>
      <p className="panel-lead">
        Parts kept here work in every project, and AI assistants can use them too. {desktop ? 'They live in' : 'In the browser preview they are kept in'}{' '}
        {desktop ? (
          <button type="button" className="link-button" onClick={() => void actions.revealLibrary()}>
            {actions.files.library.location()}
          </button>
        ) : (
          'this browser'
        )}
        .
      </p>
      {error && <p className="panel-error">{error}</p>}
      {entries && entries.length === 0 && !error && (
        <div className="empty-card">
          <Icon name="library" size={26} />
          <p>No parts saved yet.</p>
          <p className="muted">Select a wheel, a door or a whole car, then press Save selected.</p>
        </div>
      )}
      <ul className="library-grid">
        {shown.map((entry) => (
          <li key={entry.file} className="library-item">
            <button type="button" className="library-thumb" onClick={() => void actions.addFromLibrary(entry.file)} title={`Add ${entry.name} to this project`}>
              {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <Icon name="cube" size={28} />}
            </button>
            <div className="library-meta">
              <span className="library-name">{entry.name}</span>
              <span className="library-detail">{entry.description || `${entry.objectCount} ${entry.objectCount === 1 ? 'object' : 'objects'}`}</span>
            </div>
            <button type="button" className="icon-button is-small" aria-label={`Delete ${entry.name} from My Parts`} title="Delete from My Parts" onClick={() => void actions.removeFromLibrary(entry.file, entry.name)}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
