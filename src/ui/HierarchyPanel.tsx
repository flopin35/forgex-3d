import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import { flattenTree, type DropPosition } from '../core/scene/scene';
import type { SceneObject } from '../core/scene/types';
import { Icon, type IconName } from './icons';

function iconFor(object: SceneObject): IconName {
  if (object.kind === 'group') return 'group';
  if (object.source.type === 'primitive') return object.source.primitive;
  if (object.source.type === 'sketch') return 'blueprint';
  if (object.source.type === 'body') return 'car';
  return Object.keys(object.source.graph.faces).length === 1 ? 'plane' : 'cube';
}

function dropZone(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside';
}

const DRAG_TYPE = 'application/x-forgex-object';

export function HierarchyPanel() {
  const actions = useActions();
  const scene = useEditor((s) => s.scene);
  const selectedId = useEditor((s) => s.selectedId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const cancelRename = useRef(false);
  const [dropTarget, setDropTarget] = useState<{ id: string | null; position: DropPosition } | null>(null);

  const rows = useMemo(() => flattenTree(scene, collapsed), [scene, collapsed]);
  const total = Object.keys(scene.objects).length;

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedId = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(null);
    if (!draggedId || draggedId === targetId) return;
    actions.moveInHierarchy(draggedId, targetId, targetId === null ? 'after' : dropZone(event));
    if (targetId && dropZone(event) === 'inside') {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(targetId);
        return next;
      });
    }
  };

  return (
    <section className="panel hierarchy" aria-label="Scene hierarchy">
      <div className="panel-header">
        <h2>Scene</h2>
        <span className="panel-count">{total}</span>
      </div>
      <div
        className={`tree ${dropTarget?.id === null ? 'is-root-drop' : ''}`}
        role="tree"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          setDropTarget({ id: null, position: 'after' });
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDropTarget(null);
        }}
        onDrop={(event) => onDrop(event, null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) actions.select(null);
        }}
      >
        {rows.map(({ id, depth }) => {
          const object = scene.objects[id];
          const hasChildren = object.childIds.length > 0;
          const isOpen = !collapsed.has(id);
          const drop = dropTarget?.id === id ? dropTarget.position : null;
          return (
            <div
              key={id}
              role="treeitem"
              aria-selected={id === selectedId}
              aria-expanded={hasChildren ? isOpen : undefined}
              className={[
                'tree-row',
                id === selectedId ? 'is-selected' : '',
                object.visible ? '' : 'is-hidden',
                drop ? `drop-${drop}` : '',
              ].join(' ')}
              style={{ paddingLeft: 8 + depth * 16 }}
              draggable={renaming !== id}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                event.stopPropagation();
                const position = dropZone(event);
                if (dropTarget?.id !== id || dropTarget.position !== position) setDropTarget({ id, position });
              }}
              onDrop={(event) => onDrop(event, id)}
              onDragEnd={() => setDropTarget(null)}
              onClick={() => actions.select(id)}
              onDoubleClick={() => setRenaming(id)}
            >
              <button
                type="button"
                className="tree-toggle"
                tabIndex={-1}
                aria-label={isOpen ? 'Collapse' : 'Expand'}
                style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(id);
                }}
              >
                <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
              </button>
              <Icon name={iconFor(object)} size={14} className="tree-icon" />
              {renaming === id ? (
                <input
                  className="tree-rename"
                  defaultValue={object.name}
                  autoFocus
                  onFocus={(event) => {
                    cancelRename.current = false;
                    event.currentTarget.select();
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    if (!cancelRename.current) actions.rename(id, event.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      cancelRename.current = true;
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className="tree-name">{object.name}</span>
              )}
              <button
                type="button"
                className="tree-visibility"
                aria-label={object.visible ? `Hide ${object.name}` : `Show ${object.name}`}
                title={object.visible ? 'Hide' : 'Show'}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.setVisibility(id, !object.visible);
                }}
              >
                <Icon name={object.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="empty-note">No objects yet.</p>}
      </div>
      <p className="panel-hint">Drag to reorder or nest. Double-click to rename.</p>
    </section>
  );
}
