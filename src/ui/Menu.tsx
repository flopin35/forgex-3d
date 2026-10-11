import { useEffect, useRef, useState } from 'react';

export type MenuEntry =
  | { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean }
  | { separator: true };

/** A small menu-bar dropdown. Closes on selection, outside click or Escape. */
export function Menu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className={`menu-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {entries.map((entry, i) =>
            'separator' in entry ? (
              <div key={`sep-${i}`} className="menu-separator" role="separator" />
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={entry.disabled}
                onClick={() => {
                  setOpen(false);
                  entry.onSelect();
                }}
              >
                <span>{entry.label}</span>
                {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
