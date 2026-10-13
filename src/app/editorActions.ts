import { CompositeCommand, type Command } from '../core/commands/command';
import {
  AddObjectsCommand,
  DeleteObjectCommand,
  MoveObjectCommand,
  RenameObjectCommand,
  ReplaceSceneCommand,
  SetColorCommand,
  SetGraphCommand,
  SetLockCommand,
  SetMeshLookCommand,
  SetSourceCommand,
  SetTransformCommand,
  SetVisibilityCommand,
} from '../core/commands/sceneCommands';
import type { ToolImage, ViewPreset } from '../core/automation/toolTypes';
import type { EditorStore, ToolMode } from '../core/editor/editorStore';
import { analyzeGraph } from '../core/geometry/analysis';
import { moveVertex, type ConstructionGraph } from '../core/geometry/constructionGraph';
import { fillClosedLoops } from '../core/geometry/loops';
import { orientFaces } from '../core/geometry/orientation';
import { createObjectId, randomId } from '../core/ids';
import { instantiateLibraryPart, libraryPartFromScene } from '../core/library/libraryPart';
import { addSnapshot, createSnapshot, nextSnapshotName, removeSnapshot, renameSnapshot } from '../core/project/snapshots';
import {
  alignPoints,
  allPointIds,
  copyFragment,
  distributePoints,
  duplicatePoints,
  flipPoints,
  pasteFragment,
  pointsCentre,
  polarPoint,
  rotatePoints,
  scalePoints,
  setLineAngle,
  setLineLength,
  type AlignEdge,
  type FlipDirection,
} from '../core/sketch/edit';
import { cleanTransform, transformsEqual, type Transform } from '../core/math/transform';
import { cleanVec3, equals, snapScalar, type Vec3 } from '../core/math/vec3';
import { createDefaultDocument, createEmptyDocument } from '../core/project/defaultDocument';
import { ensureProjectExtension, fileNameFromPath, projectNameFromPath } from '../core/project/paths';
import { parseProject, serializeProject } from '../core/project/projectFile';
import { cleanModifiers, hasModifiers, NO_MODIFIERS, type MeshModifiers } from '../core/geometry/modifiers';
import { createReference, MAX_REFERENCE_CHARS, type ReferenceImage } from '../core/project/references';
import { BLUEPRINT_COLORS, createBlueprintObject, createBodyObject, createPartObject, getPart, type PartId } from '../core/scene/parts';
import { clearSpotX, cloneSubtree, indexInParent, isLocked, planDrop, uniqueName, type DropPosition } from '../core/scene/scene';
import { createTemplate, getTemplate, type TemplateId } from '../core/scene/templates';
import { isBodyMesh, isConstructionMesh, isSketchMesh, sourceGraphOf, type MeshObject, type MeshSource } from '../core/scene/types';
import { clampBody, type BodySettings, type BodyView } from '../core/sketch/body';
import { addLine, addPoint, clampShape, createSketch, movePoint, removeItems, setPlane, setPointsSmooth, translatePoints, type ShapeSettings, type Sketch, type SketchPlane } from '../core/sketch/sketch';
import type { PlatformFiles } from '../platform/files';
import { boardPointer, boardStore, isPenTool } from './boardState';
import { clipboard } from './clipboard';
import { drawingIn, drawingOf, isDrawn, withDrawing, type ActiveDrawing } from './drawing';
import { rememberProject } from './recentProjects';
import { uiStore } from './uiState';

/** A selected blueprint: a mesh whose shape comes from a drawing on the board. */
export type BlueprintObject = MeshObject & { source: { type: 'sketch'; sketch: Sketch; shape: ShapeSettings } };

/** What the editor needs from the 3D viewport. */
export interface ViewportApi {
  frameSelection(): void;
  /** Cancels a gizmo drag in progress. Returns false when nothing was being dragged. */
  cancelActiveDrag(): boolean;
  /** Where new parts are placed: the point on the ground the camera is looking at. */
  groundFocus(): [number, number];
  /** Renders an image of the scene; the user's own camera view is restored afterwards. */
  capture(options: { view: ViewPreset; frame: boolean; width: number }): ToolImage;
  /** A small picture of one object on its own (for My Parts), as a JPEG data URL. */
  captureObject(id: string, width: number): string | null;
  /** Turns the camera to look from one side at the same distance. */
  lookFrom(view: Exclude<ViewPreset, 'current'>): void;
}

