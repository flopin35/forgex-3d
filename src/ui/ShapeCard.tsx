import { useMemo, useRef, useState } from 'react';
import { useActions, useEditor } from '../app/EditorContext';
import type { EditorState } from '../core/editor/editorStore';
import { analyzeGraph } from '../core/geometry/analysis';
import { BLUEPRINT_COLORS } from '../core/scene/parts';
import { isSketchMesh, type MeshObject, type MeshSource } from '../core/scene/types';
import { generateShape } from '../core/sketch/generate';
import { MAX_SEGMENTS, MIN_SEGMENTS, SHAPE_MODES, type ShapeMode, type ShapeSettings } from '../core/sketch/sketch';
import { Icon, type IconName } from './icons';
import { NumberField } from './NumberField';

type Blueprint = MeshObject & { source: Extract<MeshSource, { type: 'sketch' }> };

const MODE_INFO: Record<ShapeMode, { label: string; icon: IconName; title: string }> = {
  flat: { label: 'Flat', icon: 'shapeFlat', title: 'A flat panel: signs, decals, cards' },
  extrude: { label: 'Extrude', icon: 'shapeExtrude', title: 'Give the outline a thickness: swords, shields, walls' },
  revolve: { label: 'Revolve', icon: 'shapeRevolve', title: 'Spin the lines around the axis: wheels, bottles, vases' },
};

const SWATCHES = [...BLUEPRINT_COLORS, '#9fc3e8', '#d9dee5', '#3a4350'];

function selectBlueprint(state: EditorState): Blueprint | null {
  const object = state.selectedId ? state.scene.objects[state.selectedId] : undefined;
  return isSketchMesh(object) ? object : null;
}

/** The floating "Make it 3D" card over the 3D view: how the selected drawing becomes an object. */
export function ShapeCard() {
  const blueprint = useEditor(selectBlueprint);
  // Open by default on roomy screens; on small ones the Properties panel shows the same controls.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1440);
  if (!blueprint) return null;
  return (
    <aside className={`shape-card ${open ? '' : 'is-collapsed'}`} aria-label="Make it 3D">
      <button type="button" className="shape-card-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="shape-card-kicker">Make it 3D</span>
        <span className="shape-card-name">{blueprint.name}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && <ShapeControls key={blueprint.id} blueprint={blueprint} />}
    </aside>
  );
}

