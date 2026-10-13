// Checks the MCP server built into the desktop app, the way an AI app runs it:
//   node scripts/smoke-mcp-relay.mjs "path/to/FORGEX 3D.exe"
// initialize and tools/list must work. A tool call then opens the app window and waits for
// it to link; that part is reported but only fails the check with --require-app.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [exe, ...flags] = process.argv.slice(2);
const requireApp = flags.includes('--require-app');
if (!exe) {
  console.error('Usage: node scripts/smoke-mcp-relay.mjs <FORGEX 3D.exe> [--require-app]');
  process.exit(2);
}

const relay = spawn(exe, ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
relay.stderr.on('data', (data) => process.stdout.write(`  relay: ${data}`));
const waiting = new Map();
createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    console.error(`Not JSON on stdout: ${line}`);
    process.exit(1);
  }
  waiting.get(message.id)?.(message);
  waiting.delete(message.id);
});
let nextId = 1;
const request = (method, params, timeoutMs) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`${method} got no answer in ${timeoutMs / 1000} s`)), timeoutMs);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

let failed = false;
try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } }, 15000);
  if (init.result?.serverInfo?.name !== 'forgex-3d') throw new Error(`Unexpected initialize answer: ${JSON.stringify(init)}`);
  console.log(`initialize: ${init.result.serverInfo.title} ${init.result.serverInfo.version}, protocol ${init.result.protocolVersion}`);
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await request('tools/list', {}, 15000);
  const count = list.result?.tools?.length ?? 0;
  if (count < 30) throw new Error(`Expected the full tool list, got ${count} tools`);
  console.log(`tools/list: ${count} tools`);
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  failed = true;
}

if (!failed) {
  try {
    const status = await request('tools/call', { name: 'get_status', arguments: {} }, 90000);
    const text = status.result?.content?.[0]?.text ?? JSON.stringify(status);
    const linked = !status.result?.isError;
    console.log(`get_status (${linked ? 'app linked' : 'app not linked'}): ${text.split('\n')[0]}`);
    if (!linked && requireApp) failed = true;
  } catch (error) {
    console.log(`get_status: ${error.message}`);
    if (requireApp) failed = true;
  }
}

relay.stdin.end();
setTimeout(() => {
  relay.kill();
  process.exit(failed ? 1 : 0);
}, 1500);
