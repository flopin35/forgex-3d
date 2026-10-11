#!/usr/bin/env node
// Launcher for the FORGEX 3D MCP server. Point your MCP client at this file:
//   node "C:\path\to\your\project\mcp\forgex-mcp.cjs"
const path = require('node:path');
const fs = require('node:fs');

const entry = path.join(__dirname, 'dist', 'mcp', 'main.js');
if (!fs.existsSync(entry)) {
  process.stderr.write(
    '[forgex-mcp] The server is not built yet. In the FORGEX 3D project folder run: npm install, then npm run mcp:build\n',
  );
  process.exit(1);
}
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(`[forgex-mcp] Node.js 20 or newer is needed (found ${process.versions.node}).\n`);
  process.exit(1);
}
require(entry);
