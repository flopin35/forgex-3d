import { useEffect, useRef, useState } from 'react';
import type { ActiveDrawing } from '../app/drawing';
import { useActions } from '../app/EditorContext';
import { ALIGN_EDGES, lineAngleFromAnchor, lineLength, type AlignEdge } from '../core/sketch/edit';
import { Icon, type IconName } from '../ui/icons';
import { NumberField } from '../ui/NumberField';

const ALIGN_INFO: Record<AlignEdge, { label: string; icon: IconName }> = {
  left: { label: 'Left edges', icon: 'alignLeft' },
  centre: { label: 'Vertical centre', icon: 'alignCentre' },
  right: { label: 'Right edges', icon: 'alignRight' },
  top: { label: 'Top edges', icon: 'alignTop' },
  middle: { label: 'Horizontal centre', icon: 'alignMiddle' },
  bottom: { label: 'Bottom edges', icon: 'alignBottom' },
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Appears at the foot of the board when dots or lines are picked: exact sizes for one
 * line or one dot, and group edits (turn, flip, align, scale, copy) for several.
 */
export function SelectionBar({ drawing, points, lines, locked }: { drawing: ActiveDrawing; points: readonly string[]; lines: readonly string[]; locked: boolean }) {
  const actions = useActions();
  const [alignOpen, setAlignOpen] = useState(false);
  const alignRef = useRef<HTMLDivElement>(null);
  const sketch = drawing.sketch;
  const ids = actions.pickedPointIds(drawing);

  useEffect(() => {
    if (!alignOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!alignRef.current?.contains(event.target as Node)) setAlignOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [alignOpen]);

  if (ids.length === 0) return null;
  const line = lines.length === 1 && sketch.lines[lines[0]] && points.every((id) => id === sketch.lines[lines[0]].a || id === sketch.lines[lines[0]].b) ? sketch.lines[lines[0]] : null;
  const dot = !line && ids.length === 1 ? sketch.points[ids[0]] : null;
  const allSmooth = ids.every((id) => sketch.points[id]?.smooth);

  return (
    <div className="selection-bar" role="toolbar" aria-label="Picked dots">
      <span className="selection-count">{line ? 'Line' : dot ? 'Dot' : plural(ids.length, 'dot')}</span>
      <fieldset className="selection-tools" disabled={locked}>
        {line && (
          <>
            <NumberField label="Length" value={lineLength(sketch, line.id)} dragStep={0.01} decimals={3} onCommit={(length) => length > 0 && void actions.setLineSize(line.id, { length })} />
            <span className="unit-note">m</span>
            <NumberField label="Angle" value={lineAngleFromAnchor(sketch, line.id)} dragStep={0.5} decimals={1} onCommit={(angle) => void actions.setLineSize(line.id, { angle })} />
            <span className="unit-note">°</span>
          </>
        )}
        {dot && (
          <>
            <NumberField label="X" axis="x" value={dot.x} dragStep={0.01} decimals={3} onCommit={(x) => void actions.movePickedTo(x, dot.y)} />
            <NumberField label="Y" axis="y" value={dot.y} dragStep={0.01} decimals={3} onCommit={(y) => void actions.movePickedTo(dot.x, y)} />
            <span className="unit-note">m</span>
          </>
        )}
        {ids.length > 1 && (
          <>
            <span className="bar-divider" aria-hidden="true" />
            <button type="button" className="icon-button" onClick={() => actions.rotatePicked(90)} title="Turn 90° left">
              <Icon name="rotateLeft" />
            </button>
            <button type="button" className="icon-button" onClick={() => actions.rotatePicked(-90)} title="Turn 90° right">
              <Icon name="rotateRight" />
            </button>
            <NumberField label="Turn" value={0} dragStep={1} decimals={1} onCommit={(degrees) => degrees !== 0 && void actions.rotatePicked(degrees)} />
            <button type="button" className="icon-button" onClick={() => actions.flipPicked('horizontal')} title="Flip left to right">
              <Icon name="flipH" />
            </button>
            <button type="button" className="icon-button" onClick={() => actions.flipPicked('vertical')} title="Flip upside down">
              <Icon name="flipV" />
            </button>
            <div className="align-menu" ref={alignRef}>
              <button type="button" className={`icon-button ${alignOpen ? 'is-active' : ''}`} aria-expanded={alignOpen} onClick={() => setAlignOpen(!alignOpen)} title="Align and space">
                <Icon name="alignLeft" />
              </button>
              {alignOpen && (
                <div className="align-popover" role="menu">
                  <div className="align-grid">
                    {ALIGN_EDGES.map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        role="menuitem"
                        className="icon-button"
                        title={`Align on ${ALIGN_INFO[edge].label.toLowerCase()}`}
                        onClick={() => {
                          actions.alignPicked(edge);
                          setAlignOpen(false);
                        }}
                      >
                        <Icon name={ALIGN_INFO[edge].icon} />
                      </button>
                    ))}
                  </div>
                  <button type="button" role="menuitem" className="menu-item" disabled={ids.length < 3} onClick={() => (actions.distributePicked('horizontal'), setAlignOpen(false))}>
                    <Icon name="distributeH" size={15} /> Space evenly across
                  </button>
                  <button type="button" role="menuitem" className="menu-item" disabled={ids.length < 3} onClick={() => (actions.distributePicked('vertical'), setAlignOpen(false))}>
                    <Icon name="distributeV" size={15} /> Space evenly up and down
                  </button>
                </div>
              )}
            </div>
            <NumberField label="Scale %" value={100} dragStep={1} decimals={1} onCommit={(percent) => percent > 0 && percent !== 100 && void actions.scalePicked(percent / 100)} />
          </>
        )}
        <span className="bar-divider" aria-hidden="true" />
        <button type="button" className={`icon-button ${allSmooth ? 'is-active' : ''}`} onClick={() => actions.toggleSmoothPicked()} title={allSmooth ? 'Make sharp corners (S)' : 'Make smooth curves (S)'}>
          <Icon name="smooth" />
        </button>
        <button type="button" className="icon-button" onClick={() => actions.duplicatePicked()} title="Duplicate (Ctrl+D)">
          <Icon name="duplicate" />
        </button>
        <button type="button" className="icon-button is-danger" onClick={() => actions.deleteBoardSelection()} title="Delete (Delete)">
          <Icon name="trash" />
        </button>
      </fieldset>
    </div>
  );
}
