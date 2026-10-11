import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ToolOutput } from '../src/core/automation/toolTypes';
import { APP_VERSION } from '../src/core/version';

/**
 * The link between this MCP server and the running FORGEX 3D app.
 *
 * The server listens on 127.0.0.1 only. The app long-polls GET /forgex/v1/poll for the
 * next tool call, runs it on its live editor (so it shows in the viewport and in undo
 * history), and posts the result to POST /forgex/v1/result. Requests from web pages are
 * refused unless they come from the FORGEX 3D app's own origins.
 */

export const DEFAULT_BRIDGE_PORT = 47833;
export const BRIDGE_PATH = '/forgex/v1';

export interface BridgeJob {
  id: string;
  tool: string;
  args: unknown;
}

export interface BridgeResult {
  id: string;
  ok: boolean;
  output?: ToolOutput;
  error?: string;
}

const ALLOWED_ORIGINS = new Set([
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
]);

const POLL_HOLD_MS = 25_000;
const RECENTLY_SEEN_MS = 5_000;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

type Headers = Record<string, string>;

interface Pending {
  resolve: (result: BridgeResult) => void;
  timer: NodeJS.Timeout;
  delivered: boolean;
}

export class AppBridge {
  private server: Server | null = null;
  private waiting: { res: ServerResponse; headers: Headers; timer: NodeJS.Timeout } | null = null;
  private queue: BridgeJob[] = [];
  private readonly pending = new Map<string, Pending>();
  private lastSeen = 0;
  port = 0;

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  /** Starts listening. Resolves false if the port is taken (for example by another FORGEX MCP server). */
  start(port = DEFAULT_BRIDGE_PORT): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.log(`App link unavailable on port ${port}: ${error.code ?? error.message}`);
        resolve(false);
      });
      server.listen(port, '127.0.0.1', () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(true);
      });
    });
  }

  stop(): void {
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.res.destroy();
      this.waiting = null;
    }
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, error: 'The FORGEX MCP server is shutting down.' });
    }
    this.pending.clear();
    this.server?.close();
    this.server = null;
  }

  get listening(): boolean {
    return this.server !== null;
  }

  /** True while the app is polling, working on a call, or was seen in the last few seconds. */
  get connected(): boolean {
    if (!this.server) return false;
    if (this.waiting) return true;
    for (const entry of this.pending.values()) if (entry.delivered) return true;
    return Date.now() - this.lastSeen < RECENTLY_SEEN_MS;
  }

  /** Sends a tool call to the app and waits for its result. */
  call(tool: string, args: unknown, timeoutMs: number): Promise<BridgeResult> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter((job) => job.id !== id);
        resolve({ id, ok: false, error: 'FORGEX 3D did not answer in time. Check that the app is still open.' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, delivered: false });
      this.queue.push({ id, tool, args });
      this.flush();
    });
  }

  private flush(): void {
    if (!this.waiting || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    const { res, headers, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;
    const entry = this.pending.get(job.id);
    if (entry) entry.delivered = true;
    this.lastSeen = Date.now();
    this.send(res, 200, headers, job);
  }

  private send(res: ServerResponse, status: number, headers: Headers, body?: unknown): void {
    if (res.writableEnded || res.destroyed) return;
    if (body === undefined) {
      res.writeHead(status, { ...headers, 'Cache-Control': 'no-store' }).end();
      return;
    }
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      this.send(res, 403, {});
      return;
    }
    const headers: Headers = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
          Vary: 'Origin',
        }
      : {};
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    if (req.method === 'OPTIONS') return this.send(res, 204, headers);
    if (req.method === 'GET' && path === `${BRIDGE_PATH}/hello`) {
      return this.send(res, 200, headers, { name: 'forgex-3d-mcp', version: APP_VERSION });
    }
    if (req.method === 'GET' && path === `${BRIDGE_PATH}/poll`) return this.poll(res, headers);
    if (req.method === 'POST' && path === `${BRIDGE_PATH}/result`) return this.receiveResult(req, res, headers);
    this.send(res, 404, headers);
  }

  private poll(res: ServerResponse, headers: Headers): void {
    this.lastSeen = Date.now();
    if (this.waiting) {
      // One app window at a time: the newest poll replaces the older one.
      const previous = this.waiting;
      clearTimeout(previous.timer);
      this.waiting = null;
      this.send(previous.res, 204, previous.headers);
    }
    const timer = setTimeout(() => {
      if (this.waiting?.res !== res) return;
      this.waiting = null;
      this.lastSeen = Date.now();
      this.send(res, 204, headers);
    }, POLL_HOLD_MS);
    this.waiting = { res, headers, timer };
    res.on('close', () => {
      if (this.waiting?.res === res) {
        clearTimeout(this.waiting.timer);
        this.waiting = null;
        this.lastSeen = Date.now();
      }
    });
    this.flush();
  }

  private receiveResult(req: IncomingMessage, res: ServerResponse, headers: Headers): void {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        this.send(res, 413, headers);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      this.lastSeen = Date.now();
      let body: BridgeResult;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeResult;
      } catch {
        return this.send(res, 400, headers);
      }
      const entry = typeof body?.id === 'string' ? this.pending.get(body.id) : undefined;
      if (!entry) return this.send(res, 404, headers);
      clearTimeout(entry.timer);
      this.pending.delete(body.id);
      entry.resolve({ id: body.id, ok: body.ok === true, output: body.output, error: body.error });
      this.send(res, 204, headers);
    });
  }
}
