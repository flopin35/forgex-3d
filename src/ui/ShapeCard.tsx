import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { boardStore } from '../app/boardState';
import { isDrawn, type DrawnObject } from '../app/drawing';
import { useActions, useEditor } from '../app/EditorContext';
import { analyzeGraph } from '../core/geometry/analysis';
import { MAX_SUBDIVISION } from '../core/geometry/modifiers';
import { BLUEPRINT_COLORS } from '../core/scene/parts';
import { meshGraphOf, type MeshObject, type MeshSource } from '../core/scene/types';
import { BODY_LIMITS, BODY_VIEWS, generateBody, type BodySettings } from '../core/sketch/body';
import { generateShape } from '../core/sketch/generate';
import { MAX_SEGMENTS, MIN_SEGMENTS, REVOLVE_AXES, SHAPE_MODES, type ShapeMode, type ShapeSettings } from '../core/sketch/sketch';
import { Icon, type IconName } from './icons';
import { NumberField } from './NumberField';

type Blueprint = MeshObject & { source: Extract<MeshSource, { type: 'sketch' }> };
type Body = MeshObject & { source: Extract<MeshSource, { type: 'body' }> };

const MODE_INFO: Record<ShapeMode, { label: string; icon: IconName; title: string }> = {
  flat: { label: 'Flat', icon: 'shapeFlat', title: 'A flat panel: signs, decals, cards' },
  extrude: { label: 'Extrude', icon: 'shapeExtrude', title: 'Give the outline a thickness: swords, shields, walls, spoilers' },
  revolve: { label: 'Revolve', icon: 'shapeRevolve', title: 'Spin the lines around an axis: wheels, bottles, vases' },
};

const SWATCHES = [...BLUEPRINT_COLORS, '#f2a51a', '#1f2d4a', '#c42a2a', '#d9dee5', '#16212d'];

/** Live preview while a control is dragged, then one undo step when it is let go. */
function usePreviewCommit<Patch>(source: MeshSource, preview: (patch: Patch, base: MeshSource) => void, commit: (patch: Patch, before: MeshSource | undefined) => void) {
  const beforeRef = useRef<MeshSource | null>(null);
  return {
    preview: (patch: Patch) => {
      const base = beforeRef.current ?? source;
      beforeRef.current = base;
      preview(patch, base);
    },
    commit: (patch: Patch) => {
      const before = beforeRef.current;
      beforeRef.current = null;
      commit(patch, before ?? undefined);
    },
    pending: () => beforeRef.current !== null,
  };
}

interface SliderRowProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  pending: () => boolean;
}

function SliderRow({ label, unit, min, max, step, value, decimals, onPreview, onCommit, pending }: SliderRowProps) {
  const commitRange = (input: HTMLInputElement) => {
    if (pending()) onCommit(Number(input.value));
  };
  return (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        aria-label={label}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={(event) => commitRange(event.currentTarget)}
        onKeyUp={(event) => commitRange(event.currentTarget)}
        onBlur={(event) => commitRange(event.currentTarget)}
      />
      <NumberField label={unit} value={value} dragStep={step} decimals={decimals} onCommit={onCommit} onScrub={onPreview} onScrubEnd={onCommit} />
    </div>
  );
}

/** The floating "Make it 3D" card over the 3D view: how the selected drawing becomes an object. */
export function ShapeCard() {
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  // Open by default on roomy screens; on small ones the Properties panel shows the same controls.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1440);
  if (!isDrawn(selected)) return null;
  const isBody = selected.source.type === 'body';
  return (
    <aside className={`shape-card ${open ? '' : 'is-collapsed'}`} aria-label="Make it 3D">
      <button type="button" className="shape-card-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="shape-card-kicker">{isBody ? 'Body loft' : 'Make it 3D'}</span>
        <span className="shape-card-name">{selected.name}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && <DrawnControls key={selected.id} object={selected} />}
    </aside>
  );
}

/** Controls for any drawn object: blueprint shape or body loft, finish, colour. */
export function DrawnControls({ object, compact = false }: { object: DrawnObject; compact?: boolean }) {
  return object.source.type === 'body' ? <BodyControls body={object as Body} compact={compact} /> : <ShapeControls blueprint={object as Blueprint} compact={compact} />;
}

function geometryStatus(object: MeshObject) {
  const graph = meshGraphOf(object);
  const report = graph ? analyzeGraph(graph) : null;
  // Generated quads may bend slightly; that is expected, so only real problems count here.
  const problems = report ? report.issues.filter((issue) => issue.severity !== 'info' && issue.code !== 'non-planar-face') : [];
  return { report, problems };
}

