/** What the editor needs from the operating system, so the core never touches Tauri directly. */
export interface OpenedProjectFile {
  /** File name, e.g. "Car.forgex". */
  name: string;
  /** Full path on disk, or null in the browser preview. */
  path: string | null;
  contents: string;
}

export interface PlatformFiles {
  readonly kind: 'desktop' | 'browser';
  /** Shows an open dialog and reads the chosen project. Null when cancelled. */
  openProjectFile(): Promise<OpenedProjectFile | null>;
  /** Shows a save dialog. Null when cancelled. */
  chooseSavePath(suggestedName: string): Promise<string | null>;
  /** Reads a project from a known path (used by AI tools). Desktop only. */
  readProjectAt(path: string): Promise<string>;
  /** Writes safely: a failed save never replaces the existing file with partial data. */
  writeProjectFile(path: string, contents: string): Promise<void>;
  /** Shows a save dialog for an exported model (.glb). Null when cancelled. */
  chooseExportPath(suggestedName: string): Promise<string | null>;
  /** Writes an exported model. In the browser preview this downloads it. */
  writeExportFile(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  confirm(title: string, message: string): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  /** Asks before closing the window while `isDirty()` is true. Returns a function that removes the guard. */
  installCloseGuard(isDirty: () => boolean): () => void;
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function createPlatformFiles(): Promise<PlatformFiles> {
  if (isDesktopApp()) {
    const { createDesktopFiles } = await import('./desktopFiles');
    return createDesktopFiles();
  }
  const { createBrowserFiles } = await import('./browserFiles');
  return createBrowserFiles();
}
