import type { Command } from '../commands/command';
import type { ConstructionGraph } from '../geometry/constructionGraph';
import { CommandHistory, type HistoryEntry } from '../history/history';
import type { Transform } from '../math/transform';
import { createDefaultDocument } from '../project/defaultDocument';
import type { CameraState, ProjectDocument, ProjectSettings } from '../project/projectFile';
import type { ReferenceImage } from '../project/references';
import { setObjectTransform, updateObject } from '../scene/scene';
import { isConstructionMesh, type MeshSource, type Scene } from '../scene/types';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type EditMode = 'object' | 'points';
export type MessageLevel = 'info' | 'success' | 'warning' | 'error';

export interface DiagnosticMessage {
  id: number;
  level: MessageLevel;
  text: string;
  detail?: string;
  time: number;
}

export interface HistoryItem {
  seq: number;
  label: string;
}

export interface HistorySummary {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  past: HistoryItem[];
  future: HistoryItem[];
  revision: number;
}

export interface ProjectInfo {
  /** Display name, e.g. "Car". */
  name: string;
  /** Full path on disk, or null when the project has never been saved to a known location. */
  path: string | null;
  /** History revision at the last save or load. */
  savedRevision: number;
  settingsDirty: boolean;
}

export interface EditorState {
  scene: Scene;
  selectedId: string | null;
  editMode: EditMode;
  selectedVertexId: string | null;
  tool: ToolMode;
  settings: ProjectSettings;
  /** Pictures to trace over on the board (saved in the project). */
  references: readonly ReferenceImage[];
  project: ProjectInfo;
  history: HistorySummary;
  /** `revision` changes whenever a loaded project asks the viewport to apply a camera view. */
  camera: { view: CameraState | null; revision: number };
  messages: DiagnosticMessage[];
  /** True when there are changes that have not been saved. */
  dirty: boolean;
}

const MAX_MESSAGES = 200;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The single source of editor state. It holds no UI or rendering code, so it can be
 * tested on its own and drive any front end through subscribe/getState.
 */
export class EditorStore {
  private history = new CommandHistory(500);
  private listeners = new Set<() => void>();
  private messageSeq = 0;
  private state: EditorState;

  constructor(document: ProjectDocument = createDefaultDocument(), name = 'Untitled', path: string | null = null) {
    this.state = this.freshState(document, name, path, [], 0);
  }

  // -- Subscription ---------------------------------------------------------

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private commit(patch: Partial<EditorState>): void {
    const next = { ...this.state, ...patch };
    next.dirty = this.history.revision !== next.project.savedRevision || next.project.settingsDirty;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private summarizeHistory(): HistorySummary {
    const toItem = (entry: HistoryEntry): HistoryItem => ({ seq: entry.seq, label: entry.command.label });
    const past = this.history.undoEntries.map(toItem);
    const future = this.history.redoEntries.map(toItem);
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past.length ? past[past.length - 1].label : null,
      redoLabel: future.length ? future[0].label : null,
      past,
      future,
      revision: this.history.revision,
    };
  }

  private freshState(
    document: ProjectDocument,
    name: string,
    path: string | null,
    messages: DiagnosticMessage[],
    cameraRevision: number,
  ): EditorState {
    return {
      scene: document.scene,
      selectedId: null,
      editMode: 'object',
      selectedVertexId: null,
      tool: this.state?.tool ?? 'select',
      settings: { ...document.settings },
      references: document.references ?? [],
      project: { name, path, savedRevision: this.history.revision, settingsDirty: false },
      history: this.summarizeHistory(),
      camera: { view: document.camera, revision: cameraRevision + 1 },
      messages,
      dirty: false,
    };
  }

  /** Keeps selection, edit mode and vertex selection valid for a scene. */
  private selectionFor(scene: Scene, selectedId: string | null): Pick<EditorState, 'selectedId' | 'editMode' | 'selectedVertexId'> {
    const object = selectedId ? scene.objects[selectedId] : undefined;
    if (!object) return { selectedId: null, editMode: 'object', selectedVertexId: null };
    const sameObject = selectedId === this.state.selectedId;
    const keepPoints = sameObject && this.state.editMode === 'points' && isConstructionMesh(object);
    const vertex = this.state.selectedVertexId;
    const keepVertex = keepPoints && vertex !== null && isConstructionMesh(object) && !!object.source.graph.vertices[vertex];
    return {
      selectedId,
      editMode: keepPoints ? 'points' : 'object',
      selectedVertexId: keepVertex ? vertex : null,
    };
  }

  // -- Commands, undo and redo -----------------------------------------------

  /** Applies a command and records it for undo. Returns false (and logs why) if it failed. */
  execute(command: Command): boolean {
    let scene: Scene;
    try {
      scene = command.apply(this.state.scene);
    } catch (error) {
      this.log('error', `${command.label} failed.`, describeError(error));
      return false;
    }
    const wanted = command.selectAfterApply !== undefined ? command.selectAfterApply : this.state.selectedId;
    const selection = this.selectionFor(scene, wanted);
    this.history.record(command, this.state.selectedId, selection.selectedId);
    this.commit({ scene, ...selection, history: this.summarizeHistory() });
    return true;
  }