export function ShapeControls({ blueprint, compact = false }: { blueprint: Blueprint; compact?: boolean }) {
  const actions = useActions();
  const beforeRef = useRef<MeshSource | null>(null);
  const { sketch, shape } = blueprint.source;

  const preview = (patch: Partial<ShapeSettings>) => {
    const base = beforeRef.current ?? blueprint.source;
    beforeRef.current = base;
    actions.previewBlueprintShape(blueprint.id, patch, base);
  };
  const commit = (patch: Partial<ShapeSettings>) => {
    const before = beforeRef.current;
    beforeRef.current = null;
    actions.setBlueprintShape(blueprint.id, patch, before ?? undefined);
  };
  const commitRange = (key: 'depth' | 'segments', input: HTMLInputElement) => {
    if (beforeRef.current) commit({ [key]: Number(input.value) });
  };

  const stats = useMemo(() => {
    const generated = generateShape(sketch, shape);
    const report = analyzeGraph(generated.graph);
    return { generated, report, problems: report.issues.filter((issue) => issue.severity !== 'info') };
  }, [sketch, shape]);

  const lineCount = Object.keys(sketch.lines).length;
  const status = (() => {
    if (Object.keys(sketch.points).length === 0) return { tone: 'muted', text: 'Draw on the board to shape this object.' };
    if (lineCount === 0) return { tone: 'muted', text: 'Click again to join dots with lines.' };
    if (stats.problems.length) return { tone: 'warn', text: `${stats.problems.length} geometry ${stats.problems.length === 1 ? 'problem' : 'problems'}: ${stats.problems[0].message}` };
    if (shape.mode !== 'revolve' && stats.generated.regions === 0) {
      return { tone: 'muted', text: shape.mode === 'extrude' ? 'Close an outline to fill it. Open lines become thin walls.' : 'Close an outline to fill it.' };
    }
    if (stats.report.faces === 0) return { tone: 'muted', text: 'Draw lines away from the orange axis to spin them.' };
    const kind = stats.report.closed ? 'Closed solid' : 'Open surface';
    return { tone: 'ok', text: `${kind} · ${stats.report.faces} faces · ${stats.report.triangles.toLocaleString()} triangles` };
  })();

  return (
    <div className={`shape-controls ${compact ? 'is-compact' : ''}`}>
      <div className="mode-switch" role="radiogroup" aria-label="How the drawing becomes 3D">
        {SHAPE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={shape.mode === mode}
            className={shape.mode === mode ? 'is-active' : ''}
            title={MODE_INFO[mode].title}
            onClick={() => actions.setBlueprintShape(blueprint.id, { mode }, undefined, `${MODE_INFO[mode].label} ${blueprint.name}`)}
          >
            <Icon name={MODE_INFO[mode].icon} size={20} />
            <span>{MODE_INFO[mode].label}</span>
          </button>
        ))}
      </div>

      {shape.mode === 'extrude' && (
        <div className="slider-row">
          <span className="slider-label">Thickness</span>
          <input
            type="range"
            min={0.005}
            max={1}
            step={0.005}
            value={Math.min(1, shape.depth)}
            aria-label="Thickness in metres"
            onChange={(event) => preview({ depth: Number(event.target.value) })}
            onPointerUp={(event) => commitRange('depth', event.currentTarget)}
            onKeyUp={(event) => commitRange('depth', event.currentTarget)}
            onBlur={(event) => commitRange('depth', event.currentTarget)}
          />
          <NumberField
            label="m"
            value={shape.depth}
            dragStep={0.005}
            decimals={3}
            onCommit={(depth) => commit({ depth })}
            onScrub={(depth) => preview({ depth })}
            onScrubEnd={(depth) => commit({ depth })}
          />
        </div>
      )}

      {shape.mode === 'revolve' && (
        <div className="slider-row">
          <span className="slider-label">Smoothness</span>
          <input
            type="range"
            min={MIN_SEGMENTS}
            max={96}
            step={1}
            value={Math.min(96, shape.segments)}
            aria-label="Sides around the axis"
            onChange={(event) => preview({ segments: Number(event.target.value) })}
            onPointerUp={(event) => commitRange('segments', event.currentTarget)}
            onKeyUp={(event) => commitRange('segments', event.currentTarget)}
            onBlur={(event) => commitRange('segments', event.currentTarget)}
          />
          <NumberField
            label="#"
            value={shape.segments}
            dragStep={0.25}
            decimals={0}
            onCommit={(segments) => commit({ segments: Math.min(MAX_SEGMENTS, segments) })}
            onScrub={(segments) => preview({ segments })}
            onScrubEnd={(segments) => commit({ segments })}
          />
        </div>
      )}

      {shape.mode !== 'revolve' ? (
        <label className="switch-row" title="Draw one half and get both, mirrored across the dashed axis (M)">
          <input type="checkbox" checked={shape.mirror} onChange={actions.toggleMirror} />
          <span className="switch" aria-hidden="true" />
          <span>Mirror drawing</span>
        </label>
      ) : (
        <p className="shape-note">Spins around the orange axis on the board. Draw the right half of the profile.</p>
      )}

      {!compact && (
        <div className="swatches" role="group" aria-label="Colour">
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch ${blueprint.material.color === color ? 'is-current' : ''}`}
              style={{ background: color }}
              aria-label={`Colour ${color}`}
              onClick={() => actions.setColor(blueprint.id, color)}
            />
          ))}
        </div>
      )}

      <p className={`shape-status is-${status.tone}`}>
        {status.tone !== 'muted' && <Icon name={status.tone === 'ok' ? 'check' : 'warning'} size={13} />}
        <span>{status.text}</span>
      </p>

      <div className="shape-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => actions.convertToPoints(blueprint.id)}
          disabled={stats.report.vertices === 0}
          title="Turn the generated mesh into editable points (undo turns it back)"
        >
          <Icon name="points" size={14} /> Convert to points
        </button>
      </div>
    </div>
  );
}
