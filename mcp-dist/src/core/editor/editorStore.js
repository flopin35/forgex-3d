"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditorStore = void 0;
const history_1 = require("../history/history");
const defaultDocument_1 = require("../project/defaultDocument");
const scene_1 = require("../scene/scene");
const types_1 = require("../scene/types");
const MAX_MESSAGES = 200;
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * The single source of editor state. It holds no UI or rendering code, so it can be
 * tested on its own and drive any front end through subscribe/getState.
 */
class EditorStore {
    history = new history_1.CommandHistory(500);
    listeners = new Set();
    messageSeq = 0;
    state;
    constructor(document = (0, defaultDocument_1.createDefaultDocument)(), name = 'Untitled', path = null) {
        this.state = this.freshState(document, name, path, [], 0);
    }
    // -- Subscription ---------------------------------------------------------
    getState = () => this.state;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    commit(patch) {
        const next = { ...this.state, ...patch };
        next.dirty = this.history.revision !== next.project.savedRevision || next.project.settingsDirty;
        this.state = next;
        this.listeners.forEach((listener) => listener());
    }
    summarizeHistory() {
        const toItem = (entry) => ({ seq: entry.seq, label: entry.command.label });
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
    freshState(document, name, path, messages, cameraRevision) {
        return {
            scene: document.scene,
            selectedId: null,
            editMode: 'object',
            selectedVertexId: null,
            tool: this.state?.tool ?? 'select',
            settings: { ...document.settings },
            references: document.references ?? [],
            snapshots: document.snapshots ?? [],
            project: { name, path, savedRevision: this.history.revision, settingsDirty: false },
            history: this.summarizeHistory(),
            camera: { view: document.camera, revision: cameraRevision + 1 },
            messages,
            dirty: false,
        };
    }
    /** Keeps selection, edit mode and vertex selection valid for a scene. */
    selectionFor(scene, selectedId) {
        const object = selectedId ? scene.objects[selectedId] : undefined;
        if (!object)
            return { selectedId: null, editMode: 'object', selectedVertexId: null };
        const sameObject = selectedId === this.state.selectedId;
        const keepPoints = sameObject && this.state.editMode === 'points' && (0, types_1.isConstructionMesh)(object);
        const vertex = this.state.selectedVertexId;
        const keepVertex = keepPoints && vertex !== null && (0, types_1.isConstructionMesh)(object) && !!object.source.graph.vertices[vertex];
        return {
            selectedId,
            editMode: keepPoints ? 'points' : 'object',
            selectedVertexId: keepVertex ? vertex : null,
        };
    }
    // -- Commands, undo and redo -----------------------------------------------
    /** Applies a command and records it for undo. Returns false (and logs why) if it failed. */
    execute(command) {
        let scene;
        try {
            scene = command.apply(this.state.scene);
        }
        catch (error) {
            this.log('error', `${command.label} failed.`, describeError(error));
            return false;
        }
        const wanted = command.selectAfterApply !== undefined ? command.selectAfterApply : this.state.selectedId;
        const selection = this.selectionFor(scene, wanted);
        this.history.record(command, this.state.selectedId, selection.selectedId);
        this.commit({ scene, ...selection, history: this.summarizeHistory() });
        return true;
    }
    undo() {
        const entry = this.history.undo();
        if (!entry)
            return false;
        try {
            const scene = entry.command.revert(this.state.scene);
            this.commit({ scene, ...this.selectionFor(scene, entry.selectionBefore), history: this.summarizeHistory() });
            return true;
        }
        catch (error) {
            this.history.redo();
            this.log('error', `Undo “${entry.command.label}” failed.`, describeError(error));
            return false;
        }
    }
    redo() {
        const entry = this.history.redo();
        if (!entry)
            return false;
        try {
            const scene = entry.command.apply(this.state.scene);
            this.commit({ scene, ...this.selectionFor(scene, entry.selectionAfter), history: this.summarizeHistory() });
            return true;
        }
        catch (error) {
            this.history.undo();
            this.log('error', `Redo “${entry.command.label}” failed.`, describeError(error));
            return false;
        }
    }
    get revision() {
        return this.history.revision;
    }
    // -- Live previews (not recorded; a command commits the final value) --------
    previewTransform(id, transform) {
        if (!this.state.scene.objects[id])
            return;
        this.commit({ scene: (0, scene_1.setObjectTransform)(this.state.scene, id, transform) });
    }
    /** Live preview of a mesh source (e.g. dragging a dot on the board); a command commits the final value. */
    previewSource(id, source) {
        const object = this.state.scene.objects[id];
        if (object?.kind !== 'mesh')
            return;
        this.commit({ scene: (0, scene_1.updateObject)(this.state.scene, id, () => ({ ...object, source })) });
    }
    previewColor(id, color) {
        const object = this.state.scene.objects[id];
        if (object?.kind !== 'mesh')
            return;
        this.commit({ scene: (0, scene_1.updateObject)(this.state.scene, id, () => ({ ...object, material: { ...object.material, color } })) });
    }
    previewGraph(id, graph) {
        const object = this.state.scene.objects[id];
        if (!(0, types_1.isConstructionMesh)(object))
            return;
        this.commit({ scene: (0, scene_1.updateObject)(this.state.scene, id, () => ({ ...object, source: { type: 'construction', graph } })) });
    }
    // -- Selection and modes ----------------------------------------------------
    select(id) {
        if (id === this.state.selectedId)
            return;
        const object = id ? this.state.scene.objects[id] : undefined;
        this.commit({ selectedId: object ? id : null, editMode: 'object', selectedVertexId: null });
    }
    selectVertex(vertexId) {
        if (this.state.editMode !== 'points')
            return;
        this.commit({ selectedVertexId: vertexId });
    }
    /** Switches between object mode and points mode. Points mode needs a point-built object. */
    setEditMode(mode) {
        if (mode === this.state.editMode)
            return true;
        if (mode === 'points') {
            const object = this.state.selectedId ? this.state.scene.objects[this.state.selectedId] : undefined;
            if (!(0, types_1.isConstructionMesh)(object)) {
                this.log('warning', 'Select a point-built object (a Cube or Plane) to edit its vertices. Blueprints are edited on the board, or use Convert to points.');
                return false;
            }
        }
        this.commit({ editMode: mode, selectedVertexId: null });
        return true;
    }
    setTool(tool) {
        if (tool !== this.state.tool)
            this.commit({ tool });
    }
    updateSettings(patch) {
        const settings = { ...this.state.settings, ...patch };
        if (!(settings.gridSize > 0) || !(settings.rotationSnapDegrees > 0))
            return;
        this.commit({ settings, project: { ...this.state.project, settingsDirty: true } });
    }
    /** Replaces the reference pictures. They are saved with the project but are not part of undo. */
    setReferences(references) {
        if (references === this.state.references)
            return;
        this.commit({ references, project: { ...this.state.project, settingsDirty: true } });
    }
    /** Replaces the snapshots. They are saved with the project but are not part of undo. */
    setSnapshots(snapshots) {
        if (snapshots === this.state.snapshots)
            return;
        this.commit({ snapshots, project: { ...this.state.project, settingsDirty: true } });
    }
    setCameraView(view) {
        this.state = { ...this.state, camera: { ...this.state.camera, view } };
    }
    // -- Projects -------------------------------------------------------------
    /** Replaces the whole project (new or opened). Clears undo history. */
    loadDocument(document, name, path) {
        this.history.clear();
        this.state = this.freshState(document, name, path, this.state.messages, this.state.camera.revision);
        this.listeners.forEach((listener) => listener());
    }
    /** Records a successful save. Edits made while the save was running stay unsaved. */
    markSaved(name, path, savedRevision, savedSettings, savedReferences = this.state.references, savedSnapshots = this.state.snapshots) {
        const settingsDirty = this.state.settings !== savedSettings || this.state.references !== savedReferences || this.state.snapshots !== savedSnapshots;
        this.commit({ project: { name, path, savedRevision, settingsDirty } });
    }
    toDocument() {
        const document = { scene: this.state.scene, settings: this.state.settings, camera: this.state.camera.view };
        if (this.state.references.length)
            document.references = this.state.references;
        if (this.state.snapshots.length)
            document.snapshots = this.state.snapshots;
        return document;
    }
    // -- Diagnostics ------------------------------------------------------------
    log(level, text, detail, options = {}) {
        const message = { id: ++this.messageSeq, level, text, detail, time: Date.now(), ...(options.quiet ? { quiet: true } : {}) };
        this.commit({ messages: [...this.state.messages, message].slice(-MAX_MESSAGES) });
    }
    clearMessages() {
        this.commit({ messages: [] });
    }
}
exports.EditorStore = EditorStore;
