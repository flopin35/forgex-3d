import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isDrawn, type DrawnObject } from '../app/drawing';
import { useActions, useEditor } from '../app/EditorContext';
import { perfStats } from '../app/perfStats';
import { analyzeGraph } from '../core/geometry/analysis';
import { moveVertex, type ConstructionGraph } from '../core/geometry/constructionGraph';
import { MIRROR_AXES } from '../core/geometry/modifiers';
import type { Transform } from '../core/math/transform';
import type { Vec3 } from '../core/math/vec3';
import { PROJECT_FORMAT_VERSION } from '../core/project/projectFile';
import { isLocked } from '../core/scene/scene';
import { HEX_COLOR, isConstructionMesh, meshGraphOf, type MeshObject, type SceneObject } from '../core/scene/types';
import { BODY_VIEWS } from '../core/sketch/body';
import { SKETCH_PLANES, type SketchPlane } from '../core/sketch/sketch';
import { METERS_PER_ROBLOX_STUD } from '../core/units';
import { Icon } from './icons';
import { NumberField } from './NumberField';
import { DrawnControls, FinishControls } from './ShapeCard';

const SHAPE_NAMES = { flat: 'flat', extrude: 'extruded', revolve: 'revolved' } as const;
const PLANE_NAMES: Record<SketchPlane, string> = { front: 'Front', side: 'Side', top: 'Top' };

const AXES = ['x', 'y', 'z'] as const;
const SWATCHES = ['#3d9fe8', '#62cbff', '#e4a23c', '#55b888', '#e0565b', '#a77be0', '#d9dee5', '#3a4350'];

type TransformField = keyof Transform;

const FIELD_SETTINGS: Record<TransformField, { label: string; unit: string; dragStep: number; decimals: number; verb: string }> = {
  position: { label: 'Position', unit: 'm', dragStep: 0.01, decimals: 3, verb: 'Move' },
  rotation: { label: 'Rotation', unit: '°', dragStep: 0.5, decimals: 2, verb: 'Rotate' },
  scale: { label: 'Scale', unit: '×', dragStep: 0.01, decimals: 3, verb: 'Scale' },
};

function withComponent(vector: Vec3, index: number, value: number): Vec3 {
  const next: Vec3 = [...vector];
  next[index] = value;
  return next;
}

function describeKind(object: SceneObject): string {
  if (object.kind === 'group') return 'Group';
  if (object.source.type === 'primitive') return `Parametric ${object.source.primitive}`;
  if (object.source.type === 'sketch') return `Blueprint, ${SHAPE_NAMES[object.source.shape.mode]}${object.source.shape.mirror && object.source.shape.mode !== 'revolve' ? ' and mirrored' : ''}`;
  if (object.source.type === 'body') return 'Body lofted from side, top and front views';
  return 'Point-built mesh';
}

export function Inspector() {
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  return (
    <section className="inspector" aria-label="Properties">
      {selected ? <ObjectProperties object={selected} /> : <ProjectProperties />}
    </section>
  );
}

function ObjectProperties({ object }: { object: SceneObject }) {
  const actions = useActions();
  const locked = useEditor((s) => isLocked(s.scene, object.id));
  return (
    <>
      <div className="inspector-title">
        <div className="inspector-name-row">
          <NameField key={object.id} id={object.id} name={object.name} />
          <button
            type="button"
            className={`icon-button ${object.locked ? 'is-active' : ''}`}
            aria-pressed={!!object.locked}
            onClick={() => actions.toggleLock(object.id)}
            title={object.locked ? 'Unlock (Ctrl+L)' : 'Lock against changes (Ctrl+L)'}
          >
            <Icon name={object.locked ? 'lock' : 'unlock'} />
          </button>
        </div>
        <span className="kind-label">{describeKind(object)}</span>
        {locked && (
          <p className="locked-note">
            <Icon name="lock" size={13} />
            {object.locked ? 'Locked. Unlock it to move or edit it.' : 'Inside a locked group. Unlock the group to edit it.'}
          </p>
        )}
      </div>
      <fieldset className="inspector-fields" disabled={locked}>
      <TransformSection object={object} />
      {isDrawn(object) && <DrawingSection object={object} />}
      {object.kind === 'mesh' && <AppearanceSection object={object} />}
      {object.kind === 'mesh' && !isDrawn(object) && object.source.type === 'construction' && <FinishSection object={object} />}
      {isConstructionMesh(object) && <GeometrySection object={object} />}
      {object.kind === 'mesh' && (isDrawn(object) || !!object.modifiers) && <GeneratedGeometrySection object={object} />}
      </fieldset>
      <section className="inspector-section">
        <div className="section-actions">
          <button type="button" className="text-button" onClick={actions.duplicateSelection}>
            <Icon name="duplicate" size={14} /> Duplicate
          </button>
          <button type="button" className="text-button" onClick={actions.groupSelection}>
            <Icon name="group" size={14} /> Group
          </button>
          <button type="button" className="text-button" onClick={() => void actions.saveToLibrary({ id: object.id })} title="Keep a copy in My Parts to reuse in any project">
            <Icon name="library" size={14} /> Save to My Parts
          </button>
          <button type="button" className="text-button is-danger" onClick={actions.deleteSelection} disabled={locked}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
        <p className="object-id">ID {object.id}</p>
      </section>
    </>
  );
}

