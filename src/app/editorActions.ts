import { CompositeCommand, type Command } from '../core/commands/command';
import {
  AddObjectsCommand,
  DeleteObjectCommand,
  MoveObjectCommand,
  RenameObjectCommand,
  SetColorCommand,
  SetGraphCommand,
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
import { createObjectId } from '../core/ids';
import { cleanTransform, transformsEqual, type Transform } from '../core/math/transform';
import { cleanVec3, equals, snapScalar, type Vec3 } from '../core/math/vec3';
import { createDefaultDocument, createEmptyDocument } from '../core/project/defaultDocument';
import { ensureProjectExtension, fileNameFromPath, projectNameFromPath } from '../core/project/paths';
import { parseProject, serializeProject } from '../core/project/projectFile';
import { cleanModifiers, hasModifiers, NO_MODIFIERS, type MeshModifiers } from '../core/geometry/modifiers';
import { createReference, MAX_REFERENCE_CHARS, type ReferenceImage } from '../core/project/references';
import { BLUEPRINT_COLORS, createBlueprintObject, createBodyObject, createPartObject, getPart, type PartId } from '../core/scene/parts';
import { cloneSubtree, indexInParent, planDrop, sceneBounds, uniqueName, type DropPosition } from '../core/scene/scene';
import { createTemplate, type TemplateId } from '../core/scene/templates';
import { isBodyMesh, isConstructionMesh, isSketchMesh, sourceGraphOf, type MeshObject, type MeshSource } from '../core/scene/types';
import { clampBody, type BodySettings, type BodyView } from '../core/sketch/body';
import { clampShape, removeItems, setPlane, setPointsSmooth, type ShapeSettings, type Sketch, type SketchPlane } from '../core/sketch/sketch';
import type { PlatformFiles } from '../platform/files';
import { boardStore, isPenTool } from './boardState';
import { drawingIn, drawingOf, isDrawn, withDrawing, type ActiveDrawing } from './drawing';

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
    this.store.markSaved(projectNameFromPath(path), savedPath, revision, state.settings, state.references);
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
    if (object) this.run(new DeleteObjectCommand(object.id, object.name));
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
    if (from !== color) this.run(new SetColorCommand(id, from, color));
  };

  /** Commits a vertex edit that was previewed live (e.g. by dragging a field label). */
  commitGraph = (id: string, before: ConstructionGraph, after: ConstructionGraph, label: string): void => {
    if (before === after) return;
    this.run(new SetGraphCommand(id, before, after, label));
  };

  commitTransform = (id: string, before: Transform, after: Transform, label = 'Edit transform'): void => {
    const cleaned = cleanTransform(after);
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
    const bounds = sceneBounds(scene);
    const probe = createTemplate(id);
    const probeBounds = sceneBounds({ objects: Object.fromEntries(probe.map((o) => [o.id, o])), rootIds: [probe[0].id] });
    const halfWidth = probeBounds ? (probeBounds[1][0] - probeBounds[0][0]) / 2 : 1;
    const x = bounds ? Math.ceil(bounds[1][0] + 1 + halfWidth) : 0;
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
    if (object?.kind !== 'mesh') return;
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
    if (!isDrawn(object)) return;
    const graph = sourceGraphOf(object);
    if (!graph) return;
    if (this.run(new SetSourceCommand(object.id, object.source, { type: 'construction', graph }, `Convert ${object.name} to points`))) {
      boardStore.clearSelection();
      this.store.log('info', `${object.name} is now point-built: press Tab to edit its vertices. Undo turns it back into a drawing.`);
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
    if (!isConstructionMesh(object)) return;
    const graph = object.source.graph;
    const current = graph.vertices[vertexId]?.position;
    const next = cleanVec3(position);
    if (!current || equals(current, next)) return;
    this.run(new SetGraphCommand(objectId, graph, moveVertex(graph, vertexId, next), `Move vertex ${vertexId}`));
  };

  fillLoops = (): void => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!isConstructionMesh(object)) return;
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
    if (!isConstructionMesh(object)) return;
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
