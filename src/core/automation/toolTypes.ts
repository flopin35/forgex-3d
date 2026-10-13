import type { EditorStore } from '../editor/editorStore';
import type { LibraryStore } from '../library/libraryPart';

/** A JSON Schema object describing a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** What an AI client sees for each tool (MCP `tools/list`). */
export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface ToolImage {
  /** Base64 data without a data: prefix. */
  data: string;
  mimeType: string;
}

export interface ToolOutput {
  text: string;
  image?: ToolImage;
}

/** A problem the caller can fix (bad arguments, unknown object). Reported back to the AI, not thrown as a crash. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ViewPreset = 'current' | 'perspective' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export const VIEW_PRESETS: readonly ViewPreset[] = ['current', 'perspective', 'front', 'back', 'left', 'right', 'top', 'bottom'];

export interface HostStatus {
  /** `live`: the running FORGEX 3D app. `file`: the MCP server editing .forgex files itself. */
  mode: 'live' | 'file';
  detail: string;
  projectsFolder?: string;
}

/**
 * Operations that depend on where the tools run: the running app (live) or the MCP
 * server working on files. Scene editing itself is the same in both.
 */
export interface ToolHost {
  status(): HostStatus;
  newProject(options: { path?: string; empty: boolean }): Promise<string>;
  openProject(path: string): Promise<string>;
  saveProject(path?: string): Promise<string>;
  /** My Parts, the shared parts library (absent where there is nowhere to keep it). */
  readonly library?: LibraryStore;
  /** Only the running app can render. */
  captureViewport?(options: { view: ViewPreset; frame: boolean; width: number }): Promise<ToolImage>;
}

export interface ToolContext {
  store: EditorStore;
  host: ToolHost;
}
