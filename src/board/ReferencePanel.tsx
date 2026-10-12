import { useRef, useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { useActions, useEditor } from '../app/EditorContext';
import type { SketchPlane } from '../core/sketch/sketch';
import { Icon } from '../ui/icons';
import { NumberField } from '../ui/NumberField';

const PLANE_NAMES: Record<SketchPlane, string> = { front: 'front', side: 'side', top: 'top' };

/** Pictures behind the board for tracing: add, line up, fade, flip, hide and remove. */
export function ReferencePanel({ plane }: { plane: SketchPlane }) {
  const actions = useActions();
  const references = useEditor((s) => s.references);
  const adjusting = useSyncExternalStore(boardStore.subscribe, () => boardStore.getState().adjustingReference);
  const fileRef = useRef<HTMLInputElement>(null);
  const here = references.filter((r) => r.plane === plane);

  return (
    <div className="reference-panel" role="dialog" aria-label="Reference pictures">
      <div className="reference-panel-header">
        <strong>Pictures for the {PLANE_NAMES[plane]} view</strong>
        <button type="button" className="icon-button" onClick={() => boardStore.set({ referencesOpen: false, adjustingReference: null })} title="Close">
          <Icon name="close" size={14} />
        </button>
      </div>
      <p className="reference-help">
        Trace over a blueprint picture: a car seen from the {PLANE_NAMES[plane]}, for example. Set its width to the real size, such as 4.6 m for a supercar.
      </p>
      <button type="button" className="text-button" onClick={() => fileRef.current?.click()}>
        <Icon name="plus" size={14} /> Add a picture…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void actions.addReference(file, plane);
        }}
      />
      {here.map((reference) => (
        <div key={reference.id} className={`reference-item ${adjusting === reference.id ? 'is-adjusting' : ''}`}>
          <div className="reference-row">
            <img src={reference.src} alt="" className="reference-thumb" />
            <span className="reference-name" title={reference.name}>
              {reference.name}
            </span>
            <button
              type="button"
              className={`icon-button ${reference.visible ? 'is-active' : ''}`}
              onClick={() => actions.updateReference(reference.id, { visible: !reference.visible })}
              title={reference.visible ? 'Hide' : 'Show'}
            >
              <Icon name={reference.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <button type="button" className="icon-button" onClick={() => actions.removeReference(reference.id)} title="Remove">
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="reference-row">
            <span className="reference-label">Width</span>
            <NumberField
              label="m"
              value={reference.width}
              dragStep={0.01}
              decimals={3}
              onCommit={(width) => width > 0 && actions.updateReference(reference.id, { width })}
              onScrub={(width) => width > 0 && actions.updateReference(reference.id, { width })}
              onScrubEnd={(width) => width > 0 && actions.updateReference(reference.id, { width })}
            />
            <span className="reference-label">Fade</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={reference.opacity}
              aria-label="Picture opacity"
              onChange={(event) => actions.updateReference(reference.id, { opacity: Number(event.target.value) })}
            />
          </div>
          <div className="reference-row">
            <button
              type="button"
              className={`text-button ${adjusting === reference.id ? 'is-active' : ''}`}
              onClick={() => boardStore.set({ adjustingReference: adjusting === reference.id ? null : reference.id })}
              title="Drag the picture on the board to line it up with the axes"
            >
              <Icon name="move" size={14} /> {adjusting === reference.id ? 'Done' : 'Move on board'}
            </button>
            <button
              type="button"
              className={`text-button ${reference.flip ? 'is-active' : ''}`}
              onClick={() => actions.updateReference(reference.id, { flip: !reference.flip })}
              title="Mirror the picture left to right (the side view expects the front on the left)"
            >
              <Icon name="mirror" size={14} /> Flip
            </button>
          </div>
        </div>
      ))}
      {here.length === 0 && <p className="reference-empty">No pictures on this view yet.</p>}
    </div>
  );
}
