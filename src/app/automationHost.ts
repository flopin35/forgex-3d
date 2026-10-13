import { ToolError, type HostStatus, type ToolHost, type ToolImage, type ViewPreset } from '../core/automation/toolTypes';
import { ensureProjectExtension, projectNameFromPath } from '../core/project/paths';
import type { EditorActions } from './editorActions';

/**
 * Runs AI tools on the open editor ("live" mode). Project operations go through the
 * same actions as the menus, so the user still sees the unsaved-changes prompt.
 */
export class AppToolHost implements ToolHost {
  constructor(private readonly actions: EditorActions) {}

  /** The same My Parts library the app shows, so parts saved by the AI appear there at once. */
  get library() {
    return this.actions.files.library;
  }

  status(): HostStatus {
    return {
      mode: 'live',
      detail:
        this.actions.files.kind === 'desktop'
          ? 'Connected to the open FORGEX 3D app; changes appear live in its viewport and in its undo history.'
          : 'Connected to FORGEX 3D running as a browser preview; saving downloads the file.',
    };
  }

  /**
   * AI tools may name a project ("kart") instead of giving a full path: those go in the
   * projects folder (Documents\FORGEX 3D), the same place the Node server would use.
   */
  private async resolvePath(path: string | undefined): Promise<string | undefined> {
    if (!path?.trim()) return undefined;
    const trimmed = path.trim();
    if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)) return ensureProjectExtension(trimmed);
    const folders = await this.actions.files.folders().catch(() => null);
    if (!folders) return ensureProjectExtension(trimmed);
    const separator = folders.projects.includes('\\') ? '\\' : '/';
    return ensureProjectExtension(`${folders.projects.replace(/[\\/]+$/, '')}${separator}${trimmed.replace(/^[\\/]+/, '')}`);
  }

  async newProject({ path: rawPath, empty }: { path?: string; empty: boolean }): Promise<string> {
    const path = await this.resolvePath(rawPath);
    const started = await this.actions.startNewProject({ empty, path });
    if (!started) throw new ToolError('The user kept their unsaved changes, so no new project was started.');
    return path
      ? `Started ${projectNameFromPath(path)} in the app. Call save_project to write it to ${path}.`
      : 'Started an untitled project in the app. Call save_project with a name to write it.';
  }

  async openProject(rawPath: string): Promise<string> {
    if (this.actions.files.kind !== 'desktop') throw new ToolError('Opening a project by path needs the desktop app (npm run desktop).');
    const path = (await this.resolvePath(rawPath)) ?? rawPath;
    try {
      const result = await this.actions.openProjectAt(path);
      if (!result.opened) throw new ToolError(result.message);
      return result.message;
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(error instanceof Error ? error.message : String(error));
    }
  }

  async saveProject(rawPath?: string): Promise<string> {
    const path = await this.resolvePath(rawPath);
    const saved = path ? await this.actions.saveProjectTo(path) : await this.actions.saveProject();
    const state = this.actions.store.getState();
    if (!saved) {
      const last = state.messages.at(-1);
      throw new ToolError(last?.level === 'error' ? `${last.text}${last.detail ? ` ${last.detail}` : ''}` : 'Saving was cancelled in the app.');
    }
    return this.actions.files.kind === 'desktop'
      ? `Saved ${state.project.path}.`
      : `Downloaded ${state.project.name}.forgex (browser preview).`;
  }

  async captureViewport(options: { view: ViewPreset; frame: boolean; width: number }): Promise<ToolImage> {
    const image = this.actions.captureViewport(options);
    if (!image) throw new ToolError('The viewport is not ready yet. Try again in a moment.');
    return image;
  }
}
