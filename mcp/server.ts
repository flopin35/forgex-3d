import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { SERVER_INSTRUCTIONS } from '../src/core/automation/instructions';
import { hasTool, isReadOnlyTool, runTool, TOOL_SPECS } from '../src/core/automation/tools';
import { ToolError, type ToolOutput } from '../src/core/automation/toolTypes';
import { APP_NAME, APP_VERSION } from '../src/core/version';
import type { AppBridge } from './bridge';
import type { FileHost } from './fileHost';

/** Protocol versions this server has been written against. The tools behave the same in all of them. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
export const LATEST_PROTOCOL_VERSION = '2025-11-25';

export { SERVER_INSTRUCTIONS };

/** Tools that may wait on the user (an unsaved-changes prompt or a save dialog in the app). */
const DIALOG_TOOLS = new Set(['new_project', 'open_project', 'save_project']);
const PROJECT_TOOLS = new Set(['new_project', 'open_project', 'save_project']);

export type ServerMode = 'auto' | 'live' | 'file';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

interface McpToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}

export interface ServerOptions {
  mode: ServerMode;
  bridge: AppBridge | null;
  fileHost: FileHost;
  log?: (message: string) => void;
}

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

function toMcpResult(output: ToolOutput): McpToolResult {
  const content: McpToolResult['content'] = [{ type: 'text', text: output.text }];
  if (output.image) content.push({ type: 'image', data: output.image.data, mimeType: output.image.mimeType });
  return { content };
}

function toolFailure(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string') {
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
    // Newer dated revisions keep these basic tool messages unchanged, so accept them.
    if (/^\d{4}-\d{2}-\d{2}$/.test(requested) && requested > LATEST_PROTOCOL_VERSION) return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

/** Creates the JSON-RPC message handler. Returns null for notifications (no reply). */
export function createMcpHandler(options: ServerOptions): (message: unknown) => Promise<JsonRpcResponse | null> {
  const { mode, bridge, fileHost } = options;
  const log = options.log ?? (() => undefined);

  const useApp = (): boolean => mode !== 'file' && bridge !== null && bridge.connected;

  /** Relative names become full paths in the projects folder before the app sees them. */
  async function prepareForApp(name: string, args: unknown): Promise<unknown> {
    if (!PROJECT_TOOLS.has(name) || typeof args !== 'object' || args === null) return args;
    const record = { ...(args as Record<string, unknown>) };
    if (typeof record.path === 'string' && record.path.trim()) {
      record.path = fileHost.resolve(record.path);
      if (name !== 'open_project') await mkdir(dirname(record.path as string), { recursive: true });
    }
    return record;
  }

  async function callTool(params: unknown): Promise<McpToolResult> {
    const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof name !== 'string' || !hasTool(name)) throw new UnknownToolError(String(name));

    if (useApp()) {
      const forwarded = await prepareForApp(name, args ?? {});
      const timeout = DIALOG_TOOLS.has(name) ? 10 * 60_000 : name === 'capture_viewport' ? 60_000 : 30_000;
      const reply = await bridge!.call(name, forwarded, timeout);
      return reply.ok && reply.output ? toMcpResult(reply.output) : toolFailure(reply.error ?? 'FORGEX 3D reported an unknown error.');
    }
    if (mode === 'live') {
      return toolFailure('FORGEX 3D is not open. Start the app (npm run desktop) and it links to this server automatically.');
    }

    try {
      let output = await runTool(name, args ?? {}, { store: fileHost.store, host: fileHost });
      if (!isReadOnlyTool(name) && !PROJECT_TOOLS.has(name)) {
        const note = await fileHost.afterChange();
        if (note) output = { ...output, text: `${output.text}\n${note}` };
      }
      return toMcpResult(output);
    } catch (error) {
      if (error instanceof ToolError) return toolFailure(error.message);
      log(`Tool ${name} crashed: ${(error as Error).stack ?? String(error)}`);
      return toolFailure(`FORGEX could not run ${name}: ${(error as Error).message ?? String(error)}`);
    }
  }

  return async (message: unknown) => {
    if (typeof message !== 'object' || message === null || (message as JsonRpcRequest).jsonrpc !== '2.0') {
      return fail(null, -32600, 'Invalid request: expected a JSON-RPC 2.0 message.');
    }
    const { id, method, params } = message as JsonRpcRequest;
    const isNotification = id === undefined;
    if (typeof method !== 'string') return null; // A response to a request we never send.

    try {
      switch (method) {
        case 'initialize': {
          const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
          return ok(id, {
            protocolVersion: negotiateVersion(requested),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'forgex-3d', title: APP_NAME, version: APP_VERSION },
            instructions: SERVER_INSTRUCTIONS,
          });
        }
        case 'ping':
          return isNotification ? null : ok(id, {});
        case 'tools/list':
          return ok(id, { tools: TOOL_SPECS });
        case 'tools/call':
          return ok(id, await callTool(params));
        default:
          if (method.startsWith('notifications/') || isNotification) return null;
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      if (error instanceof UnknownToolError) return fail(id, -32602, `Unknown tool: ${error.toolName}`);
      log(`Request ${method} failed: ${(error as Error).stack ?? String(error)}`);
      return isNotification ? null : fail(id, -32603, (error as Error).message ?? 'Internal error');
    }
  };
}

class UnknownToolError extends Error {
  constructor(readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
  }
}

/** Newline-delimited JSON-RPC over stdin/stdout, as MCP's stdio transport specifies. */
export function serveStdio(
  handler: (message: unknown) => Promise<JsonRpcResponse | null>,
  input: Readable,
  output: Writable,
  onClose: () => void,
): void {
  const write = (value: unknown) => output.write(`${JSON.stringify(value)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(fail(null, -32700, 'Parse error: each line must be one JSON message.'));
      return;
    }
    if (Array.isArray(message)) {
      void Promise.all(message.map(handler)).then((replies) => {
        const sent = replies.filter((reply) => reply !== null);
        if (sent.length) write(sent);
      });
      return;
    }
    void handler(message).then((reply) => {
      if (reply) write(reply);
    });
  });
  lines.on('close', onClose);
}
