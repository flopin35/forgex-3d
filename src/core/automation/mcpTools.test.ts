import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from './instructions';
import { TOOL_SPECS } from './tools';

/**
 * The desktop app's built-in MCP relay (src-tauri/src/mcp_relay.rs) embeds the tool list
 * as JSON. This keeps that file identical to the tools defined here.
 * Run with UPDATE_MCP_TOOLS=1 to rewrite it after changing a tool.
 */
const FILE = resolve(__dirname, '../../../src-tauri/mcp-tools.json');

describe('built-in MCP relay tool list', () => {
  it('matches the tool definitions', () => {
    const expected = `${JSON.stringify({ instructions: SERVER_INSTRUCTIONS, tools: TOOL_SPECS }, null, 1)}\n`;
    if (process.env.UPDATE_MCP_TOOLS === '1') writeFileSync(FILE, expected);
    expect(readFileSync(FILE, 'utf8')).toBe(expected);
  });
});
