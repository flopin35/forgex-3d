import { isReadOnlyTool, runTool } from '../core/automation/tools';
import { ToolError, type ToolOutput } from '../core/automation/toolTypes';
import { AppToolHost } from './automationHost';
import type { EditorActions } from './editorActions';

/**
 * Links the app to a running FORGEX MCP server (mcp/forgex-mcp.cjs) on this computer.
 * The app asks the server for the next tool call, runs it on the open project and
 * sends the result back. When no server is running, it quietly retries every few seconds.
 */

const PORT = Number(import.meta.env.VITE_FORGEX_BRIDGE_PORT) || 47833;
const BASE = `http://127.0.0.1:${PORT}/forgex/v1`;

interface BridgeJob {
  id: string;
  tool: string;
  args: unknown;
}

export interface AiLinkState {
  connected: boolean;
  /** The tool running right now, if any. */
  busyWith: string | null;
}

class AiLinkStatus {
  private state: AiLinkState = { connected: false, busyWith: null };
  private listeners = new Set<() => void>();

  getSnapshot = (): AiLinkState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<AiLinkState>): void {
    const next = { ...this.state, ...patch };
    if (next.connected === this.state.connected && next.busyWith === this.state.busyWith) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

export const aiLink = new AiLinkStatus();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function firstLine(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

export function startMcpBridge(actions: EditorActions): () => void {
  const host = new AppToolHost(actions);
  let stopped = false;
  let controller: AbortController | null = null;

  const setConnected = (connected: boolean) => {
    if (connected === aiLink.getSnapshot().connected) return;
    aiLink.set({ connected });
    actions.store.log('info', connected ? 'AI link connected: an MCP client can now work in this project.' : 'AI link closed.');
  };

  const runJob = async (job: BridgeJob) => {
    aiLink.set({ busyWith: job.tool });
    try {
      const output: ToolOutput = await runTool(job.tool, job.args, { store: actions.store, host });
      if (!isReadOnlyTool(job.tool)) actions.store.log('info', `AI · ${job.tool}: ${firstLine(output.text)}`);
      return { id: job.id, ok: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ToolError)) console.error(error);
      actions.store.log('warning', `AI · ${job.tool} did not run.`, message);
      return { id: job.id, ok: false, error: message };
    } finally {
      aiLink.set({ busyWith: null });
    }
  };

  const loop = async () => {
    let failures = 0;
    while (!stopped) {
      try {
        controller = new AbortController();
        const response = await fetch(`${BASE}/poll`, { signal: controller.signal, cache: 'no-store' });
        if (response.status === 204) {
          failures = 0;
          setConnected(true);
          continue;
        }
        if (!response.ok) throw new Error(`Bridge answered ${response.status}`);
        failures = 0;
        setConnected(true);
        const result = await runJob((await response.json()) as BridgeJob);
        await fetch(`${BASE}/result`, {
          method: 'POST',
          // text/plain keeps this a simple request (no CORS preflight needed).
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(result),
        });
      } catch {
        if (stopped) return;
        setConnected(false);
        failures++;
        await sleep(Math.min(10_000, 2_000 * failures));
      }
    }
  };

  void loop();
  return () => {
    stopped = true;
    controller?.abort();
    aiLink.set({ connected: false, busyWith: null });
  };
}
