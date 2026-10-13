import { useState } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { Icon } from './icons';

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Saved versions of the scene, kept in the project file. Restoring one can be undone. */
export function VersionsPanel() {
  const actions = useActions();
  const snapshots = useEditor((s) => s.snapshots);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const save = () => {
    actions.saveSnapshot(name.trim() || undefined);
    setName('');
  };

  return (
    <section className="versions-panel" aria-label="Versions">
      <form
        className="panel-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="filter-field">
          <Icon name="versions" size={14} />
          <span className="visually-hidden">Version name</span>
          <input value={name} placeholder="Name this version (optional)" maxLength={120} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="text-button is-primary">
          Save version
        </button>
      </form>
      <p className="panel-lead">A version is a copy of the whole scene, saved inside the project. Take one before a big change; restoring it can be undone.</p>
      {snapshots.length === 0 ? (
        <div className="empty-card">
          <Icon name="versions" size={26} />
          <p>No versions yet.</p>
        </div>
      ) : (
        <ol className="version-list">
          {[...snapshots].reverse().map((snapshot) => (
            <li key={snapshot.id} className="version-item">
              <span className="version-mark" aria-hidden="true" />
              <div className="version-meta">
                {editing === snapshot.id ? (
                  <input
                    className="tree-rename"
                    defaultValue={snapshot.name}
                    autoFocus
                    maxLength={120}
                    onBlur={(event) => {
                      actions.renameSnapshot(snapshot.id, event.currentTarget.value);
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="version-name" onDoubleClick={() => setEditing(snapshot.id)} title="Double-click to rename">
                    {snapshot.name}
                  </button>
                )}
                <span className="version-detail">
                  {when(snapshot.createdAt)} · {Object.keys(snapshot.scene.objects).length} parts
                </span>
              </div>
              <button type="button" className="text-button" onClick={() => actions.restoreSnapshot(snapshot.id)}>
                Restore
              </button>
              <button type="button" className="icon-button is-small" aria-label={`Delete ${snapshot.name}`} title="Delete this version" onClick={() => void actions.deleteSnapshot(snapshot.id)}>
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
