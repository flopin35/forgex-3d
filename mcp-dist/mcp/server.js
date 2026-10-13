"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_INSTRUCTIONS = exports.LATEST_PROTOCOL_VERSION = exports.SUPPORTED_PROTOCOL_VERSIONS = void 0;
exports.createMcpHandler = createMcpHandler;
exports.serveStdio = serveStdio;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_readline_1 = require("node:readline");
const instructions_1 = require("../src/core/automation/instructions");
Object.defineProperty(exports, "SERVER_INSTRUCTIONS", { enumerable: true, get: function () { return instructions_1.SERVER_INSTRUCTIONS; } });
const tools_1 = require("../src/core/automation/tools");
const toolTypes_1 = require("../src/core/automation/toolTypes");
const version_1 = require("../src/core/version");
/** Protocol versions this server has been written against. The tools behave the same in all of them. */
exports.SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
exports.LATEST_PROTOCOL_VERSION = '2025-11-25';
/** Tools that may wait on the user (an unsaved-changes prompt or a save dialog in the app). */
const DIALOG_TOOLS = new Set(['new_project', 'open_project', 'save_project']);
const PROJECT_TOOLS = new Set(['new_project', 'open_project', 'save_project']);
function ok(id, result) {
    return { jsonrpc: '2.0', id: id ?? null, result };
}
function fail(id, code, message, data) {
    return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}
function toMcpResult(output) {
    const content = [{ type: 'text', text: output.text }];
    if (output.image)
        content.push({ type: 'image', data: output.image.data, mimeType: output.image.mimeType });
    return { content };
}
function toolFailure(message) {
    return { content: [{ type: 'text', text: message }], isError: true };
}
function negotiateVersion(requested) {
    if (typeof requested === 'string') {
        if (exports.SUPPORTED_PROTOCOL_VERSIONS.includes(requested))
            return requested;
        // Newer dated revisions keep these basic tool messages unchanged, so accept them.
        if (/^\d{4}-\d{2}-\d{2}$/.test(requested) && requested > exports.LATEST_PROTOCOL_VERSION)
            return requested;
    }
    return exports.LATEST_PROTOCOL_VERSION;
}
/** Creates the JSON-RPC message handler. Returns null for notifications (no reply). */
function createMcpHandler(options) {
    const { mode, bridge, fileHost } = options;
    const log = options.log ?? (() => undefined);
    const useApp = () => mode !== 'file' && bridge !== null && bridge.connected;
    /** Relative names become full paths in the projects folder before the app sees them. */
    async function prepareForApp(name, args) {
        if (!PROJECT_TOOLS.has(name) || typeof args !== 'object' || args === null)
            return args;
        const record = { ...args };
        if (typeof record.path === 'string' && record.path.trim()) {
            record.path = fileHost.resolve(record.path);
            if (name !== 'open_project')
                await (0, promises_1.mkdir)((0, node_path_1.dirname)(record.path), { recursive: true });
        }
        return record;
    }
    async function callTool(params) {
        const { name, arguments: args } = (params ?? {});
        if (typeof name !== 'string' || !(0, tools_1.hasTool)(name))
            throw new UnknownToolError(String(name));
        if (useApp()) {
            const forwarded = await prepareForApp(name, args ?? {});
            const timeout = DIALOG_TOOLS.has(name) ? 10 * 60_000 : name === 'capture_viewport' ? 60_000 : 30_000;
            const reply = await bridge.call(name, forwarded, timeout);
            return reply.ok && reply.output ? toMcpResult(reply.output) : toolFailure(reply.error ?? 'FORGEX 3D reported an unknown error.');
        }
        if (mode === 'live') {
            return toolFailure('FORGEX 3D is not open. Start the app (npm run desktop) and it links to this server automatically.');
        }
        try {
            let output = await (0, tools_1.runTool)(name, args ?? {}, { store: fileHost.store, host: fileHost });
            if (!(0, tools_1.isReadOnlyTool)(name) && !PROJECT_TOOLS.has(name)) {
                const note = await fileHost.afterChange();
                if (note)
                    output = { ...output, text: `${output.text}\n${note}` };
            }
            return toMcpResult(output);
        }
        catch (error) {
            if (error instanceof toolTypes_1.ToolError)
                return toolFailure(error.message);
            log(`Tool ${name} crashed: ${error.stack ?? String(error)}`);
            return toolFailure(`FORGEX could not run ${name}: ${error.message ?? String(error)}`);
        }
    }
    return async (message) => {
        if (typeof message !== 'object' || message === null || message.jsonrpc !== '2.0') {
            return fail(null, -32600, 'Invalid request: expected a JSON-RPC 2.0 message.');
        }
        const { id, method, params } = message;
        const isNotification = id === undefined;
        if (typeof method !== 'string')
            return null; // A response to a request we never send.
        try {
            switch (method) {
                case 'initialize': {
                    const requested = params?.protocolVersion;
                    return ok(id, {
                        protocolVersion: negotiateVersion(requested),
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'forgex-3d', title: version_1.APP_NAME, version: version_1.APP_VERSION },
                        instructions: instructions_1.SERVER_INSTRUCTIONS,
                    });
                }
                case 'ping':
                    return isNotification ? null : ok(id, {});
                case 'tools/list':
                    return ok(id, { tools: tools_1.TOOL_SPECS });
                case 'tools/call':
                    return ok(id, await callTool(params));
                default:
                    if (method.startsWith('notifications/') || isNotification)
                        return null;
                    return fail(id, -32601, `Method not found: ${method}`);
            }
        }
        catch (error) {
            if (error instanceof UnknownToolError)
                return fail(id, -32602, `Unknown tool: ${error.toolName}`);
            log(`Request ${method} failed: ${error.stack ?? String(error)}`);
            return isNotification ? null : fail(id, -32603, error.message ?? 'Internal error');
        }
    };
}
class UnknownToolError extends Error {
    toolName;
    constructor(toolName) {
        super(`Unknown tool: ${toolName}`);
        this.toolName = toolName;
    }
}
/** Newline-delimited JSON-RPC over stdin/stdout, as MCP's stdio transport specifies. */
function serveStdio(handler, input, output, onClose) {
    const write = (value) => output.write(`${JSON.stringify(value)}\n`);
    const lines = (0, node_readline_1.createInterface)({ input, crlfDelay: Infinity });
    lines.on('line', (line) => {
        if (!line.trim())
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            write(fail(null, -32700, 'Parse error: each line must be one JSON message.'));
            return;
        }
        if (Array.isArray(message)) {
            void Promise.all(message.map(handler)).then((replies) => {
                const sent = replies.filter((reply) => reply !== null);
                if (sent.length)
                    write(sent);
            });
            return;
        }
        void handler(message).then((reply) => {
            if (reply)
                write(reply);
        });
    });
    lines.on('close', onClose);
}
