import { CompositeCommand, type Command } from '../core/commands/command';
import {
  AddObjectsCommand,
  DeleteObjectCommand,
  MoveObjectCommand,
  RenameObjectCommand,
  SetColorCommand,
  SetGraphCommand,
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
import { BLUEPRINT_COLORS, createBlueprintObject, createPartObject, getPart, type PartId } from '../core/scene/parts';
import { cloneSubtree, indexInParent, planDrop, uniqueName, type DropPosition } from '../core/scene/scene';
import { isConstructionMesh, isSketchMesh, meshGraphOf, type MeshObject, type MeshSource } from '../core/scene/types';
import { clampShape, removeItems, setPlane, type ShapeSettings, type Sketch, type SketchPlane } from '../core/sketch/sketch';
import type { PlatformFiles } from '../platform/files';
import { boardStore } from './boardState';

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
    this.store.markSaved(projectNameFromPath(path), savedPath, revision, state.settings);
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

  // -- Blueprints (the drawing board) ----------------------------------------------

  /** The selected object when it is a blueprint, else null. */
  activeBlueprint = (): BlueprintObject | null => {
    const { selectedId, scene } = this.store.getState();
    const object = selectedId ? scene.objects[selectedId] : undefined;
    return isSketchMesh(object) ? object : null;
  };

  /** Adds a blueprint holding `sketch` (drawn on its plane) and selects it. Returns its id. */
  createBlueprint = (sketch: Sketch, label = 'Start a blueprint', shape?: Partial<ShapeSettings>): string | null => {
    const { scene } = this.store.getState();
    const count = Object.values(scene.objects).filter((object) => isSketchMesh(object)).length;
    const object = createBlueprintObject({
      name: uniqueName(scene, 'Blueprint'),
      sketch,
      shape,
      color: BLUEPRINT_COLORS[count % BLUEPRINT_COLORS.length],
    });
    return this.run(new AddObjectsCommand([object], null, undefined, label)) ? object.id : null;
  };

  /** Deselects so the next click on the board starts a new blueprint on `plane`. */
  startNewBlueprint = (plane?: SketchPlane): void => {
    this.store.select(null);
    boardStore.clearSelection();
    boardStore.set({ tool: 'draw', ...(plane ? { newPlane: plane } : {}) });
  };

  /**
   * Commits a new drawing for a blueprint. Pass `before` when the drawing was previewed
   * live (dragging dots), so undo returns to where the drag started.
   */
  editBlueprint = (id: string, sketch: Sketch, label: string, before?: MeshSource): boolean => {
    const object = this.store.getState().scene.objects[id];
    if (!isSketchMesh(object)) return false;
    const from = before ?? object.source;
    if (from.type !== 'sketch') return false;
    if (from.sketch === sketch) {
      if (before) this.store.previewSource(id, before);
      return false;
    }
    return this.run(new SetSourceCommand(id, from, { type: 'sketch', sketch, shape: from.shape }, label));
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

  setBlueprintPlane = (id: string, plane: SketchPlane): void => {
    const object = this.store.getState().scene.objects[id];
    if (!isSketchMesh(object) || object.source.sketch.plane === plane) return;
    this.editBlueprint(id, setPlane(object.source.sketch, plane), `Draw ${object.name} on the ${plane} plane`);
  };

  toggleMirror = (): void => {
    const blueprint = this.activeBlueprint();
    if (!blueprint) {
      this.store.log('info', 'Select a blueprint to mirror its drawing.');
      return;
    }
    const mirror = !blueprint.source.shape.mirror;
    this.setBlueprintShape(blueprint.id, { mirror }, undefined, `${mirror ? 'Mirror' : 'Unmirror'} ${blueprint.name}`);
  };

  /** Deletes the dots and lines picked on the board. Returns false when nothing was picked. */
  deleteBoardSelection = (): boolean => {
    const blueprint = this.activeBlueprint();
    const { selectedPoints, selectedLines } = boardStore.getState();
    if (!blueprint || (selectedPoints.length === 0 && selectedLines.length === 0)) return false;
    const sketch = removeItems(blueprint.source.sketch, selectedPoints, selectedLines);
    boardStore.clearSelection();
    const parts = [
      selectedPoints.length ? plural(selectedPoints.length, 'dot') : '',
      selectedLines.length ? plural(selectedLines.length, 'line') : '',
    ].filter(Boolean);
    this.editBlueprint(blueprint.id, sketch, `Delete ${parts.join(' and ')}`);
    return true;
  };

  /** Backspace while drawing: removes the dot just placed and continues from the one before it. */
  stepBackChain = (): boolean => {
    const blueprint = this.activeBlueprint();
    const { chainFrom, tool } = boardStore.getState();
    if (!blueprint || tool !== 'draw' || !chainFrom || !blueprint.source.sketch.points[chainFrom]) return false;
    const sketch = blueprint.source.sketch;
    const neighbours = Object.values(sketch.lines)
      .filter((line) => line.a === chainFrom || line.b === chainFrom)
      .map((line) => (line.a === chainFrom ? line.b : line.a));
    this.editBlueprint(blueprint.id, removeItems(sketch, [chainFrom], []), `Remove dot ${chainFrom}`);
    boardStore.set({ chainFrom: neighbours.length === 1 ? neighbours[0] : null });
    return true;
  };

  /** Delete key: picked dots and lines first, otherwise the selected object. */
  deleteContextual = (): void => {
    if (!this.deleteBoardSelection()) this.deleteSelection();
  };

  /** Turns a blueprint into a point-built mesh so its vertices can be edited one by one. */
  convertToPoints = (id?: string): void => {
    const object = id ? this.store.getState().scene.objects[id] : this.activeBlueprint();
    if (!isSketchMesh(object)) return;
    const graph = meshGraphOf(object);
    if (!graph) return;
    if (this.run(new SetSourceCommand(object.id, object.source, { type: 'construction', graph }, `Convert ${object.name} to points`))) {
      boardStore.clearSelection();
      this.store.log('info', `${object.name} is now point-built: press Tab to edit its vertices. Undo turns it back into a blueprint.`);
    }
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
