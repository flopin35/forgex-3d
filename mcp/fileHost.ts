import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ToolError, type HostStatus, type ToolHost } from '../src/core/automation/toolTypes';
import { EditorStore } from '../src/core/editor/editorStore';
import { createDefaultDocument, createEmptyDocument } from '../src/core/project/defaultDocument';
import { projectNameFromPath } from '../src/core/project/paths';
import { parseProject, serializeProject } from '../src/core/project/projectFile';
import { resolveProjectPath } from './paths';

const MAX_PROJECT_BYTES = 512 * 1024 * 1024;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Same safety rule as the desktop app: write a temporary file, then rename it over the target. */
export async function writeFileAtomically(target: string, contents: string): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.saving`);
  try {
    await writeFile(temp, contents, 'utf8');
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs the tools on a project held by the MCP server itself, used when the
 * FORGEX 3D app is not open. Projects with a file are saved after every change.
 */
export class FileHost implements ToolHost {
  readonly store = new EditorStore(createEmptyDocument(), 'Untitled', null);

  constructor(
    readonly projectsFolder: string,
    private readonly appNote: () => string,
  ) {}

  status(): HostStatus {
    return {
      mode: 'file',
      detail: `Working directly on .forgex files (${this.appNote()}).`,
      projectsFolder: this.projectsFolder,
    };
  }

  resolve(path: string): string {
    return resolveProjectPath(path, this.projectsFolder);
  }

  async newProject({ path, empty }: { path?: string; empty: boolean }): Promise<string> {
    const target = path ? this.resolve(path) : null;
    if (target && (await exists(target))) {
      throw new ToolError(`${target} already exists. Use open_project to edit it, or choose another name.`);
    }
    const document = empty ? createEmptyDocument() : createDefaultDocument();
    this.store.loadDocument(document, target ? projectNameFromPath(target) : 'Untitled', target);
    if (!target) return 'Started an untitled project. Call save_project with a name to write it to disk.';
    await this.write(target);
    return `Started ${projectNameFromPath(target)} at ${target}. Changes are saved there automatically.`;
  }

  async openProject(path: string): Promise<string> {
    const target = this.resolve(path);
    let info;
    try {
      info = await stat(target);
    } catch {
      throw new ToolError(`${target} does not exist.`);
    }
    if (info.size > MAX_PROJECT_BYTES) throw new ToolError(`${target} is larger than the 512 MB limit.`);
    const parsed = parseProject(await readFile(target, 'utf8'));
    if (!parsed.ok) throw new ToolError(`${target} could not be opened:\n${parsed.errors.join('\n')}`);
    this.store.loadDocument(parsed.document, projectNameFromPath(target), target);
    const count = Object.keys(parsed.document.scene.objects).length;
    const warnings = parsed.warnings.length ? `\nWarnings:\n${parsed.warnings.join('\n')}` : '';
    return `Opened ${target} with ${count} object${count === 1 ? '' : 's'}. Changes are saved there automatically.${warnings}`;
  }

  async saveProject(path?: string): Promise<string> {
    const target = path ? this.resolve(path) : this.store.getState().project.path;
    if (!target) {
      throw new ToolError(`This project has no file yet. Pass a path, for example "kart" (saved in ${this.projectsFolder}).`);
    }
    await this.write(target);
    return `Saved ${target}.`;
  }

  /** Saves after a change when the project already has a file. Returns a note for the AI. */
  async afterChange(): Promise<string> {
    const { project, dirty } = this.store.getState();
    if (!dirty) return '';
    if (!project.path) return 'Not saved to disk yet: call save_project with a name to keep this work.';
    await this.write(project.path);
    return `Saved to ${project.path}.`;
  }

  private async write(target: string): Promise<void> {
    const revision = this.store.revision;
    const settings = this.store.getState().settings;
    const text = serializeProject(this.store.toDocument());
    const check = parseProject(text);
    if (!check.ok) throw new ToolError(`The project failed validation, so nothing was written:\n${check.errors.join('\n')}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFileAtomically(target, text);
    this.store.markSaved(projectNameFromPath(target), target, revision, settings);
  }
}