function getTemplateName(id: TemplateId): string {
  return getTemplate(id).name;
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/**
 * Every user action goes through here: menus, toolbar, panels and shortcuts call the
 * same methods, and each change to the scene is a command so it can be undone.
 */
export class EditorActions {
  private viewport: ViewportApi | null = null;

  constructor(
    readonly store: EditorStore,
    readonly files: PlatformFiles,
  ) {}

  attachViewport(viewport: ViewportApi | null): void {
    this.viewport = viewport;
  }

  private run(command: Command): boolean {
    return this.store.execute(command);
  }

  /** True (and says why) when an object cannot change because it, or a group around it, is locked. */
  private lockedForEdit(id: string): boolean {
    const { scene } = this.store.getState();
    if (!isLocked(scene, id)) return false;
    const object = scene.objects[id];
    this.store.log('info', `${object?.name ?? 'This object'} is locked. Unlock it in the parts list or with Ctrl+L to change it.`);
    return true;
  }

  // -- Projects ---------------------------------------------------------------

  private async confirmDiscard(action: string): Promise<boolean> {
    const { dirty, project } = this.store.getState();
    if (!dirty) return true;
    return this.files.confirm('Unsaved changes', `${project.name} has unsaved changes. ${action} and discard them?`);
  }

  newProject = async (): Promise<void> => {
    if (!(await this.confirmDiscard('Start a new project'))) return;
    this.store.loadDocument(createEmptyDocument(), 'Untitled', null);
    boardStore.set({ tool: 'draw', chainFrom: null, selectedPoints: [], selectedLines: [] });
    this.store.log('info', 'Started a new project. Click on the board to place your first dot.');
  };

  openProject = async (): Promise<void> => {
    if (!(await this.confirmDiscard('Open another project'))) return;
    let opened;
    try {
      opened = await this.files.openProjectFile();
    } catch (error) {
      this.store.log('error', 'The file could not be read.', String(error));
      return;
    }
    if (!opened) return;
    const result = parseProject(opened.contents);
    if (!result.ok) {
      this.store.log('error', `${opened.name} could not be opened. Nothing was changed.`, result.errors.join('\n'));
      return;
    }
    this.store.loadDocument(result.document, projectNameFromPath(opened.name), opened.path);
    if (opened.path) rememberProject(opened.path);
    uiStore.set({ startOpen: false });
    const count = Object.keys(result.document.scene.objects).length;
    this.store.log('success', `Opened ${opened.name} with ${plural(count, 'object')}.`);
    if (result.migratedFrom !== null) {
      this.store.log('info', `Upgraded from format version ${result.migratedFrom}. Saving will write the current version.`);
    }
    if (result.warnings.length) {
      this.store.log('warning', `${plural(result.warnings.length, 'geometry warning')} in ${opened.name}.`, result.warnings.join('\n'));
    }
  };

  saveProject = async (): Promise<boolean> => {
    const { path } = this.store.getState().project;
    if (!path || this.files.kind === 'browser') return this.saveProjectAs();
    return this.writeTo(path);
  };

  saveProjectAs = async (): Promise<boolean> => {
    const { name } = this.store.getState().project;
    let chosen: string | null;
    try {
      chosen = await this.files.chooseSavePath(`${name || 'Untitled'}.forgex`);
    } catch (error) {
      this.store.log('error', 'The save dialog could not open.', String(error));
      return false;
    }
    return chosen ? this.writeTo(ensureProjectExtension(chosen)) : false;
  };

  // -- Project operations for AI tools (same prompts and checks as the menus) ---------

  /** Returns false when the user chose to keep their unsaved changes. */
  startNewProject = async (options: { empty: boolean; path?: string | null }): Promise<boolean> => {
    if (!(await this.confirmDiscard('Start a new project'))) return false;
    const path = options.path ? ensureProjectExtension(options.path) : null;
    const document = options.empty ? createEmptyDocument() : createDefaultDocument();
    this.store.loadDocument(document, path ? projectNameFromPath(path) : 'Untitled', path);
    this.store.log('info', `Started a new project${path ? ` for ${path}` : ''}.`);
    return true;
  };

  /** Opens a project from a known path. Throws with a readable reason when it cannot. */
  openProjectAt = async (path: string): Promise<{ opened: boolean; message: string }> => {
    if (!(await this.confirmDiscard('Open another project'))) {
      return { opened: false, message: 'The user kept their unsaved changes, so nothing was opened.' };
    }
    const contents = await this.files.readProjectAt(path);
    const result = parseProject(contents);
    if (!result.ok) throw new Error(`${fileNameFromPath(path)} could not be opened:\n${result.errors.join('\n')}`);
    this.store.loadDocument(result.document, projectNameFromPath(path), path);
    rememberProject(path);
    uiStore.set({ startOpen: false });
    const count = Object.keys(result.document.scene.objects).length;
    const message = `Opened ${path} with ${plural(count, 'object')}.`;
    this.store.log('success', message);
    if (result.warnings.length) this.store.log('warning', `${plural(result.warnings.length, 'geometry warning')}.`, result.warnings.join('\n'));
    return { opened: true, message: result.warnings.length ? `${message}\nWarnings:\n${result.warnings.join('\n')}` : message };
  };

  saveProjectTo = async (path: string): Promise<boolean> => this.writeTo(ensureProjectExtension(path));

  captureViewport = (options: { view: ViewPreset; frame: boolean; width: number }): ToolImage | null =>
    this.viewport ? this.viewport.capture(options) : null;

  private async writeTo(path: string): Promise<boolean> {
    const state = this.store.getState();
    const revision = this.store.revision;
    const text = serializeProject(this.store.toDocument());
    // Never write a file this build could not open again.
    const check = parseProject(text);
    if (!check.ok) {
      this.store.log('error', 'Save stopped: the project failed validation. The file on disk was not touched.', check.errors.join('\n'));
      return false;
    }
    try {
      await this.files.writeProjectFile(path, text);
    } catch (error) {
      this.store.log('error', `Could not save ${fileNameFromPath(path)}. The previous file is unchanged.`, String(error));
      return false;
    }
    const savedPath = this.files.kind === 'desktop' ? path : null;
    if (savedPath) rememberProject(savedPath);
    this.store.markSaved(projectNameFromPath(path), savedPath, revision, state.settings, state.references, state.snapshots);
    const where = this.files.kind === 'desktop' ? path : `${fileNameFromPath(path)} (downloaded)`;
    this.store.log('success', `Saved ${where}.`);
    return true;
  }

  // -- Creating and arranging objects ----------------------------------------

  addPart = (partId: PartId): void => {
    const { scene, settings } = this.store.getState();
    const [fx, fz] = this.viewport?.groundFocus() ?? [0, 0];
    const groundPosition: [number, number] = [snapScalar(fx, settings.gridSize), snapScalar(fz, settings.gridSize)];
    const object = createPartObject(partId, { name: uniqueName(scene, getPart(partId).name), groundPosition });
    this.run(new AddObjectsCommand([object]));
  };

  deleteSelection = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (object && !this.lockedForEdit(object.id)) this.run(new DeleteObjectCommand(object.id, object.name));
  };

  duplicateSelection = (): void => {
    const { selectedId, scene, settings } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!object) return;
    const copies = cloneSubtree(scene, object.id, createObjectId);
    const [x, y, z] = copies[0].transform.position;
    copies[0] = {
      ...copies[0],
      name: uniqueName(scene, object.name),
      transform: { ...copies[0].transform, position: [x + settings.gridSize * 2, y, z] },
    };
    this.run(new AddObjectsCommand(copies, object.parentId, indexInParent(scene, object.id) + 1, `Duplicate ${object.name}`));
  };

  /** Wraps the selected object in a new group at the same place in the hierarchy. */
  groupSelection = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!object) return;
    const group = createPartObject('group', { name: uniqueName(scene, 'Group') });
    const placed = { ...group, transform: { ...group.transform, position: [...object.transform.position] as Vec3 } };
    const index = indexInParent(scene, object.id);
    this.run(
      new CompositeCommand(
        `Group ${object.name}`,
        [new AddObjectsCommand([placed], object.parentId, index), new MoveObjectCommand(object.id, placed.id, 0)],
        placed.id,
      ),
    );
  };

  moveInHierarchy = (draggedId: string, targetId: string | null, position: DropPosition): void => {
    const drop = planDrop(this.store.getState().scene, draggedId, targetId, position);
    if (!drop) return;
    const { scene } = this.store.getState();
    const object = scene.objects[draggedId];
    if (object.parentId === drop.parentId && indexInParent(scene, draggedId) === drop.index) return;
    this.run(new MoveObjectCommand(draggedId, drop.parentId, drop.index));
  };

  rename = (id: string, name: string): void => {
    const object = this.store.getState().scene.objects[id];
    const trimmed = name.trim().slice(0, 200);
    if (object && trimmed && trimmed !== object.name) this.run(new RenameObjectCommand(id, object.name, trimmed));
  };

  setVisibility = (id: string, visible: boolean): void => {
    const object = this.store.getState().scene.objects[id];
    if (object && object.visible !== visible) this.run(new SetVisibilityCommand(id, visible, object.name));
  };

  /** Commits a colour. Pass `before` when the colour was already previewed live. */
  setColor = (id: string, color: string, before?: string): void => {
    const object = this.store.getState().scene.objects[id];
    if (object?.kind !== 'mesh') return;
    const from = before ?? object.material.color;
    if (this.lockedForEdit(id)) {
      if (before) this.store.previewColor(id, before);
      return;
    }
    if (from !== color) this.run(new SetColorCommand(id, from, color));
  };

  /** Commits a vertex edit that was previewed live (e.g. by dragging a field label). */
  commitGraph = (id: string, before: ConstructionGraph, after: ConstructionGraph, label: string): void => {
    if (before === after) return;
    if (this.lockedForEdit(id)) {
      this.store.previewGraph(id, before);
      return;
    }
    this.run(new SetGraphCommand(id, before, after, label));
  };

  commitTransform = (id: string, before: Transform, after: Transform, label = 'Edit transform'): void => {
    const cleaned = cleanTransform(after);
    if (!transformsEqual(before, cleaned) && this.lockedForEdit(id)) {
      this.store.previewTransform(id, before);
      return;
    }
    if (!transformsEqual(before, cleaned)) this.run(new SetTransformCommand(id, before, cleaned, label));
    else this.store.previewTransform(id, before);
  };

  // -- Drawings on the board (blueprints and bodies) --------------------------------

  /** The selected object when it is a blueprint, else null. */
  activeBlueprint = (): BlueprintObject | null => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    return isSketchMesh(object) ? object : null;
  };

  /** The drawing the board edits: the selected blueprint, or the current view of the selected body. */
  activeDrawing = (): ActiveDrawing | null => {
    const { selectedId, scene } = this.store.getState();
    return drawingOf(selectedId ? scene.objects[selectedId] : null, boardStore.getState().bodyView);
  };

  private nextColor(): string {
    const count = Object.values(this.store.getState().scene.objects).filter((object) => isDrawn(object)).length;
    return BLUEPRINT_COLORS[count % BLUEPRINT_COLORS.length];
  }

  /** Adds a blueprint holding `sketch` (drawn on its plane) and selects it. Returns its id. */
  createBlueprint = (sketch: Sketch, label = 'Start a blueprint', shape?: Partial<ShapeSettings>): string | null => {
    const { scene } = this.store.getState();
    const object = createBlueprintObject({ name: uniqueName(scene, 'Blueprint'), sketch, shape, color: this.nextColor() });
    return this.run(new AddObjectsCommand([object], null, undefined, label)) ? object.id : null;
  };

  /** Adds an empty body and opens its side view, ready to draw the outline with curves. */
  createBody = (): void => {
    const { scene } = this.store.getState();
    const object = createBodyObject({ name: uniqueName(scene, 'Body'), color: this.nextColor() });
    if (!this.run(new AddObjectsCommand([object], null, undefined, 'New body'))) return;
    boardStore.set({ bodyView: 'side', tool: 'curve', chainFrom: null, selectedPoints: [], selectedLines: [] });
    this.store.log(
      'info',
      'New body: draw its side view (the front of the object on the left), then its top view and, if you like, its front view. Each view is an outline; it lofts into one smooth solid.',
    );
  };

  /** Adds a ready-made car built from bodies and blueprints, all editable. */
  addTemplate = (id: TemplateId): void => {
    const { scene } = this.store.getState();
    // Park the new model beside whatever is already there, so models never overlap.
    const x = clearSpotX(scene, createTemplate(id));
    const objects = createTemplate(id, { groundPosition: [x, 0] });
    objects[0] = { ...objects[0], name: uniqueName(scene, objects[0].name) };
    if (this.run(new AddObjectsCommand(objects, null, undefined, `Add ${objects[0].name}`))) {
      this.viewport?.frameSelection();
      this.store.log('success', `Added ${objects[0].name} with ${objects.length - 1} parts. Pick its Body or Cabin and use the Side, Top and Front tabs to reshape it.`);
    }
  };

  /** Deselects so the next click on the board starts a new blueprint on `plane`. */
  startNewBlueprint = (plane?: SketchPlane): void => {
    this.store.select(null);
    boardStore.clearSelection();
    boardStore.set({ tool: isPenTool(boardStore.getState().tool) ? boardStore.getState().tool : 'draw', ...(plane ? { newPlane: plane } : {}) });
  };

  /**
   * Commits a new version of one drawing (a blueprint, or one view of a body). Pass
   * `before` when the drawing was previewed live (dragging dots), so undo returns to
   * where the drag started.
   */
  editDrawing = (id: string, view: BodyView | null, sketch: Sketch, label: string, before?: MeshSource): boolean => {
    const object = this.store.getState().scene.objects[id];
    if (!isDrawn(object)) return false;
    const from = before ?? object.source;
    if (from.type !== 'sketch' && from.type !== 'body') return false;
    if (this.lockedForEdit(id)) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    if (drawingIn(from, view) === sketch) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    return this.run(new SetSourceCommand(id, from, withDrawing(from, view, sketch), label));
  };

  /** Shows a drawing change live without recording it (dragging dots). */
  previewDrawing = (id: string, view: BodyView | null, sketch: Sketch, base: MeshSource): void => {
    if (base.type !== 'sketch' && base.type !== 'body') return;
    this.store.previewSource(id, withDrawing(base, view, sketch));
  };

  /** Changes how a drawing becomes 3D (flat, extrude, revolve, depth, segments, mirror). */
  setBlueprintShape = (id: string, patch: Partial<ShapeSettings>, before?: MeshSource, label?: string): boolean => {
    const object = this.store.getState().scene.objects[id];
    if (!isSketchMesh(object)) return false;
    const from = before ?? object.source;
    if (from.type !== 'sketch') return false;
    if (this.lockedForEdit(id)) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    const shape = clampShape({ ...from.shape, ...patch });
    const same = (Object.keys(shape) as (keyof ShapeSettings)[]).every((key) => shape[key] === from.shape[key]);
    if (same) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    return this.run(new SetSourceCommand(id, from, { type: 'sketch', sketch: from.sketch, shape }, label ?? `Shape ${object.name}`));
  };

  /** Live preview of shape settings (sliders); setBlueprintShape commits. */
  previewBlueprintShape = (id: string, patch: Partial<ShapeSettings>, base: MeshSource): void => {
    if (base.type !== 'sketch') return;
    this.store.previewSource(id, { ...base, shape: clampShape({ ...base.shape, ...patch }) });
  };

  /** Changes how a body is lofted (slices, points per slice, roundness, symmetry). */
  setBodySettings = (id: string, patch: Partial<BodySettings>, before?: MeshSource, label?: string): boolean => {
    const object = this.store.getState().scene.objects[id];
    if (!isBodyMesh(object)) return false;
    const from = before ?? object.source;
    if (from.type !== 'body') return false;
    if (this.lockedForEdit(id)) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    const body = clampBody({ ...from.body, ...patch });
    const same = (Object.keys(body) as (keyof BodySettings)[]).every((key) => body[key] === from.body[key]);
    if (same) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    return this.run(new SetSourceCommand(id, from, { ...from, body }, label ?? `Loft ${object.name}`));
  };

  previewBodySettings = (id: string, patch: Partial<BodySettings>, base: MeshSource): void => {
    if (base.type !== 'body') return;
    this.store.previewSource(id, { ...base, body: clampBody({ ...base.body, ...patch }) });
  };

  /** Smooth shading and modifiers (mirror, subdivision) for any mesh. */
  setMeshLook = (id: string, patch: { smooth?: boolean; modifiers?: Partial<MeshModifiers> }): void => {
    const object = this.store.getState().scene.objects[id];
    if (object?.kind !== 'mesh' || this.lockedForEdit(id)) return;
    const modifiers = cleanModifiers({ ...(object.modifiers ?? NO_MODIFIERS), ...patch.modifiers });
    // Turning subdivision on almost always wants a smooth look too.
    const startsSubdividing = patch.smooth === undefined && modifiers.subdivide > 0 && !(object.modifiers?.subdivide);
    const smooth = patch.smooth ?? (startsSubdividing ? true : !!object.material.smooth);
    const before = { modifiers: object.modifiers, smooth: !!object.material.smooth };
    const after = { modifiers: hasModifiers(modifiers) ? modifiers : undefined, smooth };
    if (before.smooth === after.smooth && JSON.stringify(before.modifiers ?? null) === JSON.stringify(after.modifiers ?? null)) return;
    const what = patch.smooth !== undefined ? (smooth ? 'Smooth shading' : 'Flat shading') : patch.modifiers?.subdivide !== undefined ? `Subdivide ${modifiers.subdivide}` : `Mirror ${modifiers.mirror}`;
    this.run(new SetMeshLookCommand(id, before, after, `${what} on ${object.name}`));
  };

  setBlueprintPlane = (id: string, plane: SketchPlane): void => {
    const object = this.store.getState().scene.objects[id];
    if (!isSketchMesh(object) || object.source.sketch.plane === plane) return;
    this.editDrawing(id, null, setPlane(object.source.sketch, plane), `Draw ${object.name} on the ${plane} plane`);
  };

  /** M: mirror a blueprint's drawing, or make a body symmetric (or not). */
  toggleMirror = (): void => {
    const drawing = this.activeDrawing();
    if (!drawing) {
      this.store.log('info', 'Select a blueprint or body to mirror its drawing.');
      return;
    }
    const { object } = drawing;
    if (object.source.type === 'body') {
      const symmetric = !object.source.body.symmetric;
      this.setBodySettings(object.id, { symmetric }, undefined, `${symmetric ? 'Symmetric' : 'Free'} ${object.name}`);
      return;
    }
    const mirror = !object.source.shape.mirror;
    this.setBlueprintShape(object.id, { mirror }, undefined, `${mirror ? 'Mirror' : 'Unmirror'} ${object.name}`);
  };

  /** S: makes the picked dots smooth (curves), or sharp again when they all are smooth. */
  toggleSmoothPicked = (): boolean => {
    const drawing = this.activeDrawing();
    const { selectedPoints, selectedLines } = boardStore.getState();
    if (!drawing) return false;
    const ids = new Set(selectedPoints);
    for (const id of selectedLines) {
      const line = drawing.sketch.lines[id];
      if (line) ids.add(line.a).add(line.b);
    }
    const picked = [...ids].filter((id) => drawing.sketch.points[id]);
    if (picked.length === 0) return false;
    const smooth = !picked.every((id) => drawing.sketch.points[id].smooth);
    this.editDrawing(drawing.object.id, drawing.view, setPointsSmooth(drawing.sketch, picked, smooth), `${smooth ? 'Smooth' : 'Sharpen'} ${plural(picked.length, 'dot')}`);
    return true;
  };

  /** Deletes the dots and lines picked on the board. Returns false when nothing was picked. */
  deleteBoardSelection = (): boolean => {
    const drawing = this.activeDrawing();
    const { selectedPoints, selectedLines } = boardStore.getState();
    if (!drawing || (selectedPoints.length === 0 && selectedLines.length === 0)) return false;
    const sketch = removeItems(drawing.sketch, selectedPoints, selectedLines);
    boardStore.clearSelection();
    const parts = [
      selectedPoints.length ? plural(selectedPoints.length, 'dot') : '',
      selectedLines.length ? plural(selectedLines.length, 'line') : '',
    ].filter(Boolean);
    this.editDrawing(drawing.object.id, drawing.view, sketch, `Delete ${parts.join(' and ')}`);
    return true;
  };

  /** Backspace while drawing: removes the dot just placed and continues from the one before it. */
  stepBackChain = (): boolean => {
    const drawing = this.activeDrawing();
    const { chainFrom, tool } = boardStore.getState();
    if (!drawing || !isPenTool(tool) || !chainFrom || !drawing.sketch.points[chainFrom]) return false;
    const sketch = drawing.sketch;
    const neighbours = Object.values(sketch.lines)
      .filter((line) => line.a === chainFrom || line.b === chainFrom)
      .map((line) => (line.a === chainFrom ? line.b : line.a));
    this.editDrawing(drawing.object.id, drawing.view, removeItems(sketch, [chainFrom], []), `Remove dot ${chainFrom}`);
    boardStore.set({ chainFrom: neighbours.length === 1 ? neighbours[0] : null });
    return true;
  };

  /** Delete key: picked dots and lines first, otherwise the selected object. */
  deleteContextual = (): void => {
    if (!this.deleteBoardSelection()) this.deleteSelection();
  };

  /** Turns a blueprint or body into a point-built mesh so its vertices can be edited one by one. */
  convertToPoints = (id?: string): void => {
    const object = id ? this.store.getState().scene.objects[id] : this.activeDrawing()?.object;
    if (!isDrawn(object) || this.lockedForEdit(object.id)) return;
    const graph = sourceGraphOf(object);
    if (!graph) return;
    if (this.run(new SetSourceCommand(object.id, object.source, { type: 'construction', graph }, `Convert ${object.name} to points`))) {
      boardStore.clearSelection();
      this.store.log('info', `${object.name} is now point-built: press Tab to edit its vertices. Undo turns it back into a drawing.`);
    }
  };

  // -- Group edits and exact sizes on the board --------------------------------------

  /** The dots picked on the board, plus both ends of picked lines. */
  pickedPointIds = (drawing: ActiveDrawing | null = this.activeDrawing()): string[] => {
    if (!drawing) return [];
    const { selectedPoints, selectedLines } = boardStore.getState();
    const ids = new Set(selectedPoints.filter((id) => drawing.sketch.points[id]));
    for (const id of selectedLines) {
      const line = drawing.sketch.lines[id];
      if (line) ids.add(line.a).add(line.b);
    }
    return [...ids];
  };

  /** Runs an edit on the picked dots as one undo step. Returns false when nothing is picked. */
  private editPicked(label: (count: number) => string, edit: (sketch: Sketch, ids: string[]) => Sketch): boolean {
    const drawing = this.activeDrawing();
    const ids = this.pickedPointIds(drawing);
    if (!drawing || ids.length === 0) return false;
    let next: Sketch;
    try {
      next = edit(drawing.sketch, ids);
    } catch (error) {
      this.store.log('warning', error instanceof Error ? error.message : String(error));
      return false;
    }
    this.editDrawing(drawing.object.id, drawing.view, next, label(ids.length));
    return true;
  }

  rotatePicked = (degrees: number): boolean =>
    this.editPicked((n) => `Rotate ${plural(n, 'dot')} ${Math.round(degrees * 100) / 100}°`, (sketch, ids) => rotatePoints(sketch, ids, degrees));

  flipPicked = (direction: FlipDirection): boolean =>
    this.editPicked((n) => `Flip ${plural(n, 'dot')} ${direction === 'horizontal' ? 'left to right' : 'upside down'}`, (sketch, ids) => flipPoints(sketch, ids, direction));

  scalePicked = (factor: number): boolean =>
    this.editPicked((n) => `Scale ${plural(n, 'dot')} to ${Math.round(factor * 1000) / 10}%`, (sketch, ids) => scalePoints(sketch, ids, factor));

  alignPicked = (edge: AlignEdge): boolean => this.editPicked((n) => `Align ${plural(n, 'dot')} ${edge}`, (sketch, ids) => alignPoints(sketch, ids, edge));

  distributePicked = (direction: FlipDirection): boolean =>
    this.editPicked((n) => `Space ${plural(n, 'dot')} evenly`, (sketch, ids) => distributePoints(sketch, ids, direction));

  /** Moves one picked dot to an exact position, or the middle of several picked dots. */
  movePickedTo = (x: number, y: number): boolean =>
    this.editPicked(
      (n) => (n === 1 ? 'Move dot to an exact position' : `Move ${plural(n, 'dot')} to an exact position`),
      (sketch, ids) => {
        if (ids.length === 1) return movePoint(sketch, ids[0], x, y);
        const [cx, cy] = pointsCentre(sketch, ids)!;
        return translatePoints(sketch, ids, x - cx, y - cy);
      },
    );

  /** Sets a line's exact length and/or angle (degrees, counter-clockwise from the board's x axis). */
  setLineSize = (lineId: string, size: { length?: number; angle?: number }): boolean => {
    const drawing = this.activeDrawing();
    if (!drawing || !drawing.sketch.lines[lineId]) return false;
    try {
      let next = drawing.sketch;
      if (size.angle !== undefined) next = setLineAngle(next, lineId, size.angle);
      if (size.length !== undefined) next = setLineLength(next, lineId, size.length);
      const what = size.length !== undefined ? `${Math.round(size.length * 1000) / 1000} m` : `${Math.round((size.angle ?? 0) * 100) / 100}°`;
      return this.editDrawing(drawing.object.id, drawing.view, next, `Set line ${lineId} to ${what}`);
    } catch (error) {
      this.store.log('warning', error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  /**
   * While drawing: places the next dot an exact distance and angle from the last one and
   * joins it, as if it had been clicked there. Returns false when no line is being drawn.
   */
  placeDotAt = (length: number, angle: number): boolean => {
    const drawing = this.activeDrawing();
    const { chainFrom, tool } = boardStore.getState();
    const from = chainFrom && drawing?.sketch.points[chainFrom];
    if (!drawing || !from || !(length > 0)) return false;
    const [x, y] = polarPoint([from.x, from.y], length, angle);
    const added = addPoint(drawing.sketch, x, y, tool === 'curve');
    const joined = addLine(added.sketch, from.id, added.pointId);
    if (!this.editDrawing(drawing.object.id, drawing.view, joined.sketch, `Draw a ${Math.round(length * 1000) / 1000} m line`)) return false;
    boardStore.set({ chainFrom: added.pointId });
    return true;
  };

  /** Ctrl+A on the board: picks every dot of the drawing. */
  selectAllDots = (): boolean => {
    const drawing = this.activeDrawing();
    if (!drawing) return false;
    boardStore.set({ tool: 'select', chainFrom: null, selectedPoints: allPointIds(drawing.sketch), selectedLines: Object.keys(drawing.sketch.lines) });
    return true;
  };

  /** How far copies land from the original: two board grid steps, at least 10 cm. */
  private copyStep(): number {
    return Math.max(0.1, boardStore.getState().snapSize * 2);
  }

  /** Ctrl+D on the board: copies the picked dots (and their lines) a little to the side and picks the copies. */
  duplicatePicked = (): boolean => {
    const drawing = this.activeDrawing();
    const ids = this.pickedPointIds(drawing);
    if (!drawing || ids.length === 0) return false;
    const step = this.copyStep();
    const copy = duplicatePoints(drawing.sketch, ids, step, -step);
    if (!this.editDrawing(drawing.object.id, drawing.view, copy.sketch, `Duplicate ${plural(ids.length, 'dot')}`)) return false;
    boardStore.set({ tool: 'select', chainFrom: null, selectedPoints: copy.pointIds, selectedLines: copy.lineIds });
    return true;
  };

  /** Ctrl+C: copies the picked dots, or else the selected object with its children. */
  copy = (): boolean => {
    const drawing = this.activeDrawing();
    const ids = this.pickedPointIds(drawing);
    if (drawing && ids.length) {
      const fragment = copyFragment(drawing.sketch, ids)!;
      clipboard.set({ kind: 'dots', fragment, origin: pointsCentre(drawing.sketch, ids)! });
      this.store.log('info', `Copied ${plural(ids.length, 'dot')}. Ctrl+V pastes them where the pointer is, in any drawing.`);
      return true;
    }
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!object) return false;
    clipboard.set({ kind: 'objects', name: object.name, objects: cloneSubtree(scene, object.id, createObjectId) });
    this.store.log('info', `Copied ${object.name}. Ctrl+V pastes a copy, in this project or another.`);
    return true;
  };

  /** Ctrl+V: pastes copied dots into the drawing (where the pointer is), or a copied object. */
  paste = (): boolean => {
    const content = clipboard.get();
    if (!content) return false;
    const n = clipboard.nextPasteIndex();
    if (content.kind === 'dots') {
      const step = this.copyStep();
      const at: [number, number] = boardPointer.position ?? [content.origin[0] + step * n, content.origin[1] - step * n];
      const drawing = this.activeDrawing();
      if (!drawing) {
        const pasted = pasteFragment(createSketch(content.fragment.plane), content.fragment, at);
        const id = this.createBlueprint(pasted.sketch, `Paste ${plural(pasted.pointIds.length, 'dot')}`);
        if (id) boardStore.set({ tool: 'select', chainFrom: null, selectedPoints: pasted.pointIds, selectedLines: pasted.lineIds });
        return !!id;
      }
      const pasted = pasteFragment(drawing.sketch, content.fragment, at);
      if (!this.editDrawing(drawing.object.id, drawing.view, pasted.sketch, `Paste ${plural(pasted.pointIds.length, 'dot')}`)) return false;
      boardStore.set({ tool: 'select', chainFrom: null, selectedPoints: pasted.pointIds, selectedLines: pasted.lineIds });
      return true;
    }
    const { scene, settings } = this.store.getState();
    const source = { objects: Object.fromEntries(content.objects.map((o) => [o.id, o])), rootIds: [content.objects[0].id] };
    const copies = cloneSubtree(source, content.objects[0].id, createObjectId);
    const [x, y, z] = copies[0].transform.position;
    const parentId = copies[0].parentId && scene.objects[copies[0].parentId] ? copies[0].parentId : null;
    copies[0] = {
      ...copies[0],
      parentId,
      name: uniqueName(scene, content.name),
      transform: { ...copies[0].transform, position: [x + settings.gridSize * 2 * n, y, z] },
    };
    return this.run(new AddObjectsCommand(copies, parentId, undefined, `Paste ${content.name}`));
  };

  /** Ctrl+D: duplicates picked dots on the board, or else the selected object. */
  duplicateContextual = (): void => {
    if (!this.duplicatePicked()) this.duplicateSelection();
  };

  // -- Locking ------------------------------------------------------------------------

  /** Locks or unlocks an object (default: the selected one). Locked objects cannot be picked in 3D, moved, edited or deleted. */
  toggleLock = (id?: string): void => {
    const { selectedId, scene } = this.store.getState();
    const object = scene.objects[id ?? selectedId ?? ''];
    if (!object) return;
    const locked = !object.locked;
    if (this.run(new SetLockCommand(object.id, locked, object.name))) {
      if (locked && object.id === selectedId) boardStore.clearSelection();
      this.store.log('info', locked ? `${object.name} is locked: it cannot be picked in the 3D view or changed until you unlock it.` : `${object.name} is unlocked.`);
    }
  };

  // -- Snapshots (saved versions) --------------------------------------------------------

  saveSnapshot = (name?: string): void => {
    const { scene, snapshots } = this.store.getState();
    const snapshot = createSnapshot(scene, name ?? nextSnapshotName(snapshots), randomId('snap'));
    this.store.setSnapshots(addSnapshot(snapshots, snapshot));
    this.store.log('success', `Saved version “${snapshot.name}”. Restore it any time from Versions; it is kept in the project file.`);
  };

  restoreSnapshot = (id: string): void => {
    const { scene, snapshots } = this.store.getState();
    const snapshot = snapshots.find((s) => s.id === id);
    if (!snapshot) return;
    boardStore.clearSelection();
    if (this.run(new ReplaceSceneCommand(scene, snapshot.scene, `Restore ${snapshot.name}`))) {
      this.viewport?.frameSelection();
      this.store.log('success', `Restored “${snapshot.name}”. Undo (Ctrl+Z) brings back what you had before.`);
    }
  };

  renameSnapshot = (id: string, name: string): void => {
    this.store.setSnapshots(renameSnapshot(this.store.getState().snapshots, id, name));
  };

  deleteSnapshot = async (id: string): Promise<void> => {
    const snapshot = this.store.getState().snapshots.find((s) => s.id === id);
    if (!snapshot) return;
    if (!(await this.files.confirm('Delete version', `Delete the saved version “${snapshot.name}”? This cannot be undone.`))) return;
    this.store.setSnapshots(removeSnapshot(this.store.getState().snapshots, id));
  };

  // -- My Parts (the shared library) --------------------------------------------------------

  /** Saves the selected object (with its children) to My Parts, with a small picture. */
  saveToLibrary = async (options: { id?: string; name?: string; overwrite?: boolean } = {}): Promise<boolean> => {
    const { selectedId, scene } = this.store.getState();
    const id = options.id ?? selectedId;
    const object = id ? scene.objects[id] : undefined;
    if (!object) {
      this.store.log('info', 'Select an object to save it to My Parts.');
      return false;
    }
    const thumbnail = this.viewport?.captureObject(object.id, 256) ?? undefined;
    const part = libraryPartFromScene(scene, object.id, { name: options.name, thumbnail });
    try {
      const file = await this.files.library.write(part, options.overwrite ?? false);
      uiStore.libraryChanged();
      this.store.log('success', `Saved ${part.name} to My Parts (${file}). Every project can add it from there.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.overwrite && message.includes('already has') && (await this.files.confirm('Replace part', `${message} Replace it?`))) {
        return this.saveToLibrary({ ...options, id: object.id, overwrite: true });
      }
      this.store.log('warning', `${part.name} was not saved to My Parts.`, message);
      return false;
    }
  };

  /** Adds a copy of a My Parts part to the scene, clear of everything else, and selects it. */
  addFromLibrary = async (file: string): Promise<void> => {
    let part;
    try {
      part = await this.files.library.read(file);
    } catch (error) {
      this.store.log('warning', 'That part could not be read.', error instanceof Error ? error.message : String(error));
      return;
    }
    const { scene } = this.store.getState();
    const objects = instantiateLibraryPart(part, createObjectId);
    const root = objects[0];
    const [, y, z] = root.transform.position;
    objects[0] = { ...root, name: uniqueName(scene, part.name), transform: { ...root.transform, position: [clearSpotX(scene, objects), y, z] } };
    if (this.run(new AddObjectsCommand(objects, null, undefined, `Add ${part.name} from My Parts`))) this.viewport?.frameSelection();
  };

  removeFromLibrary = async (file: string, name: string): Promise<void> => {
    if (!(await this.files.confirm('Delete part', `Delete ${name} from My Parts? Projects that already use it keep their copy.`))) return;
    try {
      await this.files.library.remove(file);
      uiStore.libraryChanged();
    } catch (error) {
      this.store.log('warning', `${name} could not be deleted.`, error instanceof Error ? error.message : String(error));
    }
  };

  revealLibrary = async (): Promise<void> => {
    const folders = await this.files.folders().catch(() => null);
    if (!folders) return;
    await this.files.reveal(folders.library).catch((error) => this.store.log('warning', 'The folder could not be opened.', String(error)));
  };

  // -- Start screen --------------------------------------------------------------------------

  /** Starts from the start screen: a blank board, or a ready-made car opened on its body's side view. */
  startWith = (choice: 'blank' | TemplateId): void => {
    uiStore.set({ startOpen: false });
    const { dirty } = this.store.getState();
    if (!dirty) this.store.loadDocument(createEmptyDocument(), choice === 'blank' ? 'Untitled' : getTemplateName(choice), null);
    if (choice === 'blank') {
      boardStore.set({ tool: 'draw', chainFrom: null, selectedPoints: [], selectedLines: [] });
      return;
    }
    this.addTemplate(choice);
    const { scene } = this.store.getState();
    const body = Object.values(scene.objects).find((o) => o.name === 'Body' && isBodyMesh(o));
    if (body) {
      this.store.select(body.id);
      boardStore.set({ bodyView: 'side', tool: 'curve', chainFrom: null, selectedPoints: [], selectedLines: [] });
    }
  };

  // -- AI assistants ------------------------------------------------------------------------

  /** Installs the MCP server and adds FORGEX to Claude Desktop. Returns a summary for the panel. */
  connectClaudeDesktop = async (): Promise<string | null> => {
    if (!this.files.ai) return null;
    try {
      const result = await this.files.ai.connectClaudeDesktop();
      const where = result.configs.map((c) => c.path).join(' and ');
      this.store.log('success', 'FORGEX is set up in Claude Desktop. Quit Claude completely (tray icon > Quit) and open it again to load it.', `Runs: ${result.entry.command} ${result.entry.args.join(' ')}\nConfig: ${where}`);
      return where;
    } catch (error) {
      this.store.log('error', 'Claude Desktop could not be set up.', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  // -- Reference pictures -------------------------------------------------------------

  /** Loads a picture to trace over on the given plane, sized to a typical car length. */
  addReference = async (file: File, plane: SketchPlane): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      this.store.log('warning', `${file.name} is not a picture. Use a PNG, JPEG or WebP image.`);
      return;
    }
    if (file.size > (MAX_REFERENCE_CHARS * 3) / 4) {
      this.store.log('warning', `${file.name} is too large for a reference picture (limit about 18 MB).`);
      return;
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read.'));
        reader.readAsDataURL(file);
      });
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('The picture could not be decoded.'));
        image.src = src;
      });
      const reference = createReference({
        id: `ref_${createObjectId().slice(4)}`,
        plane,
        name: file.name.replace(/\.[^.]+$/, ''),
        src,
        aspect: size.height / size.width,
        width: plane === 'front' ? 2.2 : 4.6,
      });
      this.store.setReferences([...this.store.getState().references, reference]);
      boardStore.set({ adjustingReference: reference.id, referencesOpen: true });
      this.store.log('info', `Added ${reference.name} behind the ${plane} view. Drag it on the board to line it up, and set its width to the real length.`);
    } catch (error) {
      this.store.log('error', `${file.name} could not be loaded.`, error instanceof Error ? error.message : String(error));
    }
  };

  updateReference = (id: string, patch: Partial<Omit<ReferenceImage, 'id' | 'src'>>): void => {
    const references = this.store.getState().references;
    if (!references.some((r) => r.id === id)) return;
    this.store.setReferences(references.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  removeReference = (id: string): void => {
    const references = this.store.getState().references;
    this.store.setReferences(references.filter((r) => r.id !== id));
    if (boardStore.getState().adjustingReference === id) boardStore.set({ adjustingReference: null });
  };

  toggleTurntable = (): void => {
    boardStore.set({ turntable: !boardStore.getState().turntable });
  };

  /** Exports the visible scene as a .glb for Blender or Roblox Studio. */
  exportGlb = async (): Promise<void> => {
    const { scene, project } = this.store.getState();
    let path: string | null;
    try {
      path = await this.files.chooseExportPath(`${project.name || 'Untitled'}.glb`);
    } catch (error) {
      this.store.log('error', 'The export dialog could not open.', String(error));
      return;
    }
    if (!path) return;
    if (!path.toLowerCase().endsWith('.glb')) path = `${path}.glb`;
    try {
      const { exportSceneToGlb } = await import('../viewport/exportGlb');
      const result = await exportSceneToGlb(scene, project.name || 'FORGEX model');
      await this.files.writeExportFile(path, result.bytes);
      const size = result.bytes.byteLength < 1024 * 1024 ? `${Math.max(1, Math.round(result.bytes.byteLength / 1024))} KB` : `${(result.bytes.byteLength / (1024 * 1024)).toFixed(1)} MB`;
      const where = this.files.kind === 'desktop' ? path : `${fileNameFromPath(path)} (downloaded)`;
      this.store.log(
        'success',
        `Exported ${plural(result.meshes, 'mesh', 'meshes')} (${result.triangles.toLocaleString()} triangles, ${size}) to ${where}.`,
        'Blender: File > Import > glTF 2.0 (.glb). Roblox Studio: Avatar or Home tab > Import 3D. Units are metres; Roblox scales 1 m to about 3.57 studs.',
      );
    } catch (error) {
      this.store.log('error', 'Export failed. Nothing was written.', error instanceof Error ? error.message : String(error));
    }
  };

  // -- Points mode --------------------------------------------------------------

  togglePointsMode = (): void => {
    const { editMode } = this.store.getState();
    this.store.setEditMode(editMode === 'points' ? 'object' : 'points');
  };

  setVertexPosition = (objectId: string, vertexId: string, position: Vec3): void => {
    const object = this.store.getState().scene.objects[objectId];
    if (!isConstructionMesh(object) || this.lockedForEdit(objectId)) return;
    const graph = object.source.graph;
    const current = graph.vertices[vertexId]?.position;
    const next = cleanVec3(position);
    if (!current || equals(current, next)) return;
    this.run(new SetGraphCommand(objectId, graph, moveVertex(graph, vertexId, next), `Move vertex ${vertexId}`));
  };

  fillLoops = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!isConstructionMesh(object) || this.lockedForEdit(object.id)) return;
    const result = fillClosedLoops(object.source.graph);
    if (result.faceIds.length === 0) {
      this.store.log('info', `${object.name} has no open closed loops to fill.`);
      return;
    }
    this.run(new SetGraphCommand(object.id, object.source.graph, result.graph, `Fill ${plural(result.faceIds.length, 'loop')}`));
    if (result.truncated) this.store.log('warning', 'The loop search stopped early on a very dense graph; some loops may be unfilled.');
  };

  recalculateNormals = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!isConstructionMesh(object) || this.lockedForEdit(object.id)) return;
    const { graph, flipped } = orientFaces(object.source.graph);
    if (flipped.length === 0) {
      this.store.log('info', `Normals on ${object.name} were already consistent.`);
      return;
    }
    this.run(new SetGraphCommand(object.id, object.source.graph, graph, `Recalculate normals (${plural(flipped.length, 'face')} flipped)`));
  };

  checkGeometry = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!isConstructionMesh(object)) return;
    const report = analyzeGraph(object.source.graph);
    const problems = report.issues.filter((issue) => issue.severity !== 'info');
    const summary = `${plural(report.vertices, 'vertex')}, ${plural(report.edges, 'edge')}, ${plural(report.faces, 'face')}`;
    if (problems.length === 0) {
      this.store.log('success', `${object.name} passed the geometry check (${summary}, ${report.closed ? 'closed' : 'open'}).`);
    } else {
      this.store.log('warning', `${object.name}: ${plural(problems.length, 'geometry problem')} (${summary}).`, problems.map((p) => p.message).join('\n'));
    }
  };

  // -- Editing ------------------------------------------------------------------

  undo = (): void => {
    this.store.undo();
  };

  redo = (): void => {
    this.store.redo();
  };

  setTool = (tool: ToolMode): void => {
    this.store.setTool(tool);
  };

  select = (id: string | null): void => {
    this.store.select(id);
  };

  frameSelection = (): void => {
    this.viewport?.frameSelection();
  };

  /** Selects an object and frames it in the 3D view (quick search, the parts list). */
  selectAndFrame = (id: string): void => {
    this.store.select(id);
    this.viewport?.frameSelection();
  };

  setViewPreset = (view: ViewPreset): void => {
    if (view !== 'current') this.viewport?.lookFrom(view);
  };

  /** Esc: cancel a drag, finish a line chain, clear picked dots, step out of points mode, then deselect. */
  escape = (): void => {
    if (this.viewport?.cancelActiveDrag()) return;
    const board = boardStore.getState();
    if (board.chainFrom) {
      boardStore.set({ chainFrom: null });
      return;
    }
    if (boardStore.hasSelection) {
      boardStore.clearSelection();
      return;
    }
    const { editMode, selectedVertexId } = this.store.getState();
    if (editMode === 'points') {
      if (selectedVertexId) this.store.selectVertex(null);
      else this.store.setEditMode('object');
      return;
    }
    this.store.select(null);
  };
}
