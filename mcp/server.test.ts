import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject } from '../src/core/project/projectFile';
import { AppBridge } from './bridge';
import { FileHost } from './fileHost';
import { createMcpHandler } from './server';

const folder = mkdtempSync(join(tmpdir(), 'forgex-mcp-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function fileServer() {
  const fileHost = new FileHost(folder, () => 'test');
  return { fileHost, handle: createMcpHandler({ mode: 'auto', bridge: null, fileHost }) };
}

async function call(handle: ReturnType<typeof createMcpHandler>, name: string, args: unknown): Promise<any> {
  const reply: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return reply.result;
}

describe('MCP server', () => {
  it('negotiates the protocol and lists the tools', async () => {
    const { handle } = fileServer();
    const init: any = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(init.result.protocolVersion).toBe('2025-03-26');
    expect(init.result.serverInfo.name).toBe('forgex-3d');
    const old: any = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1.0' } });
    expect(old.result.protocolVersion).toBe('2025-11-25');
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list: any = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('create_point_mesh');
  });

  it('reports protocol and tool errors the MCP way', async () => {
    const { handle } = fileServer();
    const unknown: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
    expect(unknown.error.code).toBe(-32602);
    const method: any = await handle({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
    expect(method.error.code).toBe(-32601);
    const bad = await call(handle, 'add_part', { part: 'teapot' });
    expect(bad.isError).toBe(true);
  });

  it('builds, saves and autosaves a project in file mode', async () => {
    const { handle } = fileServer();
    await call(handle, 'create_point_mesh', {
      name: 'Ramp',
      vertices: [[0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1], [0, 1, 0], [0, 1, 1]],
      edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [3, 5], [4, 5], [1, 4], [2, 5]],
    });
    const saved = await call(handle, 'save_project', { path: 'ramp' });
    expect(saved.content[0].text).toContain('ramp.forgex');
    const edited = await call(handle, 'set_color', { object: 'Ramp', color: '#e0565b' });
    expect(edited.content[0].text).toContain('Saved to');
    const parsed = parseProject(readFileSync(join(folder, 'ramp.forgex'), 'utf8'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const ramp = Object.values(parsed.document.scene.objects)[0];
      expect(ramp.kind === 'mesh' && ramp.material.color).toBe('#e0565b');
      expect(ramp.kind === 'mesh' && ramp.source.type === 'construction' && Object.keys(ramp.source.graph.faces).length).toBe(5);
    }
  });

  it('forwards calls to the app over the local bridge', async () => {
    const bridge = new AppBridge();
    expect(await bridge.start(0)).toBe(true);
    const fileHost = new FileHost(folder, () => 'test');
    const handle = createMcpHandler({ mode: 'auto', bridge, fileHost });
    const base = `http://127.0.0.1:${bridge.port}/forgex/v1`;
    const app = (async () => {
      const job: any = await (await fetch(`${base}/poll`, { headers: { Origin: 'http://tauri.localhost' } })).json();
      await fetch(`${base}/result`, {
        method: 'POST',
        headers: { Origin: 'http://tauri.localhost', 'Content-Type': 'text/plain' },
        body: JSON.stringify({ id: job.id, ok: true, output: { text: `app:${job.tool}:${job.args.path}` } }),
      });
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await call(handle, 'save_project', { path: 'from-app' });
    await app;
    expect(result.content[0].text).toBe(`app:save_project:${join(folder, 'from-app.forgex')}`);
    expect((await fetch(`${base}/poll`, { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    bridge.stop();
  });
});
