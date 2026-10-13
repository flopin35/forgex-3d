/**
 * Setting up AI assistants to use the FORGEX MCP server: the entry FORGEX adds to an MCP
 * client's config, merged into whatever the user already has without disturbing it.
 */

export const MCP_SERVER_NAME = 'forgex-3d';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The flag that makes FORGEX 3D.exe run as an MCP server instead of opening a window. */
export const RELAY_FLAG = '--mcp';

/** The entry for the MCP server built into the desktop app: FORGEX 3D.exe --mcp. */
export function relayServerEntry(appPath: string): McpServerEntry {
  return { command: appPath, args: [RELAY_FLAG] };
}

/** The entry for the Node.js server (mcp/forgex-mcp.cjs), with the projects folder it shares with the app. */
export function forgexServerEntry(command: string, projectsFolder?: string, args: string[] = []): McpServerEntry {
  return projectsFolder ? { command, args, env: { FORGEX_PROJECTS_DIR: projectsFolder } } : { command, args };
}

/**
 * Adds or updates the `forgex-3d` entry in a Claude Desktop config (claude_desktop_config.json).
 * Every other setting and server is kept as it was. A file that is not valid JSON is never
 * overwritten: the user is told to fix it instead.
 */
export function mergeClaudeDesktopConfig(
  existing: string | null,
  entry: McpServerEntry,
  name = MCP_SERVER_NAME,
): { text: string; changed: boolean; replaced: boolean } {
  let config: Record<string, unknown> = {};
  const trimmed = existing?.replace(/^\uFEFF/, '').trim() ?? '';
  if (trimmed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new ConfigError(`The Claude Desktop config is not valid JSON (${(error as Error).message}), so FORGEX left it alone. Fix or delete it, then try again.`);
    }
    if (!isRecord(parsed)) throw new ConfigError('The Claude Desktop config is not a JSON object, so FORGEX left it alone.');
    config = parsed;
  }
  const servers = config.mcpServers ?? {};
  if (!isRecord(servers)) throw new ConfigError('"mcpServers" in the Claude Desktop config is not an object, so FORGEX left it alone.');
  const previous = servers[name];
  const replaced = previous !== undefined;
  const changed = JSON.stringify(previous) !== JSON.stringify(entry);
  const next = { ...config, mcpServers: { ...servers, [name]: entry } };
  return { text: `${JSON.stringify(next, null, 2)}\n`, changed, replaced };
}

/**
 * True when a config already has a FORGEX entry that runs `command`. For FORGEX 3D.exe the
 * entry must also pass --mcp, or it would open a window instead of serving.
 */
export function hasForgexEntry(existing: string | null, command?: string, name = MCP_SERVER_NAME): boolean {
  if (!existing) return false;
  try {
    const parsed = JSON.parse(existing.replace(/^\uFEFF/, '')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return false;
    const entry = parsed.mcpServers[name];
    if (!isRecord(entry)) return false;
    if (command === undefined) return true;
    const isApp = /forgex[^\\/]*\.exe$/i.test(command);
    return entry.command === command && (!isApp || (Array.isArray(entry.args) && entry.args.includes(RELAY_FLAG)));
  } catch {
    return false;
  }
}

function quoteArg(value: string): string {
  return /^[\w.:\\/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/** The Claude Code command that registers FORGEX for every project of this user. */
export function claudeCodeCommand(entry: McpServerEntry, name = MCP_SERVER_NAME): string {
  const env = Object.entries(entry.env ?? {}).map(([key, value]) => `--env ${key}=${quoteArg(value)}`);
  return ['claude mcp add --scope user --transport stdio', name, ...env, '--', quoteArg(entry.command), ...entry.args.map(quoteArg)].join(' ');
}

/** The JSON block other MCP clients (VS Code, Cursor, Codex and others) take. */
export function genericConfigSnippet(entry: McpServerEntry, name = MCP_SERVER_NAME): string {
  return JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
}