  undo(): boolean {
    const entry = this.history.undo();
    if (!entry) return false;
    try {
      const scene = entry.command.revert(this.state.scene);
      this.commit({ scene, ...this.selectionFor(scene, entry.selectionBefore), history: this.summarizeHistory() });
      return true;
    } catch (error) {
      this.history.redo();
      this.log('error', `Undo “${entry.command.label}” failed.`, describeError(error));
      return false;
    }
  }

  redo(): boolean {
    const entry = this.history.redo();
    if (!entry) return false;
    try {
      const scene = entry.command.apply(this.state.scene);
      this.commit({ scene, ...this.selectionFor(scene, entry.selectionAfter), history: this.summarizeHistory() });
      return true;
    } catch (error) {
      this.history.undo();
      this.log('error', `Redo “${entry.command.label}” failed.`, describeError(error));
      return false;
    }
  }

  get revision(): number {
    return this.history.revision;
  }

  // -- Live previews (not recorded; a command commits the final value) --------

  previewTransform(id: string, transform: Transform): void {
    if (!this.state.scene.objects[id]) return;
    this.commit({ scene: setObjectTransform(this.state.scene, id, transform) });
  }

  /** Live preview of a mesh source (e.g. dragging a dot on the board); a command commits the final value. */
  previewSource(id: string, source: MeshSource): void {
    const object = this.state.scene.objects[id];
    if (object?.kind !== 'mesh') return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, source })) });
  }

  previewColor(id: string, color: string): void {
    const object = this.state.scene.objects[id];
    if (object?.kind !== 'mesh') return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, material: { ...object.material, color } })) });
  }

  previewGraph(id: string, graph: ConstructionGraph): void {
    const object = this.state.scene.objects[id];
    if (!isConstructionMesh(object)) return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, source: { type: 'construction', graph } })) });
  }

  // -- Selection and modes ----------------------------------------------------

  select(id: string | null): void {
    if (id === this.state.selectedId) return;
    const object = id ? this.state.scene.objects[id] : undefined;
    this.commit({ selectedId: object ? id : null, editMode: 'object', selectedVertexId: null });
  }

  selectVertex(vertexId: string | null): void {
    if (this.state.editMode !== 'points') return;
    this.commit({ selectedVertexId: vertexId });
  }

  /** Switches between object mode and points mode. Points mode needs a point-built object. */
  setEditMode(mode: EditMode): boolean {
    if (mode === this.state.editMode) return true;
    if (mode === 'points') {
      const object = this.state.selectedId ? this.state.scene.objects[this.state.selectedId] : undefined;
      if (!isConstructionMesh(object)) {
        this.log('warning', 'Select a point-built object (a Cube or Plane) to edit its vertices. Blueprints are edited on the board, or use Convert to points.');
        return false;
      }
    }
    this.commit({ editMode: mode, selectedVertexId: null });
    return true;
  }

  setTool(tool: ToolMode): void {
    if (tool !== this.state.tool) this.commit({ tool });
  }

  updateSettings(patch: Partial<ProjectSettings>): void {
    const settings = { ...this.state.settings, ...patch };
    if (!(settings.gridSize > 0) || !(settings.rotationSnapDegrees > 0)) return;
    this.commit({ settings, project: { ...this.state.project, settingsDirty: true } });
  }

  /** Replaces the reference pictures. They are saved with the project but are not part of undo. */
  setReferences(references: readonly ReferenceImage[]): void {
    if (references === this.state.references) return;
    this.commit({ references, project: { ...this.state.project, settingsDirty: true } });
  }

  setCameraView(view: CameraState): void {
    this.state = { ...this.state, camera: { ...this.state.camera, view } };
  }

  // -- Projects -------------------------------------------------------------

  /** Replaces the whole project (new or opened). Clears undo history. */
  loadDocument(document: ProjectDocument, name: string, path: string | null): void {
    this.history.clear();
    this.state = this.freshState(document, name, path, this.state.messages, this.state.camera.revision);
    this.listeners.forEach((listener) => listener());
  }

  /** Records a successful save. Edits made while the save was running stay unsaved. */
  markSaved(
    name: string,
    path: string | null,
    savedRevision: number,
    savedSettings: ProjectSettings,
    savedReferences: readonly ReferenceImage[] = this.state.references,
  ): void {
    this.commit({
      project: { name, path, savedRevision, settingsDirty: this.state.settings !== savedSettings || this.state.references !== savedReferences },
    });
  }

  toDocument(): ProjectDocument {
    const document: ProjectDocument = { scene: this.state.scene, settings: this.state.settings, camera: this.state.camera.view };
    if (this.state.references.length) document.references = this.state.references;
    return document;
  }

  // -- Diagnostics ------------------------------------------------------------

  log(level: MessageLevel, text: string, detail?: string): void {
    const message: DiagnosticMessage = { id: ++this.messageSeq, level, text, detail, time: Date.now() };
    this.commit({ messages: [...this.state.messages, message].slice(-MAX_MESSAGES) });
  }

  clearMessages(): void {
    this.commit({ messages: [] });
  }
}
