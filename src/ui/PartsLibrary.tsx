import { useMemo, useState } from 'react';
import { useActions } from '../app/EditorContext';
import { PARTS, type PartDefinition } from '../core/scene/parts';
import { Icon, type IconName } from './icons';

const PART_ICONS: Record<PartDefinition['id'], IconName> = {
  cube: 'cube',
  plane: 'plane',
  sphere: 'sphere',
  cylinder: 'cylinder',
  group: 'group',
};

const CATEGORIES: PartDefinition['category'][] = ['Point-built', 'Parametric', 'Structure'];

export function PartsLibrary() {
  const actions = useActions();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? PARTS.filter((p) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)) : PARTS;
  }, [query]);

  return (
    <aside className="panel library" aria-label="Parts library">
      <div className="panel-header">
        <h2>Parts</h2>
        <span className="panel-count">{PARTS.length}</span>
      </div>
      <label className="search">
        <Icon name="search" size={14} />
        <span className="visually-hidden">Search parts</span>
        <input type="search" placeholder="Search parts" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="panel-scroll">
        {CATEGORIES.map((category) => {
          const parts = matches.filter((p) => p.category === category);
          if (parts.length === 0) return null;
          return (
            <section key={category} className="library-section">
              <h3>{category}</h3>
              {parts.map((part) => (
                <button key={part.id} type="button" className="part" onClick={() => actions.addPart(part.id)} title={`Add ${part.name}`}>
                  <span className={`part-tile part-tile--${part.id}`}>
                    <Icon name={PART_ICONS[part.id]} size={20} />
                  </span>
                  <span className="part-text">
                    <span className="part-name">{part.name}</span>
                    <span className="part-description">{part.description}</span>
                  </span>
                </button>
              ))}
            </section>
          );
        })}
        {matches.length === 0 && <p className="empty-note">No parts match “{query}”.</p>}
        <p className="library-note">Connectors, components and your own saved parts come with the component system in Phase 4.</p>
      </div>
    </aside>
  );
}
