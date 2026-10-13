import { SHORTCUTS } from '../app/useShortcuts';
import { uiStore } from '../app/uiState';
import { Icon } from './icons';

export function ShortcutsSheet() {
  const close = () => uiStore.set({ shortcutsOpen: false });
  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="sheet shortcuts-sheet" role="dialog" aria-label="Keyboard shortcuts">
        <header className="sheet-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="shortcut-columns">
          {SHORTCUTS.map((group) => (
            <section key={group.group}>
              <h3>{group.group}</h3>
              <dl>
                {group.items.map(([keys, action]) => (
                  <div key={keys + action}>
                    <dt>{keys}</dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
