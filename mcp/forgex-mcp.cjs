#!/usr/bin/env node
// Launcher for the FORGEX 3D Node.js MCP server. Point an MCP client at this file:
//   node "C:\path\to\the\project\mcp\forgex-mcp.cjs"
// (The desktop app has the same server built in: "FORGEX 3D.exe" --mcp needs no Node.js.)
const path = require('node:path');
const fs = require('node:fs');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(`[forgex-mcp] Node.js 20 or newer is needed (found ${process.versions.node}).\n`);
  process.exit(1);
}
// A fresh build (npm run mcp:build) wins; otherwise the committed single-file bundle runs.
const built = path.join(__dirname, 'dist', 'mcp', 'main.js');
const bundled = path.join(__dirname, 'forgex-mcp.bundle.cjs');
require(fs.existsSync(built) ? built : bundled);