function NameField({ id, name }: { id: string; name: string }) {
  const actions = useActions();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      className="name-input"
      aria-label="Object name"
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim()) actions.rename(id, draft);
        else setDraft(name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.stopPropagation();
          setDraft(name);
        }
      }}
    />
  );
}

function TransformSection({ object }: { object: SceneObject }) {
  const actions = useActions();
  const scrubBefore = useRef<Transform | null>(null);

  const build = (base: Transform, field: TransformField, index: number, value: number): Transform => ({
    ...base,
    [field]: withComponent(base[field], index, value),
  });

  return (
    <section className="inspector-section">
      <h3>Transform</h3>
      {(Object.keys(FIELD_SETTINGS) as TransformField[]).map((field) => {
        const settings = FIELD_SETTINGS[field];
        return (
          <div key={field} className="vector-row">
            <span className="vector-label">
              {settings.label} <span className="unit">{settings.unit}</span>
            </span>
            <div className="vector-fields">
              {AXES.map((axis, index) => (
                <NumberField
                  key={axis}
                  label={axis.toUpperCase()}
                  axis={axis}
                  value={object.transform[field][index]}
                  dragStep={settings.dragStep}
                  decimals={settings.decimals}
                  onCommit={(value) =>
                    actions.commitTransform(object.id, object.transform, build(object.transform, field, index, value), `${settings.verb} ${object.name}`)
                  }
                  onScrubStart={() => (scrubBefore.current = object.transform)}
                  onScrub={(value) => {
                    const base = scrubBefore.current ?? object.transform;
                    actions.store.previewTransform(object.id, build(base, field, index, value));
                  }}
                  onScrubEnd={(value) => {
                    const base = scrubBefore.current ?? object.transform;
                    scrubBefore.current = null;
                    actions.commitTransform(object.id, base, build(base, field, index, value), `${settings.verb} ${object.name}`);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function AppearanceSection({ object }: { object: MeshObject }) {
  const actions = useActions();
  const pickerRef = useRef<HTMLInputElement>(null);
  const colorBefore = useRef<string | null>(null);
  const [hex, setHex] = useState(object.material.color);
  useEffect(() => setHex(object.material.color), [object.material.color]);

  // The native "change" event fires once when the colour picker closes: commit then.
  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const onChange = () => {
      const before = colorBefore.current;
      colorBefore.current = null;
      actions.setColor(object.id, picker.value, before ?? undefined);
    };
    picker.addEventListener('change', onChange);
    return () => picker.removeEventListener('change', onChange);
  }, [actions, object.id]);

  return (
    <section className="inspector-section">
      <h3>Appearance</h3>
      <div className="color-row">
        <input
          ref={pickerRef}
          type="color"
          className="color-picker"
          aria-label="Colour"
          value={object.material.color}
          onChange={(event) => {
            if (colorBefore.current === null) colorBefore.current = object.material.color;
            actions.store.previewColor(object.id, event.target.value);
          }}
        />
        <input
          className="hex-input"
          aria-label="Colour hex code"
          value={hex}
          spellCheck={false}
          onChange={(event) => setHex(event.target.value)}
          onBlur={() => {
            const value = hex.startsWith('#') ? hex : `#${hex}`;
            if (HEX_COLOR.test(value)) actions.setColor(object.id, value.toLowerCase());
            else setHex(object.material.color);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      <div className="swatches" role="group" aria-label="Colour presets">
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch ${object.material.color === color ? 'is-current' : ''}`}
            style={{ background: color }}
            aria-label={`Use ${color}`}
            onClick={() => actions.setColor(object.id, color)}
          />
        ))}
      </div>
    </section>
  );
}

function GeometrySection({ object }: { object: MeshObject & { source: { type: 'construction'; graph: ConstructionGraph } } }) {
  const actions = useActions();
  const editMode = useEditor((s) => s.editMode);
  const selectedVertexId = useEditor((s) => s.selectedVertexId);
  const graph = object.source.graph;
  const report = useMemo(() => analyzeGraph(graph), [graph]);
  const problems = report.issues.filter((issue) => issue.severity !== 'info');
  const notes = report.issues.filter((issue) => issue.severity === 'info');
  const pointsMode = editMode === 'points';
  const vertex = selectedVertexId ? graph.vertices[selectedVertexId] : undefined;
  const graphBefore = useRef<ConstructionGraph | null>(null);

  return (
    <section className="inspector-section">
      <h3>Geometry</h3>
      <dl className="stat-grid">
        <div>
          <dt>Vertices</dt>
          <dd>{report.vertices}</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>{report.edges}</dd>
        </div>
        <div>
          <dt>Faces</dt>
          <dd>{report.faces}</dd>
        </div>
        <div>
          <dt>Triangles</dt>
          <dd>{report.triangles}</dd>
        </div>
      </dl>
      <p className={`shell-status ${problems.length ? 'has-problems' : ''}`}>
        <Icon name={problems.length ? 'warning' : 'check'} size={14} />
        {problems.length
          ? `${problems.length} geometry ${problems.length === 1 ? 'problem' : 'problems'}`
          : report.closed
            ? 'Closed shell, no problems'
            : 'Open surface, no problems'}
      </p>
      {[...problems, ...notes].length > 0 && (
        <ul className="issue-list">
          {[...problems, ...notes].map((issue) => (
            <li key={issue.code} className={`issue issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="section-actions">
        <button type="button" className={`text-button ${pointsMode ? 'is-active' : ''}`} onClick={actions.togglePointsMode} aria-pressed={pointsMode}>
          <Icon name="points" size={14} /> {pointsMode ? 'Done editing points' : 'Edit points'}
        </button>
        <button type="button" className="text-button" onClick={actions.fillLoops} title="Create faces from closed loops of edges">
          <Icon name="fill" size={14} /> Fill loops
        </button>
        <button type="button" className="text-button" onClick={actions.recalculateNormals} title="Make all faces point outward consistently">
          <Icon name="normals" size={14} /> Recalculate normals
        </button>
        <button type="button" className="text-button" onClick={actions.checkGeometry} title="Check the mesh and report any problems">
          <Icon name="inspect" size={14} /> Check
        </button>
      </div>

      {pointsMode && (
        <div className="vertex-editor">
          {vertex ? (
            <div className="vector-row">
              <span className="vector-label">
                Vertex {vertex.id} <span className="unit">m, local</span>
              </span>
              <div className="vector-fields">
                {AXES.map((axis, index) => (
                  <NumberField
                    key={axis}
                    label={axis.toUpperCase()}
                    axis={axis}
                    value={vertex.position[index]}
                    dragStep={0.01}
                    decimals={4}
                    onCommit={(value) => actions.setVertexPosition(object.id, vertex.id, withComponent(vertex.position, index, value))}
                    onScrubStart={() => (graphBefore.current = graph)}
                    onScrub={(value) => {
                      const base = graphBefore.current ?? graph;
                      const start = base.vertices[vertex.id].position;
                      actions.store.previewGraph(object.id, moveVertex(base, vertex.id, withComponent(start, index, value)));
                    }}
                    onScrubEnd={(value) => {
                      const base = graphBefore.current ?? graph;
                      graphBefore.current = null;
                      const start = base.vertices[vertex.id].position;
                      actions.commitGraph(object.id, base, moveVertex(base, vertex.id, withComponent(start, index, value)), `Move vertex ${vertex.id}`);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="hint">Click a point in the viewport to select it, then drag the arrows or type a position.</p>
          )}
        </div>
      )}
    </section>
  );
}

function DrawingSection({ object }: { object: DrawnObject }) {
  const actions = useActions();
  if (object.source.type === 'body') {
    const { views } = object.source;
    return (
      <section className="inspector-section">
        <h3>Body</h3>
        <p className="hint">
          Lofted from {BODY_VIEWS.map((view) => `${Object.keys(views[view].points).length} ${view}`).join(', ')} dots. Pick a view below or on the board to edit it.
        </p>
        <DrawnControls object={object} compact />
      </section>
    );
  }
  const { sketch } = object.source;
  return (
    <section className="inspector-section">
      <h3>Blueprint</h3>
      <div className="property-row">
        <span>Drawn on</span>
        <div className="segmented is-small" role="radiogroup" aria-label="Drawing plane">
          {SKETCH_PLANES.map((plane) => (
            <button
              key={plane}
              type="button"
              role="radio"
              aria-checked={sketch.plane === plane}
              className={sketch.plane === plane ? 'is-active' : ''}
              onClick={() => actions.setBlueprintPlane(object.id, plane)}
            >
              {PLANE_NAMES[plane]}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        {Object.keys(sketch.points).length} dots and {Object.keys(sketch.lines).length} lines. Edit the drawing on the board.
      </p>
      <DrawnControls object={object} compact />
    </section>
  );
}

/** Smooth shading, subdivision and mirror for point-built meshes (box modelling). */
function FinishSection({ object }: { object: MeshObject }) {
  const actions = useActions();
  const mirror = object.modifiers?.mirror ?? 'none';
  return (
    <section className="inspector-section">
      <h3>Finish</h3>
      <FinishControls object={object} />
      <div className="option-row" title="Model one half: the mesh is copied across its local axis and joined">
        <span className="slider-label">Mirror</span>
        <div className="segmented is-small" role="radiogroup" aria-label="Mirror axis">
          {MIRROR_AXES.map((axis) => (
            <button
              key={axis}
              type="button"
              role="radio"
              aria-checked={mirror === axis}
              className={mirror === axis ? 'is-active' : ''}
              onClick={() => actions.setMeshLook(object.id, { modifiers: { mirror: axis } })}
            >
              {axis === 'none' ? 'Off' : axis.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Read-only stats for a generated or modified mesh (what is shown and exported). */
function GeneratedGeometrySection({ object }: { object: MeshObject }) {
  const graph = meshGraphOf(object);
  const report = useMemo(() => (graph ? analyzeGraph(graph) : null), [graph]);
  if (!report) return null;
  return (
    <section className="inspector-section">
      <h3>Geometry</h3>
      <dl className="stat-grid">
        <div>
          <dt>Vertices</dt>
          <dd>{report.vertices}</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>{report.edges}</dd>
        </div>
        <div>
          <dt>Faces</dt>
          <dd>{report.faces}</dd>
        </div>
        <div>
          <dt>Triangles</dt>
          <dd>{report.triangles}</dd>
        </div>
      </dl>
    </section>
  );
}

function ProjectProperties() {
  const project = useEditor((s) => s.project);
  const objectCount = useEditor((s) => Object.keys(s.scene.objects).length);
  const perf = useSyncExternalStore(perfStats.subscribe, perfStats.getSnapshot);
  return (
    <>
      <section className="inspector-section">
        <h3>Project</h3>
        <dl className="property-list">
          <div>
            <dt>Name</dt>
            <dd>{project.name}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd className="path">{project.path ?? 'Not saved yet'}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>.forgex version {PROJECT_FORMAT_VERSION}</dd>
          </div>
          <div>
            <dt>Objects</dt>
            <dd>{objectCount}</dd>
          </div>
          <div>
            <dt>Triangles</dt>
            <dd>{perf.triangles.toLocaleString()}</dd>
          </div>
        </dl>
      </section>
      <section className="inspector-section">
        <h3>World conventions</h3>
        <dl className="property-list">
          <div>
            <dt>Units</dt>
            <dd>Metres</dd>
          </div>
          <div>
            <dt>Up axis</dt>
            <dd>+Y (front faces +Z)</dd>
          </div>
          <div>
            <dt>Roblox</dt>
            <dd>1 stud = {METERS_PER_ROBLOX_STUD} m</dd>
          </div>
          <div>
            <dt>Blender</dt>
            <dd>+Z up, converted on export</dd>
          </div>
        </dl>
      </section>
      <p className="hint">Select an object in the 3D view or the scene list to edit it. Pick a blueprint to edit its drawing on the board.</p>
    </>
  );
}
