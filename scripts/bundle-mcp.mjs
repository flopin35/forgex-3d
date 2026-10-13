// Bundles the Node.js MCP server into one file with no dependencies:
// mcp/forgex-mcp.bundle.cjs. It is committed, so a fresh copy of the project can run the
// server (and Claude Code can use it through .mcp.json) without npm install.
// Run: npm run mcp:bundle. CI checks the committed file is up to date.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(root, 'mcp/main.ts')],
  outfile: resolve(root, 'mcp/forgex-mcp.bundle.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  legalComments: 'none',
  banner: { js: '// FORGEX 3D MCP server, bundled from mcp/main.ts by scripts/bundle-mcp.mjs. Do not edit by hand.' },
  logLevel: 'warning',
});
console.log('Wrote mcp/forgex-mcp.bundle.cjs');
