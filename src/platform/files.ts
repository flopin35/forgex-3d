import type { McpServerEntry } from '../core/ai/claudeConfig';
import type { LibraryStore } from '../core/library/libraryPart';

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
  /** My Parts: the shared parts library (a folder on desktop, browser storage in the preview). */
  readonly library: LibraryStore;
  /** The projects and library folders (desktop only; null in the browser preview). */
  folders(): Promise<{ projects: string; library: string } | null>;
  /** Shows a folder in Explorer, or opens a shipped file such as the Claude extension (desktop only). */
  reveal(path: string): Promise<void>;
  /** Puts text on the system clipboard. */
  copyText(text: string): Promise<void>;
  /** Connecting AI assistants on this computer (desktop only). */
  readonly ai?: AiSetup;
}

export interface ClaudeConfigFile {
  path: string;
  exists: boolean;
  /** A Microsoft Store install of Claude keeps its config in a package folder. */
  packaged: boolean;
}

export interface AiSetupStatus {
  /** This FORGEX 3D.exe. AI apps run it with --mcp: the MCP server is built in. */
  appPath: string;
  claudeConfigs: ClaudeConfigFile[];
  projects: string;
  /** True when a Claude Desktop config already runs this exe as its FORGEX server. */
  connected: boolean;
}

export interface AiConnectResult {
  entry: McpServerEntry;
  configs: { path: string; packaged: boolean; backup: string | null; changed: boolean }[];
}

export interface AiSetup {
  status(): Promise<AiSetupStatus>;
  /** Adds FORGEX (this exe with --mcp) to every Claude Desktop config found. */
  connectClaudeDesktop(): Promise<AiConnectResult>;
}

/** Clipboard text with a fallback for webviews that block the async clipboard. */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('The clipboard is not available.');
  }
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