export function ShapeControls({ blueprint, compact = false }: { blueprint: Blueprint; compact?: boolean }) {
  const actions = useActions();
  const { sketch, shape } = blueprint.source;
  const shapeEdit = usePreviewCommit<Partial<ShapeSettings>>(
    blueprint.source,
    (patch, base) => actions.previewBlueprintShape(blueprint.id, patch, base),
    (patch, before) => actions.setBlueprintShape(blueprint.id, patch, before),
  );

  const stats = useMemo(() => ({ generated: generateShape(sketch, shape), ...geometryStatus(blueprint) }), [sketch, shape, blueprint]);

  const lineCount = Object.keys(sketch.lines).length;
  const status = (() => {
    if (Object.keys(sketch.points).length === 0) return { tone: 'muted', text: 'Draw on the board to shape this object.' };
    if (lineCount === 0) return { tone: 'muted', text: 'Click again to join dots with lines.' };
    if (stats.problems.length) return { tone: 'warn', text: `${stats.problems.length} geometry ${stats.problems.length === 1 ? 'problem' : 'problems'}: ${stats.problems[0].message}` };
    if (shape.mode !== 'revolve' && stats.generated.regions === 0) {
      return { tone: 'muted', text: shape.mode === 'extrude' ? 'Close an outline to fill it. Open lines become thin walls.' : 'Close an outline to fill it.' };
    }
    if (!stats.report || stats.report.faces === 0) return { tone: 'muted', text: 'Draw lines away from the orange axis to spin them.' };
    const kind = stats.report.closed ? 'Closed solid' : 'Open surface';
    return { tone: 'ok', text: `${kind} · ${stats.report.faces.toLocaleString()} faces · ${stats.report.triangles.toLocaleString()} triangles` };
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
        <SliderRow
          label="Thickness"
          unit="m"
          min={0.005}
          max={1}
          step={0.005}
          decimals={3}
          value={shape.depth}
          onPreview={(depth) => shapeEdit.preview({ depth })}
          onCommit={(depth) => shapeEdit.commit({ depth })}
          pending={shapeEdit.pending}
        />
      )}

      {shape.mode === 'revolve' && (
        <>
          <div className="option-row">
            <span className="slider-label">Spin around</span>
            <div className="segmented is-small" role="radiogroup" aria-label="Revolve axis">
              {REVOLVE_AXES.map((axis) => (
                <button
                  key={axis}
                  type="button"
                  role="radio"
                  aria-checked={shape.axis === axis}
                  className={shape.axis === axis ? 'is-active' : ''}
                  title={axis === 'vertical' ? 'The vertical line: vases, bottles, cups' : 'The horizontal line: wheels, tyres, barrels'}
                  onClick={() => actions.setBlueprintShape(blueprint.id, { axis }, undefined, `Spin ${blueprint.name} around the ${axis} axis`)}
                >
                  {axis === 'vertical' ? 'Upright' : 'Wheel axle'}
                </button>
              ))}
            </div>
          </div>
          <SliderRow
            label="Smoothness"
            unit="#"
            min={MIN_SEGMENTS}
            max={96}
            step={1}
            decimals={0}
            value={shape.segments}
            onPreview={(segments) => shapeEdit.preview({ segments })}
            onCommit={(segments) => shapeEdit.commit({ segments: Math.min(MAX_SEGMENTS, segments) })}
            pending={shapeEdit.pending}
          />
        </>
      )}

      {shape.mode !== 'revolve' ? (
        <label className="switch-row" title="Draw one half and get both, mirrored across the dashed axis (M)">
          <input type="checkbox" checked={shape.mirror} onChange={actions.toggleMirror} />
          <span className="switch" aria-hidden="true" />
          <span>Mirror drawing</span>
        </label>
      ) : (
        <p className="shape-note">
          {shape.axis === 'vertical' ? 'Spins around the orange upright axis. Draw the right half of the profile.' : 'Spins around the orange horizontal line, like a wheel. Draw the profile above it.'}
        </p>
      )}

      <FinishControls object={blueprint} />
      {!compact && <Swatches object={blueprint} />}

      <p className={`shape-status is-${status.tone}`}>
        {status.tone !== 'muted' && <Icon name={status.tone === 'ok' ? 'check' : 'warning'} size={13} />}
        <span>{status.text}</span>
      </p>
      <ConvertButton object={blueprint} disabled={!stats.report || stats.report.vertices === 0} />
    </div>
  );
}

