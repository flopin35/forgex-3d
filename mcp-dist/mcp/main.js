"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bridge_1 = require("./bridge");
const fileHost_1 = require("./fileHost");
const paths_1 = require("./paths");
const server_1 = require("./server");
/**
 * FORGEX 3D MCP server. Start it from an MCP client (Claude Desktop, Claude Code, VS Code, Codex...):
 *   node "<project>/mcp/forgex-mcp.cjs"
 *
 * Environment variables:
 *   FORGEX_MCP_MODE      auto (default) | live | file
 *   FORGEX_BRIDGE_PORT   port for the link to the app (default 47833)
 *   FORGEX_PROJECTS_DIR  folder for relative project names (default Documents\FORGEX 3D)
 *
 * stdout carries protocol messages only; all logging goes to stderr.
 */
const log = (message) => process.stderr.write(`[forgex-mcp] ${message}\n`);
function readMode(value) {
    return value === 'live' || value === 'file' ? value : 'auto';
}
async function main() {
    const mode = readMode(process.env.FORGEX_MCP_MODE?.trim().toLowerCase());
    const port = Number(process.env.FORGEX_BRIDGE_PORT) || bridge_1.DEFAULT_BRIDGE_PORT;
    let bridge = null;
    if (mode !== 'file') {
        const candidate = new bridge_1.AppBridge(log);
        if (await candidate.start(port)) {
            bridge = candidate;
            log(`Waiting for the FORGEX 3D app on 127.0.0.1:${port}.`);
        }
        else {
            log('Another FORGEX MCP server already has the app link; this one works on files only.');
        }
    }
    const appNote = () => mode === 'file'
        ? 'file mode was chosen with FORGEX_MCP_MODE'
        : bridge
            ? 'the FORGEX 3D app is not open; start it and it links automatically'
            : `the app link is unavailable because port ${port} is in use by another FORGEX MCP server`;
    const fileHost = new fileHost_1.FileHost((0, paths_1.defaultProjectsFolder)(), appNote);
    const handler = (0, server_1.createMcpHandler)({ mode, bridge, fileHost, log });
    (0, server_1.serveStdio)(handler, process.stdin, process.stdout, () => {
        bridge?.stop();
        process.exit(0);
    });
    log(`Ready (mode: ${mode}, projects folder: ${fileHost.projectsFolder}).`);
}
process.on('uncaughtException', (error) => log(`Unexpected error: ${error.stack ?? error.message}`));
process.on('unhandledRejection', (error) => log(`Unexpected rejection: ${String(error)}`));
void main();
