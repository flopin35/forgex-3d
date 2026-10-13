import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, ConfigError, forgexServerEntry, genericConfigSnippet, hasForgexEntry, mergeClaudeDesktopConfig, relayServerEntry } from './claudeConfig';

const EXE = 'C:\\Users\\HP\\OneDrive\\Desktop\\3D software\\release\\FORGEX 3D.exe';
const PROJECTS = 'C:\\Users\\HP\\OneDrive\\Documents\\FORGEX 3D';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

describe('Claude Desktop config merge', () => {
  it('creates a config when there is none', () => {
    const merged = mergeClaudeDesktopConfig(null, forgexServerEntry(NODE, PROJECTS));
    expect(JSON.parse(merged.text)).toEqual({ mcpServers: { 'forgex-3d': { command: NODE, args: [], env: { FORGEX_PROJECTS_DIR: PROJECTS } } } });
    expect(merged.changed).toBe(true);
    expect(merged.replaced).toBe(false);
  });

  it('keeps other servers and settings, and updates its own entry', () => {
    const existing = JSON.stringify({
      globalShortcut: 'Ctrl+Space',
      mcpServers: { blender: { command: 'uvx', args: ['blender-mcp'] }, 'forgex-3d': { command: 'node', args: ['old.cjs'] } },
    });
    const merged = mergeClaudeDesktopConfig(`\uFEFF${existing}`, forgexServerEntry(NODE));
    const config = JSON.parse(merged.text);
    expect(config.globalShortcut).toBe('Ctrl+Space');
    expect(config.mcpServers.blender).toEqual({ command: 'uvx', args: ['blender-mcp'] });
    expect(config.mcpServers['forgex-3d']).toEqual({ command: NODE, args: [] });
    expect(merged.replaced).toBe(true);
    expect(hasForgexEntry(merged.text, NODE)).toBe(true);
    expect(mergeClaudeDesktopConfig(merged.text, forgexServerEntry(NODE)).changed).toBe(false);
  });

  it('never overwrites a config it cannot read', () => {
    expect(() => mergeClaudeDesktopConfig('{ "mcpServers": ', forgexServerEntry(NODE))).toThrow(ConfigError);
    expect(() => mergeClaudeDesktopConfig('[1, 2]', forgexServerEntry(NODE))).toThrow(ConfigError);
    expect(() => mergeClaudeDesktopConfig('{"mcpServers": []}', forgexServerEntry(NODE))).toThrow(ConfigError);
    expect(hasForgexEntry('not json')).toBe(false);
  });

  it('writes the Claude Code command and the generic snippet', () => {
    const entry = forgexServerEntry(NODE, PROJECTS);
    expect(claudeCodeCommand(entry)).toBe(
      `claude mcp add --scope user --transport stdio forgex-3d --env FORGEX_PROJECTS_DIR="${PROJECTS}" -- "${NODE}"`,
    );
    expect(JSON.parse(genericConfigSnippet(entry)).mcpServers['forgex-3d'].command).toBe(NODE);
  });

  it('sets up the app itself as the server, with --mcp', () => {
    const merged = mergeClaudeDesktopConfig(null, relayServerEntry(EXE));
    expect(JSON.parse(merged.text).mcpServers['forgex-3d']).toEqual({ command: EXE, args: ['--mcp'] });
    expect(hasForgexEntry(merged.text, EXE)).toBe(true);
    // The same exe without --mcp would open a window, so it does not count as set up.
    expect(hasForgexEntry(mergeClaudeDesktopConfig(null, { command: EXE, args: [] }).text, EXE)).toBe(false);
    expect(claudeCodeCommand(relayServerEntry(EXE))).toBe(`claude mcp add --scope user --transport stdio forgex-3d -- "${EXE}" --mcp`);
  });
});
