"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileHost = exports.writeFileAtomically = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const toolTypes_1 = require("../src/core/automation/toolTypes");
const editorStore_1 = require("../src/core/editor/editorStore");
const defaultDocument_1 = require("../src/core/project/defaultDocument");
const paths_1 = require("../src/core/project/paths");
const projectFile_1 = require("../src/core/project/projectFile");
const atomic_1 = require("./atomic");
Object.defineProperty(exports, "writeFileAtomically", { enumerable: true, get: function () { return atomic_1.writeFileAtomically; } });
const library_1 = require("./library");
const paths_2 = require("./paths");
const MAX_PROJECT_BYTES = 512 * 1024 * 1024;
async function exists(path) {
    try {
        await (0, promises_1.stat)(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Runs the tools on a project held by the MCP server itself, used when the
 * FORGEX 3D app is not open. Projects with a file are saved after every change.
 */
class FileHost {
    projectsFolder;
    appNote;
    store = new editorStore_1.EditorStore((0, defaultDocument_1.createEmptyDocument)(), 'Untitled', null);
    library;
    constructor(projectsFolder, appNote) {
        this.projectsFolder = projectsFolder;
        this.appNote = appNote;
        this.library = new library_1.FolderLibrary(projectsFolder);
    }
    status() {
        return {
            mode: 'file',
            detail: `Working directly on .forgex files (${this.appNote()}).`,
            projectsFolder: this.projectsFolder,
        };
    }
    resolve(path) {
        return (0, paths_2.resolveProjectPath)(path, this.projectsFolder);
    }
    async newProject({ path, empty }) {
        const target = path ? this.resolve(path) : null;
        if (target && (await exists(target))) {
            throw new toolTypes_1.ToolError(`${target} already exists. Use open_project to edit it, or choose another name.`);
        }
        const document = empty ? (0, defaultDocument_1.createEmptyDocument)() : (0, defaultDocument_1.createDefaultDocument)();
        this.store.loadDocument(document, target ? (0, paths_1.projectNameFromPath)(target) : 'Untitled', target);
        if (!target)
            return 'Started an untitled project. Call save_project with a name to write it to disk.';
        await this.write(target);
        return `Started ${(0, paths_1.projectNameFromPath)(target)} at ${target}. Changes are saved there automatically.`;
    }
    async openProject(path) {
        const target = this.resolve(path);
        let info;
        try {
            info = await (0, promises_1.stat)(target);
        }
        catch {
            throw new toolTypes_1.ToolError(`${target} does not exist.`);
        }
        if (info.size > MAX_PROJECT_BYTES)
            throw new toolTypes_1.ToolError(`${target} is larger than the 512 MB limit.`);
        const parsed = (0, projectFile_1.parseProject)(await (0, promises_1.readFile)(target, 'utf8'));
        if (!parsed.ok)
            throw new toolTypes_1.ToolError(`${target} could not be opened:\n${parsed.errors.join('\n')}`);
        this.store.loadDocument(parsed.document, (0, paths_1.projectNameFromPath)(target), target);
        const count = Object.keys(parsed.document.scene.objects).length;
        const warnings = parsed.warnings.length ? `\nWarnings:\n${parsed.warnings.join('\n')}` : '';
        return `Opened ${target} with ${count} object${count === 1 ? '' : 's'}. Changes are saved there automatically.${warnings}`;
    }
    async saveProject(path) {
        const target = path ? this.resolve(path) : this.store.getState().project.path;
        if (!target) {
            throw new toolTypes_1.ToolError(`This project has no file yet. Pass a path, for example "kart" (saved in ${this.projectsFolder}).`);
        }
        await this.write(target);
        return `Saved ${target}.`;
    }
    /** Saves after a change when the project already has a file. Returns a note for the AI. */
    async afterChange() {
        const { project, dirty } = this.store.getState();
        if (!dirty)
            return '';
        if (!project.path)
            return 'Not saved to disk yet: call save_project with a name to keep this work.';
        await this.write(project.path);
        return `Saved to ${project.path}.`;
    }
    async write(target) {
        const revision = this.store.revision;
        const { settings, references, snapshots } = this.store.getState();
        const text = (0, projectFile_1.serializeProject)(this.store.toDocument());
        const check = (0, projectFile_1.parseProject)(text);
        if (!check.ok)
            throw new toolTypes_1.ToolError(`The project failed validation, so nothing was written:\n${check.errors.join('\n')}`);
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(target), { recursive: true });
        await (0, atomic_1.writeFileAtomically)(target, text);
        this.store.markSaved((0, paths_1.projectNameFromPath)(target), target, revision, settings, references, snapshots);
    }
}
exports.FileHost = FileHost;
