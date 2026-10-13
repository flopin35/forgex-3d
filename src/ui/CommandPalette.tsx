import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCommands, matchScore, type AppCommand } from '../app/commands';
import { useActions } from '../app/EditorContext';
import { recentProjects } from '../app/recentProjects';
import { uiStore } from '../app/uiState';
import type { LibraryEntry } from '../core/library/libraryPart';
import { fileNameFromPath } from '../core/project/paths';
import { Icon } from './icons';

const MAX_RESULTS = 60;

/** Quick search (Ctrl+K): type a few letters to run any command, jump to any part, or add a saved part. */
export function CommandPalette() {
  const actions = useActions();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let live = true;
    actions.files.library.list().then(
      (entries) => live && setLibrary(entries),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [actions]);

  const commands = useMemo<AppCommand[]>(() => {
    const list = buildCommands(actions);
    for (const entry of library) {
      list.push({ id: `lib-${entry.file}`, title: `Add ${entry.name} from My Parts`, group: 'My Parts', keywords: `library saved ${entry.description}`, run: () => void actions.addFromLibrary(entry.file) });
    }
    if (actions.files.kind === 'desktop') {
      for (const path of recentProjects()) {
        list.push({ id: `recent-${path}`, title: `Open ${fileNameFromPath(path)}`, group: 'Recent', keywords: path, run: () => void actions.openProjectAt(path).catch((error) => actions.store.log('error', `${fileNameFromPath(path)} could not be opened.`, String(error))) });
      }
    }
    return list;
  }, [actions, library]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // With nothing typed, show the everyday commands rather than every object.
      return commands.filter((c) => !c.id.startsWith('obj-') && !c.id.startsWith('view-') && !c.id.startsWith('align-')).slice(0, MAX_RESULTS);
    }
    return commands
      .map((command) => ({ command, score: Math.max(matchScore(query, command.title) * 1.2, matchScore(query, `${command.title} ${command.keywords ?? ''} ${command.group}`)) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((item) => item.command);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => uiStore.set({ paletteOpen: false });
  const run = (command: AppCommand | undefined) => {
    if (!command) return;
    close();
    // Let the palette close first, so dialogs the command opens get the focus.
    window.setTimeout(command.run, 0);
  };

  return (
    <div className="scrim is-top" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Quick search">
        <label className="palette-input">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search</span>
          <input
            autoFocus
            value={query}
            placeholder="Type a command, a part name or a tool…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(results[active]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" ref={listRef} role="listbox">
          {results.map((command, i) => (
            <li key={command.id} role="option" aria-selected={i === active}>
              <button type="button" className={`palette-item ${i === active ? 'is-active' : ''}`} onPointerMove={() => setActive(i)} onClick={() => run(command)}>
                <span className="palette-title">{command.title}</span>
                <span className="palette-group">{command.group}</span>
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">Nothing matches “{query}”. Try a shorter word, like “mirror”, “wheel” or “export”.</li>}
        </ul>
      </div>
    </div>
  );
}