function BodyControls({ body, compact = false }: { body: Body; compact?: boolean }) {
  const actions = useActions();
  const bodyView = useSyncExternalStore(boardStore.subscribe, () => boardStore.getState().bodyView);
  const { views, body: settings } = body.source;
  const bodyEdit = usePreviewCommit<Partial<BodySettings>>(
    body.source,
    (patch, base) => actions.previewBodySettings(body.id, patch, base),
    (patch, before) => actions.setBodySettings(body.id, patch, before),
  );
  const stats = useMemo(() => ({ generated: generateBody(views, settings), ...geometryStatus(body) }), [views, settings, body]);
  const status = stats.generated.message
    ? { tone: 'muted', text: stats.generated.message }
    : stats.problems.length
      ? { tone: 'warn', text: `${stats.problems.length} geometry ${stats.problems.length === 1 ? 'problem' : 'problems'}: ${stats.problems[0].message}` }
      : {
          tone: 'ok',
          text: `${stats.report?.closed ? 'Closed solid' : 'Open surface'} · ${stats.generated.stations} slices · ${stats.report?.triangles.toLocaleString() ?? 0} triangles`,
        };

  return (
    <div className={`shape-controls ${compact ? 'is-compact' : ''}`}>
      <div className="view-chips" role="group" aria-label="Views">
        {BODY_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className={`view-chip ${bodyView === view ? 'is-active' : ''} ${stats.generated.closed[view] ? 'is-done' : ''}`}
            onClick={() => boardStore.set({ bodyView: view })}
            title={`Draw the ${view} view on the board`}
          >
            <Icon name={stats.generated.closed[view] ? 'check' : view === 'front' ? 'info' : 'pen'} size={13} />
            {view === 'side' ? 'Side' : view === 'top' ? 'Top' : 'Front'}
            {view === 'front' && !stats.generated.closed.front && <span className="view-chip-note">optional</span>}
          </button>
        ))}
      </div>

      <SliderRow
        label="Slices"
        unit="#"
        min={8}
        max={BODY_LIMITS.stations[1]}
        step={1}
        decimals={0}
        value={settings.stations}
        onPreview={(stations) => bodyEdit.preview({ stations })}
        onCommit={(stations) => bodyEdit.commit({ stations })}
        pending={bodyEdit.pending}
      />
      <SliderRow
        label="Detail"
        unit="#"
        min={12}
        max={96}
        step={2}
        decimals={0}
        value={settings.sectionPoints}
        onPreview={(sectionPoints) => bodyEdit.preview({ sectionPoints })}
        onCommit={(sectionPoints) => bodyEdit.commit({ sectionPoints })}
        pending={bodyEdit.pending}
      />
      {!stats.generated.closed.front && (
        <SliderRow
          label="Boxiness"
          unit="×"
          min={BODY_LIMITS.roundness[0]}
          max={BODY_LIMITS.roundness[1]}
          step={0.1}
          decimals={1}
          value={settings.roundness}
          onPreview={(roundness) => bodyEdit.preview({ roundness })}
          onCommit={(roundness) => bodyEdit.commit({ roundness })}
          pending={bodyEdit.pending}
        />
      )}
      <label className="switch-row" title="Draw the right half of the top and front views; the left half is mirrored (M)">
        <input type="checkbox" checked={settings.symmetric} onChange={() => actions.setBodySettings(body.id, { symmetric: !settings.symmetric })} />
        <span className="switch" aria-hidden="true" />
        <span>Symmetric (draw the right half)</span>
      </label>

      <FinishControls object={body} />
      {!compact && <Swatches object={body} />}

      <p className={`shape-status is-${status.tone}`}>
        {status.tone !== 'muted' && <Icon name={status.tone === 'ok' ? 'check' : 'warning'} size={13} />}
        <span>{status.text}</span>
      </p>
      <ConvertButton object={body} disabled={!!stats.generated.message} />
    </div>
  );
}

/** Smooth shading and subdivision: the finish of any mesh. */
export function FinishControls({ object }: { object: MeshObject }) {
  const actions = useActions();
  const levels = object.modifiers?.subdivide ?? 0;
  return (
    <div className="finish-controls">
      <label className="switch-row" title="Curved surfaces look round; creases sharper than 50° stay sharp">
        <input type="checkbox" checked={!!object.material.smooth} onChange={() => actions.setMeshLook(object.id, { smooth: !object.material.smooth })} />
        <span className="switch" aria-hidden="true" />
        <span>Smooth shading</span>
      </label>
      <div className="option-row" title="Splits every face and rounds the shape (Catmull-Clark). Each level has four times the faces.">
        <span className="slider-label">Subdivide</span>
        <div className="segmented is-small" role="radiogroup" aria-label="Subdivision levels">
          {Array.from({ length: MAX_SUBDIVISION + 1 }, (_, level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={levels === level}
              className={levels === level ? 'is-active' : ''}
              onClick={() => actions.setMeshLook(object.id, { modifiers: { subdivide: level } })}
            >
              {level === 0 ? 'Off' : level}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Swatches({ object }: { object: MeshObject }) {
  const actions = useActions();
  return (
    <div className="swatches" role="group" aria-label="Colour">
      {SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          className={`swatch ${object.material.color === color ? 'is-current' : ''}`}
          style={{ background: color }}
          aria-label={`Colour ${color}`}
          onClick={() => actions.setColor(object.id, color)}
        />
      ))}
    </div>
  );
}

function ConvertButton({ object, disabled }: { object: MeshObject; disabled: boolean }) {
  const actions = useActions();
  return (
    <div className="shape-actions">
      <button type="button" className="text-button" onClick={() => actions.convertToPoints(object.id)} disabled={disabled} title="Turn the generated mesh into editable points (undo turns it back)">
        <Icon name="points" size={14} /> Convert to points
      </button>
    </div>
  );
}
