"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppBridge = exports.BRIDGE_PATH = exports.DEFAULT_BRIDGE_PORT = void 0;
const node_crypto_1 = require("node:crypto");
const node_http_1 = require("node:http");
const version_1 = require("../src/core/version");
/**
 * The link between this MCP server and the running FORGEX 3D app.
 *
 * The server listens on 127.0.0.1 only. The app long-polls GET /forgex/v1/poll for the
 * next tool call, runs it on its live editor (so it shows in the viewport and in undo
 * history), and posts the result to POST /forgex/v1/result. Requests from web pages are
 * refused unless they come from the FORGEX 3D app's own origins.
 */
exports.DEFAULT_BRIDGE_PORT = 47833;
exports.BRIDGE_PATH = '/forgex/v1';
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
class AppBridge {
    log;
    server = null;
    waiting = null;
    queue = [];
    pending = new Map();
    lastSeen = 0;
    port = 0;
    constructor(log = () => undefined) {
        this.log = log;
    }
    /** Starts listening. Resolves false if the port is taken (for example by another FORGEX MCP server). */
    start(port = exports.DEFAULT_BRIDGE_PORT) {
        return new Promise((resolve) => {
            const server = (0, node_http_1.createServer)((req, res) => this.handle(req, res));
            server.once('error', (error) => {
                this.log(`App link unavailable on port ${port}: ${error.code ?? error.message}`);
                resolve(false);
            });
            server.listen(port, '127.0.0.1', () => {
                this.server = server;
                this.port = server.address().port;
                resolve(true);
            });
        });
    }
    stop() {
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
    get listening() {
        return this.server !== null;
    }
    /** True while the app is polling, working on a call, or was seen in the last few seconds. */
    get connected() {
        if (!this.server)
            return false;
        if (this.waiting)
            return true;
        for (const entry of this.pending.values())
            if (entry.delivered)
                return true;
        return Date.now() - this.lastSeen < RECENTLY_SEEN_MS;
    }
    /** Sends a tool call to the app and waits for its result. */
    call(tool, args, timeoutMs) {
        const id = (0, node_crypto_1.randomUUID)();
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
    flush() {
        if (!this.waiting || this.queue.length === 0)
            return;
        const job = this.queue.shift();
        const { res, headers, timer } = this.waiting;
        clearTimeout(timer);
        this.waiting = null;
        const entry = this.pending.get(job.id);
        if (entry)
            entry.delivered = true;
        this.lastSeen = Date.now();
        this.send(res, 200, headers, job);
    }
    send(res, status, headers, body) {
        if (res.writableEnded || res.destroyed)
            return;
        if (body === undefined) {
            res.writeHead(status, { ...headers, 'Cache-Control': 'no-store' }).end();
            return;
        }
        res.writeHead(status, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    }
    handle(req, res) {
        const origin = req.headers.origin;
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
            this.send(res, 403, {});
            return;
        }
        const headers = origin
            ? {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Private-Network': 'true',
                Vary: 'Origin',
            }
            : {};
        const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        if (req.method === 'OPTIONS')
            return this.send(res, 204, headers);
        if (req.method === 'GET' && path === `${exports.BRIDGE_PATH}/hello`) {
            return this.send(res, 200, headers, { name: 'forgex-3d-mcp', version: version_1.APP_VERSION });
        }
        if (req.method === 'GET' && path === `${exports.BRIDGE_PATH}/poll`)
            return this.poll(res, headers);
        if (req.method === 'POST' && path === `${exports.BRIDGE_PATH}/result`)
            return this.receiveResult(req, res, headers);
        this.send(res, 404, headers);
    }
    poll(res, headers) {
        this.lastSeen = Date.now();
        if (this.waiting) {
            // One app window at a time: the newest poll replaces the older one.
            const previous = this.waiting;
            clearTimeout(previous.timer);
            this.waiting = null;
            this.send(previous.res, 204, previous.headers);
        }
        const timer = setTimeout(() => {
            if (this.waiting?.res !== res)
                return;
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
    receiveResult(req, res, headers) {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                this.send(res, 413, headers);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (size > MAX_BODY_BYTES)
                return;
            this.lastSeen = Date.now();
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            catch {
                return this.send(res, 400, headers);
            }
            const entry = typeof body?.id === 'string' ? this.pending.get(body.id) : undefined;
            if (!entry)
                return this.send(res, 404, headers);
            clearTimeout(entry.timer);
            this.pending.delete(body.id);
            entry.resolve({ id: body.id, ok: body.ok === true, output: body.output, error: body.error });
            this.send(res, 204, headers);
        });
    }
}
exports.AppBridge = AppBridge;
