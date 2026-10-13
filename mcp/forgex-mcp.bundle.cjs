// FORGEX 3D MCP server, bundled from mcp/main.ts by scripts/bundle-mcp.mjs. Do not edit by hand.
"use strict";

// mcp/bridge.ts
var import_node_crypto = require("node:crypto");
var import_node_http = require("node:http");

// src/core/version.ts
var APP_NAME = "FORGEX 3D";
var APP_VERSION = "0.2.0";

// mcp/bridge.ts
var DEFAULT_BRIDGE_PORT = 47833;
var BRIDGE_PATH = "/forgex/v1";
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420"
]);
var POLL_HOLD_MS = 25e3;
var RECENTLY_SEEN_MS = 5e3;
var MAX_BODY_BYTES = 40 * 1024 * 1024;
var AppBridge = class {
  constructor(log2 = () => void 0) {
    this.log = log2;
  }
  server = null;
  waiting = null;
  queue = [];
  pending = /* @__PURE__ */ new Map();
  lastSeen = 0;
  port = 0;
  /** Starts listening. Resolves false if the port is taken (for example by another FORGEX MCP server). */
  start(port = DEFAULT_BRIDGE_PORT) {
    return new Promise((resolve2) => {
      const server = (0, import_node_http.createServer)((req, res) => this.handle(req, res));
      server.once("error", (error) => {
        this.log(`App link unavailable on port ${port}: ${error.code ?? error.message}`);
        resolve2(false);
      });
      server.listen(port, "127.0.0.1", () => {
        this.server = server;
        this.port = server.address().port;
        resolve2(true);
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
      entry.resolve({ id, ok: false, error: "The FORGEX MCP server is shutting down." });
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
    if (!this.server) return false;
    if (this.waiting) return true;
    for (const entry of this.pending.values()) if (entry.delivered) return true;
    return Date.now() - this.lastSeen < RECENTLY_SEEN_MS;
  }
  /** Sends a tool call to the app and waits for its result. */
  call(tool, args, timeoutMs) {
    const id = (0, import_node_crypto.randomUUID)();
    return new Promise((resolve2) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter((job) => job.id !== id);
        resolve2({ id, ok: false, error: "FORGEX 3D did not answer in time. Check that the app is still open." });
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve2, timer, delivered: false });
      this.queue.push({ id, tool, args });
      this.flush();
    });
  }
  flush() {
    if (!this.waiting || this.queue.length === 0) return;
    const job = this.queue.shift();
    const { res, headers, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;
    const entry = this.pending.get(job.id);
    if (entry) entry.delivered = true;
    this.lastSeen = Date.now();
    this.send(res, 200, headers, job);
  }
  send(res, status, headers, body2) {
    if (res.writableEnded || res.destroyed) return;
    if (body2 === void 0) {
      res.writeHead(status, { ...headers, "Cache-Control": "no-store" }).end();
      return;
    }
    res.writeHead(status, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body2));
  }
  handle(req, res) {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      this.send(res, 403, {});
      return;
    }
    const headers = origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
      Vary: "Origin"
    } : {};
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "OPTIONS") return this.send(res, 204, headers);
    if (req.method === "GET" && path === `${BRIDGE_PATH}/hello`) {
      return this.send(res, 200, headers, { name: "forgex-3d-mcp", version: APP_VERSION });
    }
    if (req.method === "GET" && path === `${BRIDGE_PATH}/poll`) return this.poll(res, headers);
    if (req.method === "POST" && path === `${BRIDGE_PATH}/result`) return this.receiveResult(req, res, headers);
    this.send(res, 404, headers);
  }
  poll(res, headers) {
    this.lastSeen = Date.now();
    if (this.waiting) {
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
    res.on("close", () => {
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
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        this.send(res, 413, headers);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      this.lastSeen = Date.now();
      let body2;
      try {
        body2 = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return this.send(res, 400, headers);
      }
      const entry = typeof body2?.id === "string" ? this.pending.get(body2.id) : void 0;
      if (!entry) return this.send(res, 404, headers);
      clearTimeout(entry.timer);
      this.pending.delete(body2.id);
      entry.resolve({ id: body2.id, ok: body2.ok === true, output: body2.output, error: body2.error });
      this.send(res, 204, headers);
    });
  }
};

// mcp/fileHost.ts
var import_promises3 = require("node:fs/promises");
var import_node_path4 = require("node:path");

// src/core/automation/toolTypes.ts
var ToolError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
};
var VIEW_PRESETS = ["current", "perspective", "front", "back", "left", "right", "top", "bottom"];

// src/core/history/history.ts
var CommandHistory = class {
  constructor(limit = 500) {
    this.limit = limit;
  }
  undoStack = [];
  redoStack = [];
  seq = 0;
  /** Revision of the oldest state still reachable by undo. */
  baseSeq = 0;
  record(command, selectionBefore, selectionAfter) {
    const entry = { seq: ++this.seq, command, selectionBefore, selectionAfter };
    this.undoStack.push(entry);
    this.redoStack = [];
    while (this.undoStack.length > this.limit) {
      const dropped = this.undoStack.shift();
      this.baseSeq = dropped.seq;
    }
    return entry;
  }
  /** Moves the newest entry to the redo stack and returns it for reverting. */
  undo() {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
    return entry;
  }
  /** Moves the newest undone entry back and returns it for re-applying. */
  redo() {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
    return entry;
  }
  /** Identifies the current state. Equal revisions mean identical scenes. */
  get revision() {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].seq : this.baseSeq;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoEntries() {
    return this.undoStack;
  }
  /** Redo entries, next one first. */
  get redoEntries() {
    return [...this.redoStack].reverse();
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.baseSeq = this.seq;
  }
};

// src/core/math/vec3.ts
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a) {
  const len = length(a);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isVec3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}
function roundTo(value, decimals = 6) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function cleanVec3(v, decimals = 6) {
  return [roundTo(v[0], decimals), roundTo(v[1], decimals), roundTo(v[2], decimals)];
}

// src/core/geometry/polygon.ts
var PLANARITY_TOLERANCE = 1e-5;
function newellNormal(points) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const [xi, yi, zi] = points[i];
    const [xj, yj, zj] = points[(i + 1) % points.length];
    nx += (yi - yj) * (zi + zj);
    ny += (zi - zj) * (xi + xj);
    nz += (xi - xj) * (yi + yj);
  }
  return [nx, ny, nz];
}
function boundingDiagonal(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return points.length ? length(sub(max, min)) : 0;
}
function planeBasis(n) {
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return { u, v };
}
function projectToPlane(points, normal) {
  const { u, v } = planeBasis(normal);
  return points.map((p) => [dot(p, u), dot(p, v)]);
}
function orient2d(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a, b, p, eps) {
  return Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps && Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps;
}
function segmentsIntersect(p1, p2, p3, p4, eps) {
  const d1 = orient2d(p3, p4, p1);
  const d2 = orient2d(p3, p4, p2);
  const d3 = orient2d(p1, p2, p3);
  const d4 = orient2d(p1, p2, p4);
  if ((d1 > eps && d2 < -eps || d1 < -eps && d2 > eps) && (d3 > eps && d4 < -eps || d3 < -eps && d4 > eps)) {
    return true;
  }
  if (Math.abs(d1) <= eps && onSegment(p3, p4, p1, eps)) return true;
  if (Math.abs(d2) <= eps && onSegment(p3, p4, p2, eps)) return true;
  if (Math.abs(d3) <= eps && onSegment(p1, p2, p3, eps)) return true;
  if (Math.abs(d4) <= eps && onSegment(p1, p2, p4, eps)) return true;
  return false;
}
function isSelfIntersecting2d(points, size) {
  const n = points.length;
  if (n < 4) return false;
  const eps = Math.max(1e-12, (size * 1e-9) ** 2);
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(a1, a2, points[j], points[(j + 1) % n], eps)) return true;
    }
  }
  return false;
}
function analyzePolygon(points) {
  const raw = newellNormal(points);
  const rawLength = length(raw);
  const area = rawLength / 2;
  const size = boundingDiagonal(points);
  let centroid = [0, 0, 0];
  for (const p of points) centroid = add(centroid, p);
  centroid = points.length ? scale(centroid, 1 / points.length) : centroid;
  const areaEpsilon = Math.max(1e-14, (size * 1e-7) ** 2);
  const degenerate = points.length < 3 || area <= areaEpsilon;
  const normal = degenerate ? [0, 0, 0] : scale(raw, 1 / rawLength);
  let maxPlaneDistance = 0;
  if (!degenerate) {
    for (const p of points) {
      maxPlaneDistance = Math.max(maxPlaneDistance, Math.abs(dot(sub(p, centroid), normal)));
    }
  }
  const planar = !degenerate && maxPlaneDistance <= Math.max(1e-9, PLANARITY_TOLERANCE * size);
  const selfIntersecting = !degenerate && isSelfIntersecting2d(projectToPlane(points, normal), size);
  return { normal, area, centroid, size, maxPlaneDistance, planar, degenerate, selfIntersecting };
}
function pointInPolygon2d(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > point[1] !== yj > point[1] && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// src/core/geometry/constructionGraph.ts
var GeometryError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "GeometryError";
  }
};
function createEmptyGraph() {
  return { vertices: {}, edges: {}, faces: {}, counters: { vertex: 1, edge: 1, face: 1 } };
}
var topologyCache = /* @__PURE__ */ new WeakMap();
function pairKey(a, b) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
function getTopology(graph) {
  const cached = topologyCache.get(graph);
  if (cached) return cached;
  const topology = {
    edgeByPair: /* @__PURE__ */ new Map(),
    edgesByVertex: /* @__PURE__ */ new Map(),
    facesByEdge: /* @__PURE__ */ new Map(),
    facesByVertex: /* @__PURE__ */ new Map()
  };
  for (const edge of Object.values(graph.edges)) {
    topology.edgeByPair.set(pairKey(edge.a, edge.b), edge.id);
    pushTo(topology.edgesByVertex, edge.a, edge.id);
    pushTo(topology.edgesByVertex, edge.b, edge.id);
  }
  for (const face of Object.values(graph.faces)) {
    const loop = face.vertexIds;
    for (let i = 0; i < loop.length; i++) {
      pushTo(topology.facesByVertex, loop[i], face.id);
      const edgeId = topology.edgeByPair.get(pairKey(loop[i], loop[(i + 1) % loop.length]));
      if (edgeId) pushTo(topology.facesByEdge, edgeId, face.id);
    }
  }
  topologyCache.set(graph, topology);
  return topology;
}
function shareTopology(from, to) {
  const cached = topologyCache.get(from);
  if (cached) topologyCache.set(to, cached);
  return to;
}
function findEdge(graph, a, b) {
  const id = getTopology(graph).edgeByPair.get(pairKey(a, b));
  return id ? graph.edges[id] : void 0;
}
function requireVertex(graph, id) {
  const vertex = graph.vertices[id];
  if (!vertex) throw new GeometryError("missing-vertex", `Vertex ${id} does not exist.`);
  return vertex;
}
function requirePosition(position) {
  if (!isVec3(position)) throw new GeometryError("invalid-position", "A vertex position must be three finite numbers.");
  return [position[0], position[1], position[2]];
}
function addVertex(graph, position) {
  const id = `v${graph.counters.vertex}`;
  const vertex = { id, position: requirePosition(position) };
  return {
    vertexId: id,
    graph: {
      ...graph,
      vertices: { ...graph.vertices, [id]: vertex },
      counters: { ...graph.counters, vertex: graph.counters.vertex + 1 }
    }
  };
}
function moveVertex(graph, vertexId, position) {
  requireVertex(graph, vertexId);
  const next = {
    ...graph,
    vertices: { ...graph.vertices, [vertexId]: { id: vertexId, position: requirePosition(position) } }
  };
  return shareTopology(graph, next);
}
function removeVertex(graph, vertexId) {
  requireVertex(graph, vertexId);
  const topology = getTopology(graph);
  const doomedEdges = new Set(topology.edgesByVertex.get(vertexId) ?? []);
  const doomedFaces = new Set(topology.facesByVertex.get(vertexId) ?? []);
  const vertices = { ...graph.vertices };
  delete vertices[vertexId];
  return {
    ...graph,
    vertices,
    edges: omit(graph.edges, doomedEdges),
    faces: omit(graph.faces, doomedFaces)
  };
}
function addEdge(graph, a, b) {
  requireVertex(graph, a);
  requireVertex(graph, b);
  if (a === b) throw new GeometryError("self-loop", "An edge needs two different vertices.");
  const existing = findEdge(graph, a, b);
  if (existing) return { graph, edgeId: existing.id, created: false };
  const id = `e${graph.counters.edge}`;
  return {
    edgeId: id,
    created: true,
    graph: {
      ...graph,
      edges: { ...graph.edges, [id]: { id, a, b } },
      counters: { ...graph.counters, edge: graph.counters.edge + 1 }
    }
  };
}
function removeEdge(graph, edgeId) {
  if (!graph.edges[edgeId]) throw new GeometryError("missing-edge", `Edge ${edgeId} does not exist.`);
  const doomedFaces = new Set(getTopology(graph).facesByEdge.get(edgeId) ?? []);
  return { ...graph, edges: omit(graph.edges, /* @__PURE__ */ new Set([edgeId])), faces: omit(graph.faces, doomedFaces) };
}
function cycleKey(vertexIds) {
  return [...vertexIds].sort().join("\0");
}
function checkLoop(graph, vertexIds, options = {}) {
  const requirePlanar = options.requirePlanar ?? true;
  if (vertexIds.length < 3) throw new GeometryError("too-few-vertices", "A face needs at least 3 vertices.");
  const seen = /* @__PURE__ */ new Set();
  for (const id of vertexIds) {
    requireVertex(graph, id);
    if (seen.has(id)) throw new GeometryError("repeated-vertex", `Vertex ${id} appears twice in the loop.`);
    seen.add(id);
  }
  const topology = getTopology(graph);
  for (let i = 0; i < vertexIds.length; i++) {
    const a = vertexIds[i];
    const b = vertexIds[(i + 1) % vertexIds.length];
    const edgeId = topology.edgeByPair.get(pairKey(a, b));
    if (!edgeId) throw new GeometryError("missing-edge", `Vertices ${a} and ${b} are not connected by an edge.`);
    const usage = topology.facesByEdge.get(edgeId)?.length ?? 0;
    if (usage >= 2) {
      throw new GeometryError("non-manifold-edge", `Edge ${edgeId} already borders two faces; a third would make it non-manifold.`);
    }
  }
  const key = cycleKey(vertexIds);
  for (const face of Object.values(graph.faces)) {
    if (face.vertexIds.length === vertexIds.length && cycleKey(face.vertexIds) === key) {
      throw new GeometryError("duplicate-face", `Face ${face.id} already fills this loop.`);
    }
  }
  const analysis = analyzePolygon(vertexIds.map((id) => graph.vertices[id].position));
  if (analysis.degenerate) throw new GeometryError("zero-area", "The loop encloses no area.");
  if (requirePlanar && !analysis.planar) throw new GeometryError("non-planar", "The loop\u2019s points are not on one plane.");
  if (analysis.selfIntersecting) throw new GeometryError("self-intersecting", "The loop\u2019s outline crosses itself.");
}
function addFace(graph, vertexIds, options = {}) {
  checkLoop(graph, vertexIds, options);
  const id = `f${graph.counters.face}`;
  return {
    faceId: id,
    graph: {
      ...graph,
      faces: { ...graph.faces, [id]: { id, vertexIds: [...vertexIds] } },
      counters: { ...graph.counters, face: graph.counters.face + 1 }
    }
  };
}
function removeFace(graph, faceId) {
  if (!graph.faces[faceId]) throw new GeometryError("missing-face", `Face ${faceId} does not exist.`);
  return { ...graph, faces: omit(graph.faces, /* @__PURE__ */ new Set([faceId])) };
}
function reverseLoop(vertexIds) {
  return [vertexIds[0], ...vertexIds.slice(1).reverse()];
}
function omit(record, ids) {
  if (ids.size === 0) return { ...record };
  const out = {};
  for (const [key, value] of Object.entries(record)) if (!ids.has(key)) out[key] = value;
  return out;
}
function graphCounts(graph) {
  let triangles = 0;
  for (const face of Object.values(graph.faces)) triangles += Math.max(0, face.vertexIds.length - 2);
  return {
    vertices: Object.keys(graph.vertices).length,
    edges: Object.keys(graph.edges).length,
    faces: Object.keys(graph.faces).length,
    triangles
  };
}

// src/core/geometry/orientation.ts
function loopRunsEdge(loop, a, b) {
  for (let i = 0; i < loop.length; i++) {
    if (loop[i] === a && loop[(i + 1) % loop.length] === b) return true;
  }
  return false;
}
function orientFaces(graph) {
  const topology = getTopology(graph);
  const faces = graph.faces;
  const reversed = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  const finalFlip = /* @__PURE__ */ new Set();
  const effectiveLoop = (face) => reversed.get(face.id) ? reverseLoop(face.vertexIds) : face.vertexIds;
  for (const seed of Object.values(faces)) {
    if (visited.has(seed.id)) continue;
    const component = [];
    const queue = [seed.id];
    visited.add(seed.id);
    reversed.set(seed.id, false);
    while (queue.length > 0) {
      const faceId = queue.shift();
      component.push(faceId);
      const loop = effectiveLoop(faces[faceId]);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const edgeId = topology.edgeByPair.get(pairKey(a, b));
        const neighbours = edgeId ? topology.facesByEdge.get(edgeId) ?? [] : [];
        if (neighbours.length !== 2) continue;
        const otherId = neighbours[0] === faceId ? neighbours[1] : neighbours[0];
        if (visited.has(otherId)) continue;
        reversed.set(otherId, loopRunsEdge(faces[otherId].vertexIds, a, b));
        visited.add(otherId);
        queue.push(otherId);
      }
    }
    const closed = component.every((faceId) => {
      const loop = faces[faceId].vertexIds;
      return loop.every((a, i) => {
        const edgeId = topology.edgeByPair.get(pairKey(a, loop[(i + 1) % loop.length]));
        return edgeId !== void 0 && (topology.facesByEdge.get(edgeId)?.length ?? 0) === 2;
      });
    });
    let flipComponent = false;
    if (closed) {
      let volume = 0;
      for (const faceId of component) {
        const points = effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position);
        for (let i = 1; i < points.length - 1; i++) volume += dot(points[0], cross(points[i], points[i + 1]));
      }
      flipComponent = volume < 0;
    } else {
      let sum = [0, 0, 0];
      for (const faceId of component) {
        sum = add(sum, newellNormal(effectiveLoop(faces[faceId]).map((id) => graph.vertices[id].position)));
      }
      const axis = [0, 1, 2].reduce((best, k) => Math.abs(sum[k]) > Math.abs(sum[best]) ? k : best, 1);
      flipComponent = sum[axis] < 0;
    }
    for (const faceId of component) {
      if (reversed.get(faceId) !== flipComponent) finalFlip.add(faceId);
    }
  }
  if (finalFlip.size === 0) return { graph, flipped: [] };
  const nextFaces = { ...faces };
  for (const faceId of finalFlip) {
    nextFaces[faceId] = { id: faceId, vertexIds: reverseLoop(faces[faceId].vertexIds) };
  }
  return { graph: { ...graph, faces: nextFaces }, flipped: [...finalFlip] };
}
function findInconsistentEdges(graph) {
  const topology = getTopology(graph);
  const out = [];
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id) ?? [];
    if (users.length !== 2) continue;
    const [f1, f2] = users.map((id) => graph.faces[id].vertexIds);
    if (loopRunsEdge(f1, edge.a, edge.b) === loopRunsEdge(f2, edge.a, edge.b)) out.push(edge.id);
  }
  return out;
}

// src/core/geometry/loops.ts
function findClosedLoops(graph, options = {}) {
  const maxLength = options.maxLength ?? 12;
  const maxSteps = options.maxSteps ?? 2e5;
  const topology = getTopology(graph);
  const vertexIds = Object.keys(graph.vertices);
  const order = new Map(vertexIds.map((id, i) => [id, i]));
  const adjacency = /* @__PURE__ */ new Map();
  for (const edge of Object.values(graph.edges)) {
    if ((topology.facesByEdge.get(edge.id)?.length ?? 0) >= 2) continue;
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const existing = new Set(Object.values(graph.faces).map((face) => cycleKey(face.vertexIds)));
  const loops = [];
  const found = /* @__PURE__ */ new Set();
  let steps = 0;
  let truncated = false;
  for (const start of vertexIds) {
    if (truncated) break;
    const startOrder = order.get(start);
    const path = [start];
    const onPath = new Set(path);
    const visit = (current) => {
      for (const next of adjacency.get(current) ?? []) {
        if (truncated) return;
        if (next === start) {
          if (path.length >= 3 && order.get(path[1]) < order.get(path[path.length - 1])) {
            const key = cycleKey(path);
            if (!found.has(key) && !existing.has(key) && isFaceCandidate(graph, topology, path)) {
              found.add(key);
              loops.push([...path]);
            }
          }
          continue;
        }
        if (onPath.has(next) || order.get(next) <= startOrder || path.length >= maxLength) continue;
        if (++steps > maxSteps) {
          truncated = true;
          return;
        }
        path.push(next);
        onPath.add(next);
        visit(next);
        path.pop();
        onPath.delete(next);
      }
    };
    visit(start);
  }
  loops.sort((a, b) => a.length - b.length);
  return { loops, truncated };
}
function isFaceCandidate(graph, topology, loop) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (topology.edgeByPair.has(pairKey(loop[i], loop[j]))) return false;
    }
  }
  const points = loop.map((id) => graph.vertices[id].position);
  const analysis = analyzePolygon(points);
  if (!analysis.planar || analysis.degenerate || analysis.selfIntersecting) return false;
  const tolerance = Math.max(1e-9, 1e-5 * analysis.size);
  const onLoop = new Set(loop);
  const outline = projectToPlane(points, analysis.normal);
  for (const vertex of Object.values(graph.vertices)) {
    if (onLoop.has(vertex.id)) continue;
    if (Math.abs(dot(sub(vertex.position, analysis.centroid), analysis.normal)) > tolerance) continue;
    const [projected] = projectToPlane([vertex.position], analysis.normal);
    if (pointInPolygon2d(projected, outline)) return false;
  }
  return true;
}
function fillClosedLoops(graph, options = {}) {
  const { loops, truncated } = findClosedLoops(graph, options);
  let next = graph;
  const faceIds = [];
  let skipped = 0;
  for (const loop of loops) {
    try {
      const result2 = addFace(next, loop);
      next = result2.graph;
      faceIds.push(result2.faceId);
    } catch (error) {
      if (error instanceof GeometryError) skipped++;
      else throw error;
    }
  }
  if (faceIds.length > 0) next = orientFaces(next).graph;
  return { graph: next, faceIds, skipped, truncated };
}

// src/core/geometry/builders.ts
function buildCubeGraph(size = 1) {
  const h = size / 2;
  const corners = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, -h, h],
    [-h, -h, h],
    [-h, h, -h],
    [h, h, -h],
    [h, h, h],
    [-h, h, h]
  ];
  let graph = createEmptyGraph();
  const ids = [];
  for (const corner of corners) {
    const result2 = addVertex(graph, corner);
    graph = result2.graph;
    ids.push(result2.vertexId);
  }
  const links = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ];
  for (const [a, b] of links) graph = addEdge(graph, ids[a], ids[b]).graph;
  return fillClosedLoops(graph).graph;
}
function buildPlaneGraph(size = 1) {
  const h = size / 2;
  const corners = [[-h, 0, -h], [-h, 0, h], [h, 0, h], [h, 0, -h]];
  let graph = createEmptyGraph();
  const ids = [];
  for (const corner of corners) {
    const result2 = addVertex(graph, corner);
    graph = result2.graph;
    ids.push(result2.vertexId);
  }
  for (let i = 0; i < 4; i++) graph = addEdge(graph, ids[i], ids[(i + 1) % 4]).graph;
  return addFace(graph, ids).graph;
}

// src/core/ids.ts
function randomId(prefix) {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
function createObjectId() {
  return randomId("obj");
}

// src/core/math/transform.ts
var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;
function identityTransform() {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}
function cloneTransform(t) {
  return { position: [...t.position], rotation: [...t.rotation], scale: [...t.scale] };
}
function cleanTransform(t, decimals = 6) {
  return {
    position: cleanVec3(t.position, decimals),
    rotation: cleanVec3(t.rotation, decimals),
    scale: cleanVec3(t.scale, decimals)
  };
}
function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function composeMatrix(t) {
  const [rx, ry, rz] = t.rotation.map((deg) => deg * DEG_TO_RAD);
  const [sx, sy, sz] = t.scale;
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  const r00 = c * e;
  const r01 = -c * f;
  const r02 = d;
  const r10 = af + be * d;
  const r11 = ae - bf * d;
  const r12 = -b * c;
  const r20 = bf - ae * d;
  const r21 = be + af * d;
  const r22 = a * c;
  return [
    r00 * sx,
    r10 * sx,
    r20 * sx,
    0,
    r01 * sy,
    r11 * sy,
    r21 * sy,
    0,
    r02 * sz,
    r12 * sz,
    r22 * sz,
    0,
    t.position[0],
    t.position[1],
    t.position[2],
    1
  ];
}
function multiplyMatrices(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
function invertAffine(m) {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const n00 = (e * i - f * h) * inv;
  const n01 = (c * h - b * i) * inv;
  const n02 = (b * f - c * e) * inv;
  const n10 = (f * g - d * i) * inv;
  const n11 = (a * i - c * g) * inv;
  const n12 = (c * d - a * f) * inv;
  const n20 = (d * h - e * g) * inv;
  const n21 = (b * g - a * h) * inv;
  const n22 = (a * e - b * d) * inv;
  const tx = m[12], ty = m[13], tz = m[14];
  return [
    n00,
    n10,
    n20,
    0,
    n01,
    n11,
    n21,
    0,
    n02,
    n12,
    n22,
    0,
    -(n00 * tx + n01 * ty + n02 * tz),
    -(n10 * tx + n11 * ty + n12 * tz),
    -(n20 * tx + n21 * ty + n22 * tz),
    1
  ];
}
function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  ];
}
function decomposeMatrix(m) {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) sx = -sx;
  const ix = sx === 0 ? 1 : 1 / sx;
  const iy = sy === 0 ? 1 : 1 / sy;
  const iz = sz === 0 ? 1 : 1 / sz;
  const m11 = m[0] * ix;
  const m12 = m[4] * iy;
  const m13 = m[8] * iz;
  const m22 = m[5] * iy;
  const m23 = m[9] * iz;
  const m32 = m[6] * iy;
  const m33 = m[10] * iz;
  const y = Math.asin(Math.min(1, Math.max(-1, m13)));
  let x;
  let z;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return {
    position: [m[12], m[13], m[14]],
    rotation: [x * RAD_TO_DEG, y * RAD_TO_DEG, z * RAD_TO_DEG],
    scale: [sx, sy, sz]
  };
}

// src/core/geometry/graphBuilder.ts
var GraphBuilder = class {
  vertices = {};
  edges = {};
  faces = {};
  edgeByPair = /* @__PURE__ */ new Map();
  edgeUse = /* @__PURE__ */ new Map();
  nextVertex = 1;
  nextEdge = 1;
  nextFace = 1;
  /** Faces that broke an invariant and were left out. */
  skippedFaces = 0;
  vertex(position) {
    const id = `v${this.nextVertex++}`;
    this.vertices[id] = { id, position: [position[0], position[1], position[2]] };
    return id;
  }
  edge(a, b) {
    if (a === b) return null;
    const key = pairKey(a, b);
    const existing = this.edgeByPair.get(key);
    if (existing) return existing;
    const id = `e${this.nextEdge++}`;
    this.edges[id] = { id, a, b };
    this.edgeByPair.set(key, id);
    return id;
  }
  /** Adds a face (creating its edges). Returns false and counts a skip if it breaks an invariant. */
  face(loop) {
    const ids = loop.filter((id2, i) => id2 !== loop[(i + 1) % loop.length]);
    if (ids.length < 3 || new Set(ids).size !== ids.length) {
      this.skippedFaces++;
      return false;
    }
    if (analyzePolygon(ids.map((id2) => this.vertices[id2].position)).degenerate) {
      this.skippedFaces++;
      return false;
    }
    const keys = ids.map((id2, i) => pairKey(id2, ids[(i + 1) % ids.length]));
    if (keys.some((key) => (this.edgeUse.get(key) ?? 0) >= 2)) {
      this.skippedFaces++;
      return false;
    }
    ids.forEach((id2, i) => this.edge(id2, ids[(i + 1) % ids.length]));
    keys.forEach((key) => this.edgeUse.set(key, (this.edgeUse.get(key) ?? 0) + 1));
    const id = `f${this.nextFace++}`;
    this.faces[id] = { id, vertexIds: ids };
    return true;
  }
  build() {
    return {
      vertices: this.vertices,
      edges: this.edges,
      faces: this.faces,
      counters: { vertex: this.nextVertex, edge: this.nextEdge, face: this.nextFace }
    };
  }
};

// src/core/sketch/sketch.ts
var SKETCH_PLANES = ["front", "side", "top"];
var SHAPE_MODES = ["flat", "extrude", "revolve"];
var REVOLVE_AXES = ["vertical", "horizontal"];
var DEFAULT_CURVE_STEPS = 10;
var MIN_CURVE_STEPS = 2;
var MAX_CURVE_STEPS = 48;
var DEFAULT_SHAPE = { mode: "extrude", depth: 0.2, segments: 32, mirror: false, axis: "vertical", curveSteps: DEFAULT_CURVE_STEPS };
var MIN_SEGMENTS = 3;
var MAX_SEGMENTS = 256;
var MAX_DEPTH = 1e3;
var AXIS_EPSILON = 1e-6;
var SketchError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SketchError";
  }
};
function createSketch(plane = "front") {
  return { plane, points: {}, lines: {}, counters: { point: 1, line: 1 } };
}
function linePairKey(a, b) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}
function findLine(sketch, a, b) {
  const key = linePairKey(a, b);
  return Object.values(sketch.lines).find((line) => linePairKey(line.a, line.b) === key);
}
function addPoint(sketch, x, y, smooth = false) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new SketchError("A dot needs finite x and y positions.");
  const id = `p${sketch.counters.point}`;
  return {
    pointId: id,
    sketch: {
      ...sketch,
      points: { ...sketch.points, [id]: smooth ? { id, x, y, smooth: true } : { id, x, y } },
      counters: { ...sketch.counters, point: sketch.counters.point + 1 }
    }
  };
}
function addLine(sketch, a, b) {
  if (!sketch.points[a] || !sketch.points[b]) throw new SketchError("A line must join two existing dots.");
  if (a === b) throw new SketchError("A line needs two different dots.");
  const existing = findLine(sketch, a, b);
  if (existing) return { sketch, lineId: existing.id, created: false };
  const id = `l${sketch.counters.line}`;
  return {
    lineId: id,
    created: true,
    sketch: {
      ...sketch,
      lines: { ...sketch.lines, [id]: { id, a, b } },
      counters: { ...sketch.counters, line: sketch.counters.line + 1 }
    }
  };
}
function movePoint(sketch, id, x, y) {
  const p = sketch.points[id];
  if (!p) throw new SketchError(`Dot ${id} does not exist.`);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) throw new SketchError("A dot needs finite x and y positions.");
  return { ...sketch, points: { ...sketch.points, [id]: { ...p, x, y } } };
}
function setPointsSmooth(sketch, ids, smooth) {
  const points = { ...sketch.points };
  let changed = false;
  for (const id of ids) {
    const p = sketch.points[id];
    if (!p || !!p.smooth === smooth) continue;
    points[id] = smooth ? { ...p, smooth: true } : { id: p.id, x: p.x, y: p.y };
    changed = true;
  }
  return changed ? { ...sketch, points } : sketch;
}
function removePoint(sketch, id) {
  if (!sketch.points[id]) throw new SketchError(`Dot ${id} does not exist.`);
  const points = { ...sketch.points };
  delete points[id];
  const lines = {};
  for (const line of Object.values(sketch.lines)) if (line.a !== id && line.b !== id) lines[line.id] = line;
  return { ...sketch, points, lines };
}
function removeLine(sketch, id) {
  if (!sketch.lines[id]) throw new SketchError(`Line ${id} does not exist.`);
  const lines = { ...sketch.lines };
  delete lines[id];
  return { ...sketch, lines };
}
function setPlane(sketch, plane) {
  return plane === sketch.plane ? sketch : { ...sketch, plane };
}
function addPolyline(sketch, points, closed, smooth = false) {
  let next = sketch;
  const ids = [];
  for (const [i, [x, y]] of points.entries()) {
    const added = addPoint(next, x, y, typeof smooth === "function" ? smooth(i) : smooth);
    next = added.sketch;
    ids.push(added.pointId);
  }
  for (let i = 0; i + 1 < ids.length; i++) next = addLine(next, ids[i], ids[i + 1]).sketch;
  if (closed && ids.length >= 3) next = addLine(next, ids[ids.length - 1], ids[0]).sketch;
  return { sketch: next, pointIds: ids };
}
function polygonPoints(cx, cy, radius, sides) {
  const n = Math.max(3, Math.min(256, Math.round(sides)));
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}
function clampInt(value, min, max, fallback) {
  return Math.min(max, Math.max(min, Math.round(isFiniteNumber(value) ? value : fallback)));
}
function clampShape(shape) {
  return {
    mode: SHAPE_MODES.includes(shape.mode) ? shape.mode : DEFAULT_SHAPE.mode,
    depth: Math.min(MAX_DEPTH, Math.max(0, isFiniteNumber(shape.depth) ? shape.depth : DEFAULT_SHAPE.depth)),
    segments: clampInt(shape.segments, MIN_SEGMENTS, MAX_SEGMENTS, DEFAULT_SHAPE.segments),
    mirror: shape.mirror === true,
    axis: REVOLVE_AXES.includes(shape.axis) ? shape.axis : "vertical",
    curveSteps: clampInt(shape.curveSteps, MIN_CURVE_STEPS, MAX_CURVE_STEPS, DEFAULT_CURVE_STEPS)
  };
}

// src/core/sketch/regions.ts
function mirrorId(id) {
  return `${id}~m`;
}
function baseId(id) {
  return id.endsWith("~m") ? id.slice(0, -2) : id;
}
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
function resolveSketch(sketch, mirror, curveSteps = DEFAULT_CURVE_STEPS) {
  const points = /* @__PURE__ */ new Map();
  const onAxis = (x) => Math.abs(x) <= AXIS_EPSILON;
  for (const p of Object.values(sketch.points)) {
    points.set(p.id, [mirror && onAxis(p.x) ? 0 : p.x, p.y]);
    if (mirror && !onAxis(p.x)) points.set(mirrorId(p.id), [-p.x, p.y]);
  }
  const mirrored = (id) => mirror && points.has(mirrorId(id)) ? mirrorId(id) : id;
  const seen = /* @__PURE__ */ new Set();
  const lines = [];
  const push = (a, b, lineId) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ a, b, lineId });
  };
  for (const line of Object.values(sketch.lines)) {
    push(line.a, line.b, line.id);
    if (mirror) push(mirrored(line.a), mirrored(line.b), null);
  }
  const neighbours = /* @__PURE__ */ new Map();
  for (const { a, b } of lines) {
    if (!neighbours.has(a)) neighbours.set(a, []);
    if (!neighbours.has(b)) neighbours.set(b, []);
    neighbours.get(a).push(b);
    neighbours.get(b).push(a);
  }
  const steps = Math.max(1, Math.round(curveSteps));
  const handle = (from, to, length2) => {
    if (!sketch.points[baseId(from)]?.smooth) return null;
    const around = neighbours.get(from) ?? [];
    if (around.length !== 2) return null;
    const other = around[0] === to ? around[1] : around[0];
    const pf = points.get(from);
    const pt = points.get(to);
    const po = points.get(other);
    const dx = pt[0] - po[0];
    const dy = pt[1] - po[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-12) return null;
    return [pf[0] + dx / d * (length2 / 3), pf[1] + dy / d * (length2 / 3)];
  };
  const segments = [];
  const paths = [];
  for (const { a, b, lineId } of lines) {
    const pa = points.get(a);
    const pb = points.get(b);
    const length2 = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const ha = handle(a, b, length2);
    const hb = handle(b, a, length2);
    if (!ha && !hb) {
      segments.push([a, b]);
      paths.push({ a, b, points: [pa, pb], lineId });
      continue;
    }
    const c1 = ha ?? pa;
    const c2 = hb ?? pb;
    const path = [pa];
    let previous = a;
    for (let k = 1; k < steps; k++) {
      const id = `${a}>${b}:${k}`;
      const p = bezier(pa, c1, c2, pb, k / steps);
      points.set(id, p);
      path.push(p);
      segments.push([previous, id]);
      previous = id;
    }
    segments.push([previous, b]);
    path.push(pb);
    paths.push({ a, b, points: path, lineId });
  }
  return { points, segments, paths };
}
function signedArea(loop, points) {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = points.get(loop[i]);
    const [x2, y2] = points.get(loop[(i + 1) % loop.length]);
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function cross2(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function interiorPoint(polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[(i - 1 + n) % n];
    const b = polygon[i];
    const c = polygon[(i + 1) % n];
    if (cross2(a, b, c) <= 1e-14) continue;
    const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (pointInPolygon(centre, polygon)) return centre;
  }
  return polygon[0];
}
function findRegions(resolved) {
  const { points } = resolved;
  const neighbours = /* @__PURE__ */ new Map();
  for (const [a, b] of resolved.segments) {
    if (!points.has(a) || !points.has(b)) continue;
    const pa = points.get(a);
    const pb = points.get(b);
    if (pa[0] === pb[0] && pa[1] === pb[1]) continue;
    if (!neighbours.has(a)) neighbours.set(a, /* @__PURE__ */ new Set());
    if (!neighbours.has(b)) neighbours.set(b, /* @__PURE__ */ new Set());
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  }
  const degree = new Map([...neighbours].map(([id, set]) => [id, set.size]));
  const stack = [...degree].filter(([, d]) => d <= 1).map(([id]) => id);
  const removed = /* @__PURE__ */ new Set();
  while (stack.length) {
    const id = stack.pop();
    if (removed.has(id)) continue;
    removed.add(id);
    for (const other of neighbours.get(id) ?? []) {
      if (removed.has(other)) continue;
      const d = (degree.get(other) ?? 0) - 1;
      degree.set(other, d);
      if (d <= 1) stack.push(other);
    }
  }
  const sorted = /* @__PURE__ */ new Map();
  for (const [id, set] of neighbours) {
    if (removed.has(id)) continue;
    const [x, y] = points.get(id);
    const list = [...set].filter((n) => !removed.has(n));
    list.sort((m, n) => {
      const pm = points.get(m);
      const pn = points.get(n);
      return Math.atan2(pm[1] - y, pm[0] - x) - Math.atan2(pn[1] - y, pn[0] - x);
    });
    sorted.set(id, list);
  }
  const visited = /* @__PURE__ */ new Set();
  const faces = [];
  for (const [start, list] of sorted) {
    for (const next of list) {
      const startKey = `${start}>${next}`;
      if (visited.has(startKey)) continue;
      const loop = [];
      let a = start;
      let b = next;
      let guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 1e5) {
        visited.add(`${a}>${b}`);
        loop.push(a);
        const around = sorted.get(b);
        const index = around.indexOf(a);
        const c = around[(index - 1 + around.length) % around.length];
        a = b;
        b = c;
      }
      if (loop.length < 3 || new Set(loop).size !== loop.length) continue;
      const area = signedArea(loop, points);
      if (area > 1e-12) faces.push({ loop, area, polygon: loop.map((id) => points.get(id)) });
    }
  }
  const samples = faces.map((face) => interiorPoint(face.polygon));
  const depth = faces.map(
    (face, i) => faces.reduce((count, other, j) => count + (j !== i && other.area > face.area && pointInPolygon(samples[i], other.polygon) ? 1 : 0), 0)
  );
  const regions = [];
  faces.forEach((face, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes = [];
    faces.forEach((other, j) => {
      if (depth[j] !== depth[i] + 1 || !pointInPolygon(samples[j], face.polygon)) return;
      holes.push([...other.loop].reverse());
    });
    regions.push({ outer: face.loop, holes, area: face.area - holes.reduce((s, h) => s + Math.abs(signedArea(h, points)), 0) });
  });
  return regions;
}
function segmentsCross(a, b, c, d) {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return (d1 > 1e-12 && d2 < -1e-12 || d1 < -1e-12 && d2 > 1e-12) && (d3 > 1e-12 && d4 < -1e-12 || d3 < -1e-12 && d4 > 1e-12);
}
function triangulateRegion(region, points) {
  let ring = [...region.outer];
  const holes = [...region.holes].sort(
    (h1, h2) => Math.max(...h2.map((id) => points.get(id)[0])) - Math.max(...h1.map((id) => points.get(id)[0]))
  );
  const allEdges = () => {
    const edges = [];
    const loops = [ring, ...holes];
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) edges.push([points.get(loop[i]), points.get(loop[(i + 1) % loop.length])]);
    }
    return edges;
  };
  for (const hole of holes) {
    const holeStart = hole.reduce((best, id, i) => points.get(id)[0] > points.get(hole[best])[0] ? i : best, 0);
    const m = points.get(hole[holeStart]);
    const edges = allEdges();
    let bestIndex = -1;
    let bestDistance = Infinity;
    ring.forEach((id, i) => {
      const p = points.get(id);
      const distance = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (distance >= bestDistance) return;
      if (edges.some(([e1, e2]) => segmentsCross(m, p, e1, e2))) return;
      bestDistance = distance;
      bestIndex = i;
    });
    if (bestIndex < 0) bestIndex = 0;
    const rotatedHole = [...hole.slice(holeStart), ...hole.slice(0, holeStart)];
    ring = [...ring.slice(0, bestIndex + 1), ...rotatedHole, rotatedHole[0], ...ring.slice(bestIndex)];
  }
  const remaining = ring.map((_, i) => i);
  const pos = (i) => points.get(ring[i]);
  const triangles = [];
  let guard = 0;
  while (remaining.length > 3 && guard++ < ring.length * ring.length * 2) {
    let clipped = false;
    for (let k = 0; k < remaining.length; k++) {
      const ia = remaining[(k - 1 + remaining.length) % remaining.length];
      const ib = remaining[k];
      const ic = remaining[(k + 1) % remaining.length];
      const a = pos(ia);
      const b = pos(ib);
      const c = pos(ic);
      if (cross2(a, b, c) <= 1e-14) continue;
      let blocked = false;
      for (const other of remaining) {
        if (other === ia || other === ib || other === ic) continue;
        const p = pos(other);
        if (p[0] === a[0] && p[1] === a[1] || p[0] === b[0] && p[1] === b[1] || p[0] === c[0] && p[1] === c[1]) continue;
        if (cross2(a, b, p) > 0 && cross2(b, c, p) > 0 && cross2(c, a, p) > 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push([ring[ia], ring[ib], ring[ic]]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      remaining.splice(0, 1);
    }
  }
  if (remaining.length === 3) triangles.push([ring[remaining[0]], ring[remaining[1]], ring[remaining[2]]]);
  return triangles.filter(([a, b, c]) => a !== b && b !== c && a !== c && cross2(points.get(a), points.get(b), points.get(c)) > 1e-14);
}

// src/core/sketch/body.ts
var BODY_VIEWS = ["side", "top", "front"];
var DEFAULT_BODY = { stations: 48, sectionPoints: 40, roundness: 4, symmetric: true, curveSteps: DEFAULT_CURVE_STEPS };
var BODY_LIMITS = {
  stations: [4, 200],
  sectionPoints: [8, 160],
  roundness: [1.5, 12]
};
function clampNumber(value, [min, max], fallback, round2) {
  const n = isFiniteNumber(value) ? value : fallback;
  return Math.min(max, Math.max(min, round2 ? Math.round(n) : n));
}
function clampBody(raw) {
  return {
    stations: clampNumber(raw.stations, BODY_LIMITS.stations, DEFAULT_BODY.stations, true),
    sectionPoints: clampNumber(raw.sectionPoints, BODY_LIMITS.sectionPoints, DEFAULT_BODY.sectionPoints, true),
    roundness: clampNumber(raw.roundness, BODY_LIMITS.roundness, DEFAULT_BODY.roundness, false),
    symmetric: raw.symmetric !== false,
    curveSteps: clampNumber(raw.curveSteps, [MIN_CURVE_STEPS, MAX_CURVE_STEPS], DEFAULT_CURVE_STEPS, true)
  };
}
function createBodyViews() {
  return { side: createSketch("side"), top: createSketch("top"), front: createSketch("front") };
}
function viewOutline(sketch, mirror, curveSteps) {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const regions = findRegions(resolved);
  if (regions.length === 0) return null;
  const largest = regions.reduce((best, region) => region.area > best.area ? region : best);
  return largest.outer.map((id) => resolved.points.get(id));
}
function crossings(polygon, along, value) {
  const other = along === 0 ? 1 : 0;
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    if (value < lo || value >= hi || hi === lo) continue;
    const t = (value - a[along]) / (b[along] - a[along]);
    out.push(a[other] + t * (b[other] - a[other]));
  }
  return out.sort((m, n) => m - n);
}
function extent(polygon, index) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    min = Math.min(min, p[index]);
    max = Math.max(max, p[index]);
  }
  return [min, max];
}
function resample(polygon, count) {
  if (polygon.length >= count) {
    const lengths = polygon.map((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    const total = lengths.reduce((s, l) => s + l, 0);
    const out2 = [];
    let edge = 0;
    let walked = 0;
    for (let k = 0; k < count; k++) {
      const target = total * k / count;
      while (edge < polygon.length - 1 && walked + lengths[edge] < target) walked += lengths[edge++];
      const p = polygon[edge];
      const q = polygon[(edge + 1) % polygon.length];
      const t = lengths[edge] > 0 ? (target - walked) / lengths[edge] : 0;
      out2.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
    return out2;
  }
  const out = [...polygon];
  while (out.length < count) {
    let longest = 0;
    let best = -1;
    for (let i = 0; i < out.length; i++) {
      const p2 = out[i];
      const q2 = out[(i + 1) % out.length];
      const l = Math.hypot(q2[0] - p2[0], q2[1] - p2[1]);
      if (l > best) {
        best = l;
        longest = i;
      }
    }
    const p = out[longest];
    const q = out[(longest + 1) % out.length];
    out.splice(longest + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  }
  return out;
}
function sectionShape(front, settings) {
  const m = settings.sectionPoints;
  if (front) {
    const [x0, x1] = extent(front, 0);
    const [y0, y1] = extent(front, 1);
    const cx = (x0 + x1) / 2;
    const hw = (x1 - x0) / 2;
    const h = y1 - y0;
    if (hw > 1e-9 && h > 1e-9) {
      let start = 0;
      let best = Infinity;
      front.forEach(([x, y], i) => {
        const d = Math.hypot((x - cx) / hw, (y - y0) / h);
        if (d < best) {
          best = d;
          start = i;
        }
      });
      const rotated = [...front.slice(start), ...front.slice(0, start)];
      return resample(rotated, m).map(([x, y]) => [(x - cx) / hw, (y - y0) / h]);
    }
  }
  const exponent = 2 / settings.roundness;
  return Array.from({ length: m }, (_, k) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * k / m;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const u = Math.sign(c) * Math.abs(c) ** exponent;
    const w = Math.sign(s) * Math.abs(s) ** exponent;
    return [u, (w + 1) / 2];
  });
}
function outlines(views2, settings) {
  const side = viewOutline(views2.side, false, settings.curveSteps);
  const top = viewOutline(views2.top, settings.symmetric, settings.curveSteps);
  const front = viewOutline(views2.front, settings.symmetric, settings.curveSteps);
  return { side, top, front };
}
var cache = /* @__PURE__ */ new WeakMap();
function generateBody(views2, settings) {
  const key = `${settings.stations}|${settings.sectionPoints}|${settings.roundness}|${settings.symmetric}|${settings.curveSteps}`;
  let byKey = cache.get(views2);
  if (!byKey) {
    byKey = /* @__PURE__ */ new Map();
    cache.set(views2, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  const result2 = buildBody(views2, settings);
  byKey.set(key, result2);
  return result2;
}
function buildBody(views2, settings) {
  const { side, top, front } = outlines(views2, settings);
  const closed = { side: !!side, top: !!top, front: !!front };
  const empty = (message) => ({ graph: new GraphBuilder().build(), stations: 0, closed, message });
  if (!side) return empty("Draw the side view as a closed outline (Side tab).");
  if (!top) {
    return empty(
      settings.symmetric ? "Draw the top view (Top tab): the right half of the outline, from the centre line round to the centre line." : "Draw the top view as a closed outline (Top tab)."
    );
  }
  const [sx0, sx1] = extent(side, 0);
  const [ty0, ty1] = extent(top, 1);
  const z0 = Math.max(-sx1, -ty1);
  const z1 = Math.min(-sx0, -ty0);
  if (!(z1 - z0 > 1e-6)) return empty("The side and top views do not overlap along the length. Line them up front to back.");
  const section = sectionShape(front, settings);
  const builder = new GraphBuilder();
  const rings = [];
  const n = settings.stations;
  for (let i = 0; i < n; i++) {
    const t = (1 - Math.cos(Math.PI * (i + 0.5) / n)) / 2;
    const z = z1 - t * (z1 - z0);
    const ys = crossings(side, 0, -z);
    const xs = crossings(top, 1, -z);
    if (ys.length < 2 || xs.length < 2) continue;
    const yLow = ys[0];
    const yHigh = ys[ys.length - 1];
    const xLow = xs[0];
    const xHigh = xs[xs.length - 1];
    if (yHigh - yLow < 1e-5 || xHigh - xLow < 1e-5) continue;
    const cx = (xLow + xHigh) / 2;
    const hw = (xHigh - xLow) / 2;
    rings.push(section.map(([u, v]) => builder.vertex([cx + u * hw, yLow + v * (yHigh - yLow), z])));
  }
  if (rings.length < 2) return empty("The outlines are too thin to build a body. Make the side and top views taller and wider.");
  const m = section.length;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      builder.face([rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]);
    }
  }
  builder.face(rings[0]);
  builder.face([...rings[rings.length - 1]].reverse());
  const graph = orientFaces(builder.build()).graph;
  return { graph, stations: rings.length, closed, message: null };
}

// src/core/scene/parts.ts
var PARTS = [
  {
    id: "cube",
    name: "Cube",
    category: "Point-built",
    description: "8 connected points and 6 faces. Press Tab to edit its vertices.",
    restingHeight: 0.5
  },
  {
    id: "plane",
    name: "Plane",
    category: "Point-built",
    description: "4 connected points and one face, lying on the ground.",
    restingHeight: 0
  },
  {
    id: "sphere",
    name: "Sphere",
    category: "Parametric",
    description: "Smooth sphere, 1 m across.",
    restingHeight: 0.5
  },
  {
    id: "cylinder",
    name: "Cylinder",
    category: "Parametric",
    description: "Smooth cylinder, 1 m tall and 1 m across.",
    restingHeight: 0.5
  },
  {
    id: "group",
    name: "Group",
    category: "Structure",
    description: "An empty parent for organising objects in the hierarchy.",
    restingHeight: 0
  }
];
var PART_COLORS = {
  cube: "#3d9fe8",
  plane: "#7d93ab",
  sphere: "#e4a23c",
  cylinder: "#55b888"
};
function getPart(id) {
  const part = PARTS.find((p) => p.id === id);
  if (!part) throw new Error(`Unknown part ${id}`);
  return part;
}
var BLUEPRINT_COLORS = ["#3d9fe8", "#e4a23c", "#55b888", "#e0565b", "#a77be0", "#62cbff"];
function generatedBase(options) {
  return {
    id: options.id ?? createObjectId(),
    name: options.name,
    kind: "mesh",
    parentId: null,
    childIds: [],
    visible: true,
    transform: { ...identityTransform(), ...options.transform },
    material: options.smooth === false ? { color: options.color ?? BLUEPRINT_COLORS[0] } : { color: options.color ?? BLUEPRINT_COLORS[0], smooth: true },
    ...options.modifiers ? { modifiers: options.modifiers } : {}
  };
}
function createBlueprintObject(options) {
  return {
    ...generatedBase(options),
    source: {
      type: "sketch",
      sketch: options.sketch ?? createSketch(options.plane ?? "front"),
      shape: clampShape({ ...DEFAULT_SHAPE, ...options.shape })
    }
  };
}
function createBodyObject(options) {
  return {
    ...generatedBase(options),
    source: { type: "body", views: options.views ?? createBodyViews(), body: clampBody({ ...DEFAULT_BODY, ...options.body }) }
  };
}
function createPartObject(partId, options = {}) {
  const part = getPart(partId);
  const [x, z] = options.groundPosition ?? [0, 0];
  const position = [x, part.restingHeight, z];
  const base = {
    id: options.id ?? createObjectId(),
    name: options.name ?? part.name,
    parentId: null,
    childIds: [],
    transform: { ...identityTransform(), position },
    visible: true
  };
  switch (partId) {
    case "group":
      return { ...base, kind: "group" };
    case "cube":
      return { ...base, kind: "mesh", source: { type: "construction", graph: buildCubeGraph(1) }, material: { color: PART_COLORS.cube } };
    case "plane":
      return { ...base, kind: "mesh", source: { type: "construction", graph: buildPlaneGraph(1) }, material: { color: PART_COLORS.plane } };
    case "sphere":
    case "cylinder":
      return { ...base, kind: "mesh", source: { type: "primitive", primitive: partId }, material: { color: PART_COLORS[partId] } };
  }
}

// src/core/scene/templates.ts
var TEMPLATES = [
  { id: "supercar", name: "Supercar", description: "Low mid-engine sports car: lofted body and cabin, arches, four detailed wheels." },
  { id: "saloon", name: "Luxury saloon", description: "Long, tall limousine: upright grille, long bonnet, big wheels, lights." }
];
function drawing(plane, dots, closed) {
  return addPolyline(createSketch(plane), dots.map(([x, y]) => [x, y]), closed, (i) => dots[i][2] === true).sketch;
}
function views(side, top, front) {
  const empty = createBodyViews();
  return {
    side: side.length ? drawing("side", side, true) : empty.side,
    top: top.length ? drawing("top", top, false) : empty.top,
    front: front.length ? drawing("front", front, false) : empty.front
  };
}
function group(name, transform, children) {
  const object = {
    id: createObjectId(),
    name,
    kind: "group",
    parentId: null,
    childIds: [],
    visible: true,
    transform: { ...identityTransform(), ...transform }
  };
  return { object, children };
}
function leaf(object) {
  return { object, children: [] };
}
function flatten(root) {
  const out = [];
  const visit = (node, parentId) => {
    out.push({ ...node.object, parentId, childIds: node.children.map((child) => child.object.id) });
    node.children.forEach((child) => visit(child, node.object.id));
  };
  visit(root, null);
  return out;
}
function blueprint(name, color2, plane, dots, closed, shape, transform = {}) {
  return leaf(createBlueprintObject({ name, color: color2, sketch: drawing(plane, dots, closed), shape, transform }));
}
function body(name, color2, v, settings) {
  return leaf(createBodyObject({ name, color: color2, views: v, body: settings }));
}
function wheel(name, position, outward, radius, width, spokes, rimColor) {
  const half = width / 2;
  const bead = radius * 0.66;
  const tyre = [
    [-half + 0.01, bead],
    [-half, bead + 0.035, true],
    [-half, radius - 0.03, true],
    [-half + 0.025, radius, true],
    [half - 0.025, radius, true],
    [half, radius - 0.03, true],
    [half, bead + 0.035, true],
    [half - 0.01, bead]
  ];
  const barrel = [
    [-half + 5e-3, 0],
    [-half + 5e-3, bead - 5e-3],
    [half - 0.03, bead - 5e-3],
    [half - 0.03, 0]
  ];
  const star = [];
  const outer = bead - 0.02;
  const inner = outer * 0.32;
  for (let i = 0; i < spokes * 2; i++) {
    const angle = Math.PI / 2 + i * Math.PI / spokes;
    const r = i % 2 === 0 ? outer : inner;
    star.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  const hub = polygonPoints(0, 0, inner * 0.6, 16).map(([x, y]) => [x, y]);
  return group(name, { position, rotation: [0, outward === 1 ? 180 : 0, 0] }, [
    blueprint("Tyre", "#1b1e22", "front", tyre, true, { mode: "revolve", axis: "horizontal", segments: 48 }),
    blueprint("Rim", "#5d646d", "front", barrel, false, { mode: "revolve", axis: "horizontal", segments: 48 }),
    blueprint("Spokes", rimColor, "side", star, true, { mode: "extrude", depth: 0.03 }, { position: [-half - 5e-3, 0, 0] }),
    blueprint("Hub", "#9aa1a9", "side", hub, true, { mode: "extrude", depth: 0.05 }, { position: [-half - 0.01, 0, 0] })
  ]);
}
function wheels(frontZ, rearZ, track, radius, width, spokes, rimColor) {
  return group("Wheels", {}, [
    wheel("Wheel front left", [-track, radius, frontZ], -1, radius, width, spokes, rimColor),
    wheel("Wheel front right", [track, radius, frontZ], 1, radius, width, spokes, rimColor),
    wheel("Wheel rear left", [-track, radius, rearZ], -1, radius, width, spokes, rimColor),
    wheel("Wheel rear right", [track, radius, rearZ], 1, radius, width, spokes, rimColor)
  ]);
}
function arch(centreX, centreY, r, sill) {
  return [
    [centreX + r + 0.03, sill],
    [centreX + r, centreY, true],
    [centreX + r * 0.71, centreY + r * 0.71, true],
    [centreX, centreY + r, true],
    [centreX - r * 0.71, centreY + r * 0.71, true],
    [centreX - r, centreY, true],
    [centreX - r - 0.03, sill]
  ];
}
function supercar() {
  const paint = "#f2a51a";
  const glass = "#16212d";
  const bodySide = [
    [-2.32, 0.34],
    [-2.28, 0.47, true],
    [-1.95, 0.6, true],
    [-1.25, 0.73, true],
    [-0.85, 0.79],
    [0.1, 0.85, true],
    [0.95, 0.91, true],
    [1.9, 0.96, true],
    [2.26, 0.98],
    [2.33, 0.86, true],
    [2.3, 0.42, true],
    [2.15, 0.21],
    ...arch(1.35, 0.36, 0.41, 0.2),
    ...arch(-1.45, 0.36, 0.4, 0.19),
    [-2.15, 0.2]
  ];
  const bodyTop = [
    [0, -2.34, true],
    [0.55, -2.3, true],
    [0.86, -2.1, true],
    [0.98, -1.7, true],
    [0.97, -1.15, true],
    [0.93, -0.4, true],
    [0.97, 0.4, true],
    [1.02, 1.1, true],
    [1.01, 1.75, true],
    [0.92, 2.2, true],
    [0.55, 2.33, true],
    [0, 2.34, true]
  ];
  const bodyFront = [[0, 0], [0.9, 0], [1, 0.1, true], [1, 0.55, true], [0.9, 0.85, true], [0.55, 0.98, true], [0, 1, true]];
  const cabinSide = [[-0.95, 0.74], [-0.3, 1.1, true], [0.3, 1.14, true], [0.95, 1.02, true], [1.45, 0.88], [1.45, 0.74]];
  const cabinTop = [[0, -0.98, true], [0.5, -0.92, true], [0.7, -0.45, true], [0.74, 0.4, true], [0.7, 1.1, true], [0.45, 1.46, true], [0, 1.48, true]];
  const cabinFront = [[0, 0], [0.8, 0], [0.72, 0.4, true], [0.52, 0.92, true], [0, 1, true]];
  const taillight = [[-0.85, 0.62], [0.85, 0.62], [0.85, 0.7], [-0.85, 0.7]];
  const intake = [[-0.75, 0.24], [0.75, 0.24], [0.68, 0.36], [-0.68, 0.36]];
  return group("Supercar", {}, [
    body("Body", paint, views(bodySide, bodyTop, bodyFront), { stations: 72, sectionPoints: 48 }),
    body("Cabin", glass, views(cabinSide, cabinTop, cabinFront), { stations: 40, sectionPoints: 36 }),
    blueprint("Taillight", "#d62f2f", "front", taillight, true, { mode: "extrude", depth: 0.02 }, { position: [0, 0, -2.335] }),
    blueprint("Front intake", "#111417", "front", intake, true, { mode: "extrude", depth: 0.02 }, { position: [0, 0, 2.29] }),
    wheels(1.45, -1.35, 0.86, 0.36, 0.26, 5, "#d4d8dd")
  ]);
}
function saloon() {
  const paint = "#1f2d4a";
  const glass = "#121a24";
  const bodySide = [
    [-2.86, 0.32],
    [-2.88, 0.95, true],
    [-2.78, 1.06],
    [-1.1, 1.08],
    [0.2, 1.02, true],
    [1.9, 1, true],
    [2.7, 0.98],
    [2.86, 0.86, true],
    [2.84, 0.4, true],
    [2.7, 0.26],
    ...arch(1.65, 0.42, 0.47, 0.24),
    ...arch(-1.8, 0.42, 0.47, 0.23),
    [-2.75, 0.28]
  ];
  const bodyTop = [[0, -2.88, true], [0.7, -2.86, true], [0.95, -2.7, true], [1, -2.2, true], [1, 2.3, true], [0.96, 2.75, true], [0.7, 2.86, true], [0, 2.87, true]];
  const bodyFront = [[0, 0], [0.95, 0], [1, 0.12, true], [1, 0.8, true], [0.94, 0.97, true], [0.6, 1, true], [0, 1, true]];
  const cabinSide = [[-1.25, 1.02], [-0.55, 1.5, true], [0.3, 1.56, true], [1.25, 1.48, true], [1.85, 1.1, true], [1.98, 0.98], [-1.25, 0.98]];
  const cabinTop = [[0, -1.3, true], [0.7, -1.24, true], [0.86, -0.7, true], [0.88, 0.6, true], [0.84, 1.6, true], [0.55, 2, true], [0, 2.02, true]];
  const cabinFront = [[0, 0], [0.88, 0], [0.8, 0.5, true], [0.62, 0.95, true], [0, 1, true]];
  const grille = [[-0.36, 0.48], [0.36, 0.48], [0.36, 0.95], [0.3, 1, true], [-0.3, 1, true], [-0.36, 0.95]];
  const lamp = [[0.55, 0.78], [0.9, 0.78], [0.9, 0.92, true], [0.55, 0.92, true]];
  const tail = [[0.68, 0.6], [0.95, 0.6], [0.95, 0.86, true], [0.68, 0.86, true]];
  return group("Luxury saloon", {}, [
    body("Body", paint, views(bodySide, bodyTop, bodyFront), { stations: 80, sectionPoints: 48, roundness: 6 }),
    body("Cabin", glass, views(cabinSide, cabinTop, cabinFront), { stations: 44, sectionPoints: 36 }),
    blueprint("Grille", "#cfd3d8", "front", grille, true, { mode: "extrude", depth: 0.04 }, { position: [0, 0, 2.885] }),
    blueprint("Headlights", "#f4f1e6", "front", lamp, true, { mode: "extrude", depth: 0.02, mirror: true }, { position: [0, 0, 2.885] }),
    blueprint("Taillights", "#c42a2a", "front", tail, true, { mode: "extrude", depth: 0.02, mirror: true }, { position: [0, 0, -2.865] }),
    wheels(1.8, -1.65, 0.86, 0.42, 0.28, 6, "#e3e6ea")
  ]);
}
function createTemplate(id, options = {}) {
  const root = id === "supercar" ? supercar() : saloon();
  const [x, z] = options.groundPosition ?? [0, 0];
  root.object = { ...root.object, transform: { ...root.object.transform, position: [x, 0, z] } };
  return flatten(root);
}
function getTemplate(id) {
  const found = TEMPLATES.find((template) => template.id === id);
  if (!found) throw new Error(`Unknown template ${id}`);
  return found;
}

// src/core/geometry/analysis.ts
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
function analyzeGraph(graph) {
  const counts = graphCounts(graph);
  const topology = getTopology(graph);
  const issues = [];
  const loose = Object.keys(graph.vertices).filter((id) => !topology.edgesByVertex.has(id));
  if (loose.length) {
    issues.push({
      severity: "info",
      code: "loose-vertex",
      message: `${plural(loose.length, "vertex is", "vertices are")} not connected to any edge.`,
      elementIds: loose
    });
  }
  const wire = [];
  const boundary = [];
  const nonManifold = [];
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id)?.length ?? 0;
    if (users === 0) wire.push(edge.id);
    else if (users === 1) boundary.push(edge.id);
    else if (users > 2) nonManifold.push(edge.id);
  }
  if (wire.length && counts.faces > 0) {
    issues.push({
      severity: "info",
      code: "wire-edge",
      message: `${plural(wire.length, "edge borders", "edges border")} no face.`,
      elementIds: wire
    });
  }
  if (boundary.length) {
    issues.push({
      severity: "info",
      code: "open-boundary",
      message: `${plural(boundary.length, "edge is", "edges are")} an open boundary (one face).`,
      elementIds: boundary
    });
  }
  if (nonManifold.length) {
    issues.push({
      severity: "warning",
      code: "non-manifold-edge",
      message: `${plural(nonManifold.length, "edge borders", "edges border")} more than two faces.`,
      elementIds: nonManifold
    });
  }
  const nonPlanar = [];
  const degenerate = [];
  for (const face of Object.values(graph.faces)) {
    const analysis = analyzePolygon(face.vertexIds.map((id) => graph.vertices[id].position));
    if (analysis.degenerate) degenerate.push(face.id);
    else if (!analysis.planar) nonPlanar.push(face.id);
  }
  if (degenerate.length) {
    issues.push({
      severity: "warning",
      code: "degenerate-face",
      message: `${plural(degenerate.length, "face has", "faces have")} zero area.`,
      elementIds: degenerate
    });
  }
  if (nonPlanar.length) {
    issues.push({
      severity: "warning",
      code: "non-planar-face",
      message: `${plural(nonPlanar.length, "face is", "faces are")} no longer flat; shown as triangles.`,
      elementIds: nonPlanar
    });
  }
  const inconsistent = findInconsistentEdges(graph);
  if (inconsistent.length) {
    issues.push({
      severity: "warning",
      code: "inconsistent-normals",
      message: `${plural(inconsistent.length, "edge joins faces", "edges join faces")} facing opposite ways. Use Recalculate normals.`,
      elementIds: inconsistent
    });
  }
  const closed = counts.faces > 0 && counts.edges > 0 && wire.length === 0 && boundary.length === 0 && nonManifold.length === 0;
  return { ...counts, closed, issues };
}

// src/core/geometry/graphJson.ts
function graphToJson(graph) {
  return {
    vertices: Object.values(graph.vertices).map((v) => ({ id: v.id, position: [...v.position] })),
    edges: Object.values(graph.edges).map((e) => ({ id: e.id, a: e.a, b: e.b })),
    faces: Object.values(graph.faces).map((f) => ({ id: f.id, vertices: [...f.vertexIds] }))
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
function nextCounter(ids, prefix) {
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
function graphFromJson(raw, path, errors) {
  const startErrors = errors.length;
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object with vertices, edges and faces.`);
    return null;
  }
  const { vertices: rawVertices, edges: rawEdges, faces: rawFaces } = raw;
  if (!Array.isArray(rawVertices) || !Array.isArray(rawEdges) || !Array.isArray(rawFaces)) {
    errors.push(`${path} needs vertices, edges and faces arrays.`);
    return null;
  }
  const vertices = {};
  rawVertices.forEach((item, i) => {
    const at = `${path}.vertices[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (vertices[item.id]) return void errors.push(`${at}: vertex id ${item.id} is used twice.`);
    if (!isVec3(item.position)) return void errors.push(`${at}: position must be three finite numbers.`);
    vertices[item.id] = { id: item.id, position: [item.position[0], item.position[1], item.position[2]] };
  });
  const edges = {};
  const pairs = /* @__PURE__ */ new Set();
  rawEdges.forEach((item, i) => {
    const at = `${path}.edges[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (edges[item.id]) return void errors.push(`${at}: edge id ${item.id} is used twice.`);
    const { a, b } = item;
    if (!isId(a) || !isId(b) || !vertices[a] || !vertices[b]) {
      return void errors.push(`${at}: edge ${item.id} must connect two existing vertices.`);
    }
    if (a === b) return void errors.push(`${at}: edge ${item.id} connects vertex ${a} to itself.`);
    const key = pairKey(a, b);
    if (pairs.has(key)) return void errors.push(`${at}: vertices ${a} and ${b} are connected twice.`);
    pairs.add(key);
    edges[item.id] = { id: item.id, a, b };
  });
  const faces = {};
  rawFaces.forEach((item, i) => {
    const at = `${path}.faces[${i}]`;
    if (!isRecord(item) || !isId(item.id)) return void errors.push(`${at} needs a text id.`);
    if (faces[item.id]) return void errors.push(`${at}: face id ${item.id} is used twice.`);
    const loop = item.vertices;
    if (!Array.isArray(loop) || loop.length < 3 || !loop.every(isId)) {
      return void errors.push(`${at}: face ${item.id} needs a loop of at least 3 vertex ids.`);
    }
    if (new Set(loop).size !== loop.length) return void errors.push(`${at}: face ${item.id} repeats a vertex.`);
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k];
      const b = loop[(k + 1) % loop.length];
      if (!vertices[a]) return void errors.push(`${at}: face ${item.id} uses missing vertex ${a}.`);
      if (!pairs.has(pairKey(a, b))) {
        return void errors.push(`${at}: face ${item.id} has no edge between ${a} and ${b}.`);
      }
    }
    faces[item.id] = { id: item.id, vertexIds: [...loop] };
  });
  if (errors.length > startErrors) return null;
  return {
    vertices,
    edges,
    faces,
    counters: {
      vertex: nextCounter(Object.keys(vertices), "v"),
      edge: nextCounter(Object.keys(edges), "e"),
      face: nextCounter(Object.keys(faces), "f")
    }
  };
}

// src/core/geometry/modifiers.ts
var MIRROR_AXES = ["none", "x", "y", "z"];
var MAX_SUBDIVISION = 3;
var SUBDIVISION_FACE_BUDGET = 25e4;
var NO_MODIFIERS = { mirror: "none", subdivide: 0 };
function cleanModifiers(raw) {
  const mirror = MIRROR_AXES.includes(raw?.mirror) ? raw.mirror : "none";
  const levels = typeof raw?.subdivide === "number" && Number.isFinite(raw.subdivide) ? Math.round(raw.subdivide) : 0;
  return { mirror, subdivide: Math.min(MAX_SUBDIVISION, Math.max(0, levels)) };
}
function hasModifiers(modifiers) {
  return !!modifiers && (modifiers.mirror !== "none" || modifiers.subdivide > 0);
}
var AXIS_INDEX = { x: 0, y: 1, z: 2 };
var PLANE_EPSILON = 1e-6;
function mirrorGraph(graph, axis) {
  const index = AXIS_INDEX[axis];
  const builder = new GraphBuilder();
  const original = /* @__PURE__ */ new Map();
  const copy = /* @__PURE__ */ new Map();
  const onPlane = (id) => Math.abs(graph.vertices[id].position[index]) <= PLANE_EPSILON;
  for (const vertex of Object.values(graph.vertices)) {
    const position = [...vertex.position];
    if (onPlane(vertex.id)) position[index] = 0;
    const id = builder.vertex(position);
    original.set(vertex.id, id);
    if (onPlane(vertex.id)) {
      copy.set(vertex.id, id);
    } else {
      const flipped = [...position];
      flipped[index] = -flipped[index];
      copy.set(vertex.id, builder.vertex(flipped));
    }
  }
  const topology = getTopology(graph);
  for (const face of Object.values(graph.faces)) {
    if (face.vertexIds.every(onPlane)) continue;
    builder.face(face.vertexIds.map((id) => original.get(id)));
    builder.face([...face.vertexIds].reverse().map((id) => copy.get(id)));
  }
  for (const edge of Object.values(graph.edges)) {
    if (topology.facesByEdge.get(edge.id)?.length) continue;
    builder.edge(original.get(edge.a), original.get(edge.b));
    builder.edge(copy.get(edge.a), copy.get(edge.b));
  }
  return builder.build();
}
function average(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}
function subdivideOnce(graph) {
  const faces = Object.values(graph.faces);
  if (faces.length === 0) return graph;
  const topology = getTopology(graph);
  const pos = (id) => graph.vertices[id].position;
  const facePoint = /* @__PURE__ */ new Map();
  for (const face of faces) facePoint.set(face.id, average(face.vertexIds.map(pos)));
  const edgePoint = /* @__PURE__ */ new Map();
  const edgeIdOf = (a, b) => topology.edgeByPair.get(pairKey(a, b)) ?? null;
  for (const edge of Object.values(graph.edges)) {
    const users = topology.facesByEdge.get(edge.id) ?? [];
    if (users.length === 0) continue;
    const mid = average([pos(edge.a), pos(edge.b)]);
    edgePoint.set(edge.id, users.length === 2 ? average([pos(edge.a), pos(edge.b), facePoint.get(users[0]), facePoint.get(users[1])]) : mid);
  }
  const vertexPoint = /* @__PURE__ */ new Map();
  for (const vertex of Object.values(graph.vertices)) {
    const adjacentFaces = topology.facesByVertex.get(vertex.id) ?? [];
    if (adjacentFaces.length === 0) continue;
    const edges = (topology.edgesByVertex.get(vertex.id) ?? []).filter((id) => (topology.facesByEdge.get(id)?.length ?? 0) > 0);
    const boundary = edges.filter((id) => topology.facesByEdge.get(id).length === 1);
    const nonManifold = edges.some((id) => topology.facesByEdge.get(id).length > 2);
    const p = vertex.position;
    if (nonManifold) {
      vertexPoint.set(vertex.id, p);
    } else if (boundary.length > 0) {
      if (boundary.length !== 2 || adjacentFaces.length === 1) {
        vertexPoint.set(vertex.id, p);
        continue;
      }
      const [a, b] = boundary.map((id) => {
        const e = graph.edges[id];
        return pos(e.a === vertex.id ? e.b : e.a);
      });
      vertexPoint.set(vertex.id, [0.75 * p[0] + 0.125 * (a[0] + b[0]), 0.75 * p[1] + 0.125 * (a[1] + b[1]), 0.75 * p[2] + 0.125 * (a[2] + b[2])]);
    } else {
      const n = edges.length;
      const f = average(adjacentFaces.map((id) => facePoint.get(id)));
      const r = average(
        edges.map((id) => {
          const e = graph.edges[id];
          return average([pos(e.a), pos(e.b)]);
        })
      );
      vertexPoint.set(vertex.id, [(f[0] + 2 * r[0] + (n - 3) * p[0]) / n, (f[1] + 2 * r[1] + (n - 3) * p[1]) / n, (f[2] + 2 * r[2] + (n - 3) * p[2]) / n]);
    }
  }
  const builder = new GraphBuilder();
  const vertexIds = /* @__PURE__ */ new Map();
  const edgeIds = /* @__PURE__ */ new Map();
  const faceIds = /* @__PURE__ */ new Map();
  for (const [id, p] of vertexPoint) vertexIds.set(id, builder.vertex(p));
  for (const [id, p] of edgePoint) edgeIds.set(id, builder.vertex(p));
  for (const [id, p] of facePoint) faceIds.set(id, builder.vertex(p));
  for (const face of faces) {
    const loop = face.vertexIds;
    const k = loop.length;
    for (let i = 0; i < k; i++) {
      const previous = loop[(i - 1 + k) % k];
      const current = loop[i];
      const next = loop[(i + 1) % k];
      const eNext = edgeIdOf(current, next);
      const ePrevious = edgeIdOf(previous, current);
      if (!eNext || !ePrevious) continue;
      builder.face([vertexIds.get(current), edgeIds.get(eNext), faceIds.get(face.id), edgeIds.get(ePrevious)]);
    }
  }
  return builder.build();
}
function subdivide(graph, levels) {
  let current = graph;
  for (let level = 0; level < levels; level++) {
    const faceCount = Object.values(current.faces).reduce((sum, face) => sum + face.vertexIds.length, 0);
    if (faceCount > SUBDIVISION_FACE_BUDGET) break;
    current = subdivideOnce(current);
  }
  return current;
}
var cache2 = /* @__PURE__ */ new WeakMap();
function applyModifiers(graph, modifiers) {
  if (!modifiers || !hasModifiers(modifiers)) return graph;
  const key = `${modifiers.mirror}|${modifiers.subdivide}`;
  let byKey = cache2.get(graph);
  if (!byKey) {
    byKey = /* @__PURE__ */ new Map();
    cache2.set(graph, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  let result2 = graph;
  if (modifiers.mirror !== "none") result2 = mirrorGraph(result2, modifiers.mirror);
  if (modifiers.subdivide > 0) result2 = subdivide(result2, modifiers.subdivide);
  byKey.set(key, result2);
  return result2;
}

// src/core/sketch/generate.ts
var PLANE_AXES = {
  front: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  side: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  top: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] }
};
function planeTo3d(plane, x, y, offset = 0) {
  const { u, v, n } = PLANE_AXES[plane];
  return add(add(scale(u, x), scale(v, y)), scale(n, offset));
}
var cache3 = /* @__PURE__ */ new WeakMap();
function generateShape(sketch, shape) {
  const key = `${shape.mode}|${shape.depth}|${shape.segments}|${shape.mirror}|${shape.axis}|${shape.curveSteps}`;
  let byShape = cache3.get(sketch);
  if (!byShape) {
    byShape = /* @__PURE__ */ new Map();
    cache3.set(sketch, byShape);
  }
  const cached = byShape.get(key);
  if (cached) return cached;
  const result2 = shape.mode === "revolve" ? revolve(sketch, shape.segments, shape.axis, shape.curveSteps) : shape.mode === "extrude" && shape.depth > 1e-4 ? extrude(sketch, shape.depth, shape.mirror, shape.curveSteps) : flat(sketch, shape.mirror, shape.curveSteps);
  byShape.set(key, result2);
  return result2;
}
function capFaces(builder, region, ids, points, reverse) {
  const loops = region.holes.length === 0 ? [region.outer] : triangulateRegion(region, points).map((tri) => [...tri]);
  for (const loop of loops) {
    const mapped = loop.map((id) => ids.get(id));
    builder.face(reverse ? [mapped[0], ...mapped.slice(1).reverse()] : mapped);
  }
}
function flat(sketch, mirror, curveSteps) {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const builder = new GraphBuilder();
  const ids = /* @__PURE__ */ new Map();
  for (const [id, [x, y]] of resolved.points) ids.set(id, builder.vertex(planeTo3d(sketch.plane, x, y)));
  for (const [a, b] of resolved.segments) builder.edge(ids.get(a), ids.get(b));
  const regions = findRegions(resolved);
  for (const region of regions) capFaces(builder, region, ids, resolved.points, false);
  return { graph: builder.build(), regions: regions.length, skippedFaces: builder.skippedFaces };
}
function extrude(sketch, depth, mirror, curveSteps) {
  const resolved = resolveSketch(sketch, mirror, curveSteps);
  const builder = new GraphBuilder();
  const used = new Set(resolved.segments.flat());
  const front = /* @__PURE__ */ new Map();
  const back = /* @__PURE__ */ new Map();
  const [frontOffset, backOffset] = sketch.plane === "top" ? [depth, 0] : [depth / 2, -depth / 2];
  for (const [id, [x, y]] of resolved.points) {
    if (!used.has(id)) continue;
    front.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, frontOffset)));
    back.set(id, builder.vertex(planeTo3d(sketch.plane, x, y, backOffset)));
  }
  const regions = findRegions(resolved);
  const filledSides = /* @__PURE__ */ new Map();
  const key = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  for (const region of regions) {
    for (const loop of [region.outer, ...region.holes]) {
      loop.forEach((id, i) => {
        const k = key(id, loop[(i + 1) % loop.length]);
        filledSides.set(k, (filledSides.get(k) ?? 0) + 1);
      });
    }
  }
  for (const region of regions) {
    capFaces(builder, region, front, resolved.points, false);
    capFaces(builder, region, back, resolved.points, true);
  }
  for (const [a, b] of resolved.segments) {
    if ((filledSides.get(key(a, b)) ?? 0) >= 2) continue;
    builder.face([front.get(a), front.get(b), back.get(b), back.get(a)]);
  }
  const graph = orientFaces(builder.build()).graph;
  return { graph, regions: regions.length, skippedFaces: builder.skippedFaces };
}
function revolve(sketch, segments, axis, curveSteps) {
  const resolved = resolveSketch(sketch, false, curveSteps);
  const builder = new GraphBuilder();
  const { u, v, n } = PLANE_AXES[sketch.plane];
  const [along, across] = axis === "vertical" ? [v, u] : [u, v];
  const used = new Set(resolved.segments.flat());
  const rings = /* @__PURE__ */ new Map();
  for (const [id, [x, y]] of resolved.points) {
    if (!used.has(id)) continue;
    const [position, radius] = axis === "vertical" ? [y, Math.abs(x)] : [x, Math.abs(y)];
    if (radius <= AXIS_EPSILON) {
      const single = builder.vertex(scale(along, position));
      rings.set(id, Array.from({ length: segments }, () => single));
      continue;
    }
    const ring = [];
    for (let k = 0; k < segments; k++) {
      const angle = 2 * Math.PI * k / segments;
      ring.push(builder.vertex(add(scale(along, position), add(scale(across, radius * Math.cos(angle)), scale(n, radius * Math.sin(angle))))));
    }
    rings.set(id, ring);
  }
  for (const [a, b] of resolved.segments) {
    const ra = rings.get(a);
    const rb = rings.get(b);
    if (ra[0] === ra[1] && rb[0] === rb[1]) continue;
    for (let k = 0; k < segments; k++) {
      const k1 = (k + 1) % segments;
      builder.face([ra[k], rb[k], rb[k1], ra[k1]]);
    }
  }
  const graph = orientFaces(builder.build()).graph;
  return { graph, regions: 0, skippedFaces: builder.skippedFaces };
}

// src/core/scene/types.ts
var PRIMITIVE_KINDS = ["sphere", "cylinder"];
function isConstructionMesh(object) {
  return !!object && object.kind === "mesh" && object.source.type === "construction";
}
function isSketchMesh(object) {
  return !!object && object.kind === "mesh" && object.source.type === "sketch";
}
function isBodyMesh(object) {
  return !!object && object.kind === "mesh" && object.source.type === "body";
}
function sourceGraphOf(object) {
  if (!object || object.kind !== "mesh") return null;
  switch (object.source.type) {
    case "construction":
      return object.source.graph;
    case "sketch":
      return generateShape(object.source.sketch, object.source.shape).graph;
    case "body":
      return generateBody(object.source.views, object.source.body).graph;
    default:
      return null;
  }
}
function meshGraphOf(object) {
  const graph = sourceGraphOf(object);
  if (!graph || !object || object.kind !== "mesh") return graph;
  return applyModifiers(graph, object.modifiers);
}
var HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// src/core/sketch/sketchJson.ts
function viewToJson(sketch) {
  return {
    points: Object.values(sketch.points).map((p) => p.smooth ? { id: p.id, x: p.x, y: p.y, smooth: true } : { id: p.id, x: p.x, y: p.y }),
    lines: Object.values(sketch.lines).map((l) => ({ id: l.id, a: l.a, b: l.b }))
  };
}
function sketchToJson(sketch, shape) {
  return {
    plane: sketch.plane,
    ...viewToJson(sketch),
    shape: { ...shape }
  };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId2(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
function nextCounter2(ids, prefix) {
  let max = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
function viewFromJson(raw, plane, path, errors) {
  const start = errors.length;
  if (!isRecord2(raw) || !Array.isArray(raw.points) || !Array.isArray(raw.lines)) {
    errors.push(`${path} needs points and lines lists.`);
    return null;
  }
  const points = {};
  raw.points.forEach((item, i) => {
    const at = `${path}.points[${i}]`;
    if (!isRecord2(item) || !isId2(item.id)) return void errors.push(`${at} needs a text id.`);
    if (points[item.id]) return void errors.push(`${at}: dot id ${item.id} is used twice.`);
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return void errors.push(`${at}: x and y must be finite numbers.`);
    if (item.smooth !== void 0 && typeof item.smooth !== "boolean") return void errors.push(`${at}: smooth must be true or false.`);
    points[item.id] = item.smooth ? { id: item.id, x: item.x, y: item.y, smooth: true } : { id: item.id, x: item.x, y: item.y };
  });
  const lines = {};
  const pairs = /* @__PURE__ */ new Set();
  raw.lines.forEach((item, i) => {
    const at = `${path}.lines[${i}]`;
    if (!isRecord2(item) || !isId2(item.id)) return void errors.push(`${at} needs a text id.`);
    if (lines[item.id]) return void errors.push(`${at}: line id ${item.id} is used twice.`);
    const { a, b } = item;
    if (!isId2(a) || !isId2(b) || !points[a] || !points[b]) return void errors.push(`${at}: line ${item.id} must join two existing dots.`);
    if (a === b) return void errors.push(`${at}: line ${item.id} joins dot ${a} to itself.`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairs.has(key)) return void errors.push(`${at}: dots ${a} and ${b} are joined twice.`);
    pairs.add(key);
    lines[item.id] = { id: item.id, a, b };
  });
  if (errors.length > start) return null;
  return { plane, points, lines, counters: { point: nextCounter2(Object.keys(points), "p"), line: nextCounter2(Object.keys(lines), "l") } };
}
function sketchFromJson(raw, path, errors) {
  const start = errors.length;
  if (!isRecord2(raw)) {
    errors.push(`${path} must describe a blueprint.`);
    return null;
  }
  if (!SKETCH_PLANES.includes(raw.plane)) errors.push(`${path}.plane must be one of: ${SKETCH_PLANES.join(", ")}.`);
  const sketch = viewFromJson(raw, raw.plane ?? "front", path, errors);
  const shapeRaw = isRecord2(raw.shape) ? raw.shape : {};
  if (!SHAPE_MODES.includes(shapeRaw.mode)) errors.push(`${path}.shape.mode must be one of: ${SHAPE_MODES.join(", ")}.`);
  if (errors.length > start || !sketch) return null;
  return { sketch, shape: clampShape(shapeRaw) };
}

// src/core/project/references.ts
var MAX_REFERENCE_CHARS = 24 * 1024 * 1024;
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readReferences(raw, warnings) {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) {
    warnings.push("The reference pictures list was invalid and was skipped.");
    return [];
  }
  const out = [];
  const ids = /* @__PURE__ */ new Set();
  raw.forEach((item, i) => {
    const ok2 = isRecord3(item) && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 64 && !ids.has(item.id) && SKETCH_PLANES.includes(item.plane) && typeof item.src === "string" && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(item.src) && item.src.length <= MAX_REFERENCE_CHARS && [item.aspect, item.x, item.y, item.width, item.opacity].every(isFiniteNumber) && item.aspect > 0 && item.width > 0;
    if (!ok2) {
      warnings.push(`Reference picture ${i + 1} was invalid and was skipped.`);
      return;
    }
    const record = item;
    ids.add(record.id);
    out.push({
      id: record.id,
      plane: record.plane,
      name: typeof record.name === "string" ? record.name.slice(0, 200) : "Reference",
      src: record.src,
      aspect: record.aspect,
      x: record.x,
      y: record.y,
      width: record.width,
      opacity: Math.min(1, Math.max(0, record.opacity)),
      flip: record.flip === true,
      visible: record.visible !== false
    });
  });
  return out;
}

// src/core/project/snapshots.ts
var MAX_SNAPSHOTS = 40;
function createSnapshot(scene, name, id, now = /* @__PURE__ */ new Date()) {
  const trimmed = name.trim().slice(0, 120);
  return { id, name: trimmed || `Snapshot ${now.toLocaleString()}`, createdAt: now.toISOString(), scene };
}
function addSnapshot(list, snapshot) {
  return [...list, snapshot].slice(-MAX_SNAPSHOTS);
}
function nextSnapshotName(list) {
  const used = new Set(list.map((snapshot) => snapshot.name));
  for (let n = list.length + 1; ; n++) {
    const name = `Version ${n}`;
    if (!used.has(name)) return name;
  }
}

// src/core/units.ts
var WORLD_CONVENTIONS = {
  lengthUnit: "meters",
  upAxis: "+Y",
  forwardAxis: "+Z",
  handedness: "right",
  rotation: "degrees-xyz"
};
var METERS_PER_ROBLOX_STUD = 0.28;

// src/core/project/projectFile.ts
var PROJECT_FORMAT = "forgex-project";
var PROJECT_FORMAT_VERSION = 4;
var PROJECT_EXTENSION = "forgex";
var DEFAULT_SETTINGS = { gridSize: 0.25, snapEnabled: true, rotationSnapDegrees: 15 };
function serializeSource(source) {
  switch (source.type) {
    case "primitive":
      return { type: "primitive", primitive: source.primitive };
    case "construction":
      return { type: "construction", ...graphToJson(source.graph) };
    case "sketch":
      return { type: "sketch", ...sketchToJson(source.sketch, source.shape) };
    case "body":
      return {
        type: "body",
        views: { side: viewToJson(source.views.side), top: viewToJson(source.views.top), front: viewToJson(source.views.front) },
        body: { ...source.body }
      };
  }
}
function serializeObject(object) {
  const base = {
    id: object.id,
    name: object.name,
    kind: object.kind,
    parentId: object.parentId,
    childIds: [...object.childIds],
    visible: object.visible,
    ...object.locked ? { locked: true } : {},
    transform: {
      position: [...object.transform.position],
      rotation: [...object.transform.rotation],
      scale: [...object.transform.scale]
    }
  };
  if (object.kind === "mesh") {
    base.material = object.material.smooth ? { color: object.material.color, smooth: true } : { color: object.material.color };
    if (hasModifiers(object.modifiers)) base.modifiers = { ...object.modifiers };
    base.source = serializeSource(object.source);
  }
  return base;
}
function orderedObjects(scene) {
  const out = [];
  const visit = (id) => {
    const object = scene.objects[id];
    if (!object) return;
    out.push(object);
    object.childIds.forEach(visit);
  };
  scene.rootIds.forEach(visit);
  return out;
}
function serializeScene(scene) {
  return { rootIds: [...scene.rootIds], objects: orderedObjects(scene).map(serializeObject) };
}
function serializeProject(document, now = /* @__PURE__ */ new Date()) {
  const file = {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    savedAt: now.toISOString(),
    units: { ...WORLD_CONVENTIONS },
    settings: { ...document.settings },
    scene: serializeScene(document.scene)
  };
  if (document.camera) file.camera = { position: [...document.camera.position], target: [...document.camera.target] };
  if (document.references?.length) file.references = document.references.map((reference) => ({ ...reference }));
  if (document.snapshots?.length) {
    file.snapshots = document.snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, scene: serializeScene(snapshot.scene) }));
  }
  return `${JSON.stringify(file, null, 2)}
`;
}
var PROJECT_MIGRATIONS = {
  // Version 2 added blueprint objects ("sketch" sources). Version 1 files need no changes.
  1: (data) => data,
  // Version 3 added optional fields only (smooth dots, bodies, modifiers, shading, references).
  2: (data) => data,
  // Version 4 added optional fields only (locked objects, snapshots).
  3: (data) => data
};
function migrateProjectData(data, targetVersion = PROJECT_FORMAT_VERSION, migrations = PROJECT_MIGRATIONS) {
  const fromVersion = data.version;
  let current = data;
  for (let version = fromVersion; version < targetVersion; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`No upgrade path from format version ${version} to ${version + 1}.`);
    current = { ...step(current), version: version + 1 };
  }
  return { data: current, fromVersion };
}
var MAX_REPORTED_ERRORS = 25;
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readTransform(raw, at, errors) {
  if (!isRecord4(raw)) {
    errors.push(`${at} must be an object with position, rotation and scale.`);
    return null;
  }
  const out = {};
  for (const key of ["position", "rotation", "scale"]) {
    const value = raw[key];
    if (!isVec3(value)) errors.push(`${at}.${key} must be three finite numbers.`);
    else out[key] = [value[0], value[1], value[2]];
  }
  return out.position && out.rotation && out.scale ? out : null;
}
function readSettings(raw, warnings) {
  if (!isRecord4(raw)) {
    warnings.push("The file has no settings; defaults were used.");
    return { ...DEFAULT_SETTINGS };
  }
  const settings = { ...DEFAULT_SETTINGS };
  if (isFiniteNumber(raw.gridSize) && raw.gridSize > 0) settings.gridSize = raw.gridSize;
  else warnings.push("Grid size was missing or invalid; the default was used.");
  if (typeof raw.snapEnabled === "boolean") settings.snapEnabled = raw.snapEnabled;
  if (isFiniteNumber(raw.rotationSnapDegrees) && raw.rotationSnapDegrees > 0) {
    settings.rotationSnapDegrees = raw.rotationSnapDegrees;
  }
  return settings;
}
function readSource(raw, at, errors) {
  if (!isRecord4(raw)) {
    errors.push(`${at} must describe the mesh source.`);
    return null;
  }
  if (raw.type === "primitive") {
    if (!PRIMITIVE_KINDS.includes(raw.primitive)) {
      errors.push(`${at}.primitive must be one of: ${PRIMITIVE_KINDS.join(", ")}.`);
      return null;
    }
    return { type: "primitive", primitive: raw.primitive };
  }
  if (raw.type === "construction") {
    const graph = graphFromJson(raw, at, errors);
    return graph ? { type: "construction", graph } : null;
  }
  if (raw.type === "sketch") {
    const blueprint2 = sketchFromJson(raw, at, errors);
    return blueprint2 ? { type: "sketch", ...blueprint2 } : null;
  }
  if (raw.type === "body") {
    if (!isRecord4(raw.views)) {
      errors.push(`${at}.views must hold the side, top and front drawings.`);
      return null;
    }
    const start = errors.length;
    const views2 = {};
    for (const view of BODY_VIEWS) views2[view] = viewFromJson(raw.views[view], view, `${at}.views.${view}`, errors);
    if (errors.length > start || !views2.side || !views2.top || !views2.front) return null;
    return { type: "body", views: views2, body: clampBody(isRecord4(raw.body) ? raw.body : {}) };
  }
  errors.push(`${at}.type must be "primitive", "construction", "sketch" or "body".`);
  return null;
}
function readObject(raw, at, errors) {
  if (!isRecord4(raw)) {
    errors.push(`${at} must be an object.`);
    return null;
  }
  const start = errors.length;
  const { id, name, kind, parentId, childIds, visible, locked } = raw;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) errors.push(`${at}.id must be text of 1\u201364 characters.`);
  if (typeof name !== "string" || name.length > 200) errors.push(`${at}.name must be text of at most 200 characters.`);
  if (kind !== "mesh" && kind !== "group") errors.push(`${at}.kind must be "mesh" or "group".`);
  if (parentId !== null && typeof parentId !== "string") errors.push(`${at}.parentId must be an object id or null.`);
  if (!Array.isArray(childIds) || !childIds.every((c) => typeof c === "string")) {
    errors.push(`${at}.childIds must be a list of object ids.`);
  }
  if (typeof visible !== "boolean") errors.push(`${at}.visible must be true or false.`);
  if (locked !== void 0 && typeof locked !== "boolean") errors.push(`${at}.locked must be true or false.`);
  const transform = readTransform(raw.transform, `${at}.transform`, errors);
  let mesh = null;
  if (kind === "mesh") {
    const material = raw.material;
    if (!isRecord4(material) || typeof material.color !== "string" || !HEX_COLOR.test(material.color)) {
      errors.push(`${at}.material.color must be a colour like #3d9fe8.`);
    }
    let modifiers;
    if (raw.modifiers !== void 0) {
      const m = raw.modifiers;
      if (!isRecord4(m) || m.mirror !== void 0 && !MIRROR_AXES.includes(m.mirror) || m.subdivide !== void 0 && !isFiniteNumber(m.subdivide)) {
        errors.push(`${at}.modifiers must have mirror (none, x, y or z) and subdivide (0 to 3).`);
      } else {
        const cleaned = cleanModifiers(m);
        if (hasModifiers(cleaned)) modifiers = cleaned;
      }
    }
    const source = readSource(raw.source, `${at}.source`, errors);
    if (source && isRecord4(material) && typeof material.color === "string") {
      const color2 = material.color.toLowerCase();
      mesh = { source, material: material.smooth === true ? { color: color2, smooth: true } : { color: color2 }, ...modifiers ? { modifiers } : {} };
    }
  }
  if (errors.length > start || !transform) return null;
  const base = {
    id,
    name,
    parentId,
    childIds: [...childIds],
    visible,
    ...locked === true ? { locked: true } : {},
    transform
  };
  return kind === "group" ? { ...base, kind: "group" } : { ...base, kind: "mesh", ...mesh };
}
function checkHierarchy(objects, rootIds, errors) {
  const seen = /* @__PURE__ */ new Set();
  const visit = (id, expectedParent, trail) => {
    const object = objects[id];
    if (!object) return void errors.push(`The hierarchy refers to missing object ${id}.`);
    if (trail.has(id)) return void errors.push(`Object ${id} is inside itself.`);
    if (seen.has(id)) return void errors.push(`Object ${id} appears in the hierarchy twice.`);
    if (object.parentId !== expectedParent) {
      errors.push(`Object ${id} says its parent is ${object.parentId ?? "the root"}, but it is listed under ${expectedParent ?? "the root"}.`);
    }
    seen.add(id);
    trail.add(id);
    object.childIds.forEach((child) => visit(child, id, trail));
    trail.delete(id);
  };
  rootIds.forEach((id) => visit(id, null, /* @__PURE__ */ new Set()));
  for (const id of Object.keys(objects)) {
    if (!seen.has(id)) errors.push(`Object ${id} is not reachable from the scene roots.`);
  }
}
function readObjects(raw, at, errors) {
  const objects = {};
  raw.forEach((item, i) => {
    const object = readObject(item, `${at}[${i}]`, errors);
    if (!object) return;
    if (objects[object.id]) errors.push(`Object id ${object.id} is used twice.`);
    else objects[object.id] = object;
  });
  return objects;
}
function readScene(raw, at, errors) {
  if (!isRecord4(raw) || !Array.isArray(raw.objects) || !Array.isArray(raw.rootIds)) {
    errors.push(`${at} needs rootIds and objects lists.`);
    return null;
  }
  const start = errors.length;
  const objects = readObjects(raw.objects, `${at}.objects`, errors);
  const rootIds = raw.rootIds.filter((id) => typeof id === "string");
  if (rootIds.length !== raw.rootIds.length) errors.push(`${at}.rootIds must contain only object ids.`);
  if (errors.length === start) checkHierarchy(objects, rootIds, errors);
  return errors.length === start ? { objects, rootIds } : null;
}
function readSnapshots(raw, warnings) {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) {
    warnings.push("The saved snapshots were not a list and were skipped.");
    return [];
  }
  const out = [];
  raw.slice(-MAX_SNAPSHOTS).forEach((item, i) => {
    if (!isRecord4(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.createdAt !== "string") {
      warnings.push(`Snapshot ${i + 1} is missing its id, name or date and was skipped.`);
      return;
    }
    const problems = [];
    const scene = readScene(item.scene, `snapshots[${i}].scene`, problems);
    if (!scene) {
      warnings.push(`Snapshot \u201C${item.name.slice(0, 80)}\u201D could not be read and was skipped: ${problems[0] ?? "invalid scene"}`);
      return;
    }
    out.push({ id: item.id.slice(0, 64), name: item.name.slice(0, 120), createdAt: item.createdAt.slice(0, 40), scene });
  });
  return out;
}
function parseProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${error.message}`] };
  }
  if (!isRecord4(raw) || raw.format !== PROJECT_FORMAT) {
    return { ok: false, errors: ["This is not a FORGEX 3D project file."] };
  }
  const version = raw.version;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ["The project format version is missing or invalid."] };
  }
  if (version > PROJECT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This project uses format version ${version}, made by a newer FORGEX 3D. This build reads up to version ${PROJECT_FORMAT_VERSION}.`
      ]
    };
  }
  let data;
  let migratedFrom = null;
  try {
    const migrated = migrateProjectData(raw);
    data = migrated.data;
    if (migrated.fromVersion !== PROJECT_FORMAT_VERSION) migratedFrom = migrated.fromVersion;
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const errors = [];
  const warnings = [];
  if (isRecord4(data.units)) {
    if (data.units.lengthUnit !== WORLD_CONVENTIONS.lengthUnit || data.units.upAxis !== WORLD_CONVENTIONS.upAxis) {
      errors.push(
        `The project uses ${String(data.units.lengthUnit)} with ${String(data.units.upAxis)} up; FORGEX 3D expects metres with +Y up.`
      );
    }
  } else {
    warnings.push("The file does not state its units; metres with +Y up were assumed.");
  }
  const settings = readSettings(data.settings, warnings);
  const sceneRaw = data.scene;
  if (!isRecord4(sceneRaw) || !Array.isArray(sceneRaw.objects) || !Array.isArray(sceneRaw.rootIds)) {
    return { ok: false, errors: [...errors, "The file has no valid scene (it needs rootIds and objects lists)."] };
  }
  const objects = readObjects(sceneRaw.objects, "scene.objects", errors);
  const rootIds = sceneRaw.rootIds.filter((id) => typeof id === "string");
  if (rootIds.length !== sceneRaw.rootIds.length) errors.push("scene.rootIds must contain only object ids.");
  if (errors.length === 0) checkHierarchy(objects, rootIds, errors);
  let camera = null;
  if (data.camera !== void 0) {
    if (isRecord4(data.camera) && isVec3(data.camera.position) && isVec3(data.camera.target)) {
      camera = { position: [...data.camera.position], target: [...data.camera.target] };
    } else {
      warnings.push("The saved camera view was invalid and was skipped.");
    }
  }
  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS);
    if (errors.length > shown.length) shown.push(`\u2026and ${errors.length - shown.length} more problems.`);
    return { ok: false, errors: shown };
  }
  for (const object of Object.values(objects)) {
    if (object.kind !== "mesh" || object.source.type !== "construction") continue;
    for (const issue of analyzeGraph(object.source.graph).issues) {
      if (issue.severity !== "info") warnings.push(`${object.name}: ${issue.message}`);
    }
  }
  const references = readReferences(data.references, warnings);
  const snapshots = readSnapshots(data.snapshots, warnings);
  const document = { scene: { objects, rootIds }, settings, camera };
  if (references.length) document.references = references;
  if (snapshots.length) document.snapshots = snapshots;
  return { ok: true, document, warnings, migratedFrom };
}

// src/core/project/defaultDocument.ts
function documentWith(objects) {
  const scene = {
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    rootIds: objects.filter((object) => object.parentId === null).map((object) => object.id)
  };
  return { scene, settings: { ...DEFAULT_SETTINGS }, camera: null };
}
function createEmptyDocument() {
  return documentWith([]);
}
function createDefaultDocument() {
  return documentWith([createPartObject("cube")]);
}

// src/core/scene/scene.ts
var SceneError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SceneError";
  }
};
function requireObject(scene, id) {
  const object = scene.objects[id];
  if (!object) throw new SceneError(`Object ${id} is not in the scene.`);
  return object;
}
function siblingIds(scene, parentId) {
  return parentId === null ? scene.rootIds : requireObject(scene, parentId).childIds;
}
function indexInParent(scene, id) {
  return siblingIds(scene, requireObject(scene, id).parentId).indexOf(id);
}
function isSelfOrAncestor(scene, ancestorId, id) {
  let current = id;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = scene.objects[current]?.parentId ?? null;
  }
  return false;
}
function isLocked(scene, id) {
  let current = id;
  while (current !== null) {
    const object = scene.objects[current];
    if (!object) return false;
    if (object.locked) return true;
    current = object.parentId;
  }
  return false;
}
function collectSubtree(scene, id) {
  const out = [];
  const visit = (objectId) => {
    const object = requireObject(scene, objectId);
    out.push(object);
    object.childIds.forEach(visit);
  };
  visit(id);
  return out;
}
function withSiblings(scene, parentId, ids) {
  if (parentId === null) return { ...scene, rootIds: ids };
  const parent = requireObject(scene, parentId);
  return { ...scene, objects: { ...scene.objects, [parentId]: { ...parent, childIds: ids } } };
}
function insertAt(list, id, index) {
  const next = [...list];
  const at = index === void 0 ? next.length : Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, id);
  return next;
}
function insertSubtree(scene, subtree, parentId, index) {
  if (subtree.length === 0) throw new SceneError("Nothing to insert.");
  if (parentId !== null) requireObject(scene, parentId);
  const objects = { ...scene.objects };
  subtree.forEach((object, i) => {
    if (objects[object.id]) throw new SceneError(`Object id ${object.id} is already in use.`);
    objects[object.id] = i === 0 ? { ...object, parentId } : object;
  });
  const next = { ...scene, objects };
  return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), subtree[0].id, index));
}
function removeSubtree(scene, id) {
  const root = requireObject(scene, id);
  const removed = collectSubtree(scene, id);
  const objects = { ...scene.objects };
  for (const object of removed) delete objects[object.id];
  const siblings = siblingIds(scene, root.parentId);
  const index = siblings.indexOf(id);
  const next = withSiblings({ ...scene, objects }, root.parentId, siblings.filter((s) => s !== id));
  return { scene: next, removed, parentId: root.parentId, index };
}
function updateObject(scene, id, update) {
  const object = requireObject(scene, id);
  const next = update(object);
  if (next === object) return scene;
  return { ...scene, objects: { ...scene.objects, [id]: next } };
}
function setObjectTransform(scene, id, transform) {
  return updateObject(scene, id, (object) => ({ ...object, transform }));
}
function localMatrix(object) {
  return composeMatrix(object.transform);
}
function worldMatrix(scene, id) {
  let matrix = identityMatrix();
  let current = id;
  while (current !== null) {
    const object = requireObject(scene, current);
    matrix = multiplyMatrices(localMatrix(object), matrix);
    current = object.parentId;
  }
  return matrix;
}
function moveObject(scene, id, parentId, index, preserveWorld = true) {
  const object = requireObject(scene, id);
  if (parentId !== null && isSelfOrAncestor(scene, id, parentId)) {
    throw new SceneError("An object cannot be placed inside itself or one of its children.");
  }
  let transform = object.transform;
  if (preserveWorld && parentId !== object.parentId) {
    const world = worldMatrix(scene, id);
    const parentInverse = invertAffine(worldMatrix(scene, parentId));
    if (parentInverse) transform = cleanTransform(decomposeMatrix(multiplyMatrices(parentInverse, world)));
  }
  const oldSiblings = siblingIds(scene, object.parentId).filter((s) => s !== id);
  let next = withSiblings(scene, object.parentId, oldSiblings);
  next = { ...next, objects: { ...next.objects, [id]: { ...requireObject(next, id), parentId, transform } } };
  return withSiblings(next, parentId, insertAt(siblingIds(next, parentId), id, index));
}
function uniqueName(scene, base) {
  const taken = new Set(Object.values(scene.objects).map((o) => o.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
function cloneSubtree(scene, id, createId) {
  const source = collectSubtree(scene, id);
  const idMap = new Map(source.map((o) => [o.id, createId()]));
  return source.map((object) => ({
    ...object,
    id: idMap.get(object.id),
    parentId: object.parentId !== null && idMap.has(object.parentId) ? idMap.get(object.parentId) : object.parentId,
    childIds: object.childIds.map((child) => idMap.get(child))
  }));
}
function sceneBounds(scene) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const add2 = (matrix, p) => {
    const w = transformPoint(matrix, p);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], w[i]);
      max[i] = Math.max(max[i], w[i]);
    }
  };
  const visit = (id, parent) => {
    const object = scene.objects[id];
    if (!object || !object.visible) return;
    const matrix = multiplyMatrices(parent, localMatrix(object));
    if (object.kind === "mesh") {
      if (object.source.type === "primitive") {
        for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) add2(matrix, [x, y, z]);
      } else {
        const graph = meshGraphOf(object);
        if (graph) for (const vertex of Object.values(graph.vertices)) add2(matrix, [vertex.position[0], vertex.position[1], vertex.position[2]]);
      }
    }
    object.childIds.forEach((child) => visit(child, matrix));
  };
  scene.rootIds.forEach((id) => visit(id, identityMatrix()));
  return min[0] <= max[0] ? [min, max] : null;
}
function clearSpotX(scene, objects) {
  const bounds = sceneBounds(scene);
  if (!bounds || objects.length === 0) return 0;
  const root = objects[0];
  const probe = sceneBounds({ objects: Object.fromEntries(objects.map((o) => [o.id, o])), rootIds: [root.id] });
  const reachLeft = probe ? root.transform.position[0] - probe[0][0] : 0.5;
  return Math.ceil(bounds[1][0] + 1 + reachLeft);
}

// src/core/editor/editorStore.ts
var MAX_MESSAGES = 200;
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
var EditorStore = class {
  history = new CommandHistory(500);
  listeners = /* @__PURE__ */ new Set();
  messageSeq = 0;
  state;
  constructor(document = createDefaultDocument(), name = "Untitled", path = null) {
    this.state = this.freshState(document, name, path, [], 0);
  }
  // -- Subscription ---------------------------------------------------------
  getState = () => this.state;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  commit(patch) {
    const next = { ...this.state, ...patch };
    next.dirty = this.history.revision !== next.project.savedRevision || next.project.settingsDirty;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  summarizeHistory() {
    const toItem = (entry) => ({ seq: entry.seq, label: entry.command.label });
    const past = this.history.undoEntries.map(toItem);
    const future = this.history.redoEntries.map(toItem);
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past.length ? past[past.length - 1].label : null,
      redoLabel: future.length ? future[0].label : null,
      past,
      future,
      revision: this.history.revision
    };
  }
  freshState(document, name, path, messages, cameraRevision) {
    return {
      scene: document.scene,
      selectedId: null,
      editMode: "object",
      selectedVertexId: null,
      tool: this.state?.tool ?? "select",
      settings: { ...document.settings },
      references: document.references ?? [],
      snapshots: document.snapshots ?? [],
      project: { name, path, savedRevision: this.history.revision, settingsDirty: false },
      history: this.summarizeHistory(),
      camera: { view: document.camera, revision: cameraRevision + 1 },
      messages,
      dirty: false
    };
  }
  /** Keeps selection, edit mode and vertex selection valid for a scene. */
  selectionFor(scene, selectedId) {
    const object = selectedId ? scene.objects[selectedId] : void 0;
    if (!object) return { selectedId: null, editMode: "object", selectedVertexId: null };
    const sameObject = selectedId === this.state.selectedId;
    const keepPoints = sameObject && this.state.editMode === "points" && isConstructionMesh(object);
    const vertex = this.state.selectedVertexId;
    const keepVertex = keepPoints && vertex !== null && isConstructionMesh(object) && !!object.source.graph.vertices[vertex];
    return {
      selectedId,
      editMode: keepPoints ? "points" : "object",
      selectedVertexId: keepVertex ? vertex : null
    };
  }
  // -- Commands, undo and redo -----------------------------------------------
  /** Applies a command and records it for undo. Returns false (and logs why) if it failed. */
  execute(command) {
    let scene;
    try {
      scene = command.apply(this.state.scene);
    } catch (error) {
      this.log("error", `${command.label} failed.`, describeError(error));
      return false;
    }
    const wanted = command.selectAfterApply !== void 0 ? command.selectAfterApply : this.state.selectedId;
    const selection = this.selectionFor(scene, wanted);
    this.history.record(command, this.state.selectedId, selection.selectedId);
    this.commit({ scene, ...selection, history: this.summarizeHistory() });
    return true;
  }
  undo() {
    const entry = this.history.undo();
    if (!entry) return false;
    try {
      const scene = entry.command.revert(this.state.scene);
      this.commit({ scene, ...this.selectionFor(scene, entry.selectionBefore), history: this.summarizeHistory() });
      return true;
    } catch (error) {
      this.history.redo();
      this.log("error", `Undo \u201C${entry.command.label}\u201D failed.`, describeError(error));
      return false;
    }
  }
  redo() {
    const entry = this.history.redo();
    if (!entry) return false;
    try {
      const scene = entry.command.apply(this.state.scene);
      this.commit({ scene, ...this.selectionFor(scene, entry.selectionAfter), history: this.summarizeHistory() });
      return true;
    } catch (error) {
      this.history.undo();
      this.log("error", `Redo \u201C${entry.command.label}\u201D failed.`, describeError(error));
      return false;
    }
  }
  get revision() {
    return this.history.revision;
  }
  // -- Live previews (not recorded; a command commits the final value) --------
  previewTransform(id, transform) {
    if (!this.state.scene.objects[id]) return;
    this.commit({ scene: setObjectTransform(this.state.scene, id, transform) });
  }
  /** Live preview of a mesh source (e.g. dragging a dot on the board); a command commits the final value. */
  previewSource(id, source) {
    const object = this.state.scene.objects[id];
    if (object?.kind !== "mesh") return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, source })) });
  }
  previewColor(id, color2) {
    const object = this.state.scene.objects[id];
    if (object?.kind !== "mesh") return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, material: { ...object.material, color: color2 } })) });
  }
  previewGraph(id, graph) {
    const object = this.state.scene.objects[id];
    if (!isConstructionMesh(object)) return;
    this.commit({ scene: updateObject(this.state.scene, id, () => ({ ...object, source: { type: "construction", graph } })) });
  }
  // -- Selection and modes ----------------------------------------------------
  select(id) {
    if (id === this.state.selectedId) return;
    const object = id ? this.state.scene.objects[id] : void 0;
    this.commit({ selectedId: object ? id : null, editMode: "object", selectedVertexId: null });
  }
  selectVertex(vertexId) {
    if (this.state.editMode !== "points") return;
    this.commit({ selectedVertexId: vertexId });
  }
  /** Switches between object mode and points mode. Points mode needs a point-built object. */
  setEditMode(mode) {
    if (mode === this.state.editMode) return true;
    if (mode === "points") {
      const object = this.state.selectedId ? this.state.scene.objects[this.state.selectedId] : void 0;
      if (!isConstructionMesh(object)) {
        this.log("warning", "Select a point-built object (a Cube or Plane) to edit its vertices. Blueprints are edited on the board, or use Convert to points.");
        return false;
      }
    }
    this.commit({ editMode: mode, selectedVertexId: null });
    return true;
  }
  setTool(tool) {
    if (tool !== this.state.tool) this.commit({ tool });
  }
  updateSettings(patch) {
    const settings = { ...this.state.settings, ...patch };
    if (!(settings.gridSize > 0) || !(settings.rotationSnapDegrees > 0)) return;
    this.commit({ settings, project: { ...this.state.project, settingsDirty: true } });
  }
  /** Replaces the reference pictures. They are saved with the project but are not part of undo. */
  setReferences(references) {
    if (references === this.state.references) return;
    this.commit({ references, project: { ...this.state.project, settingsDirty: true } });
  }
  /** Replaces the snapshots. They are saved with the project but are not part of undo. */
  setSnapshots(snapshots) {
    if (snapshots === this.state.snapshots) return;
    this.commit({ snapshots, project: { ...this.state.project, settingsDirty: true } });
  }
  setCameraView(view) {
    this.state = { ...this.state, camera: { ...this.state.camera, view } };
  }
  // -- Projects -------------------------------------------------------------
  /** Replaces the whole project (new or opened). Clears undo history. */
  loadDocument(document, name, path) {
    this.history.clear();
    this.state = this.freshState(document, name, path, this.state.messages, this.state.camera.revision);
    this.listeners.forEach((listener) => listener());
  }
  /** Records a successful save. Edits made while the save was running stay unsaved. */
  markSaved(name, path, savedRevision, savedSettings, savedReferences = this.state.references, savedSnapshots = this.state.snapshots) {
    const settingsDirty = this.state.settings !== savedSettings || this.state.references !== savedReferences || this.state.snapshots !== savedSnapshots;
    this.commit({ project: { name, path, savedRevision, settingsDirty } });
  }
  toDocument() {
    const document = { scene: this.state.scene, settings: this.state.settings, camera: this.state.camera.view };
    if (this.state.references.length) document.references = this.state.references;
    if (this.state.snapshots.length) document.snapshots = this.state.snapshots;
    return document;
  }
  // -- Diagnostics ------------------------------------------------------------
  log(level, text, detail, options = {}) {
    const message = { id: ++this.messageSeq, level, text, detail, time: Date.now(), ...options.quiet ? { quiet: true } : {} };
    this.commit({ messages: [...this.state.messages, message].slice(-MAX_MESSAGES) });
  }
  clearMessages() {
    this.commit({ messages: [] });
  }
};

// src/core/project/paths.ts
function fileNameFromPath(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
function projectNameFromPath(path) {
  const name = fileNameFromPath(path);
  const suffix = `.${PROJECT_EXTENSION}`;
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
function ensureProjectExtension(path) {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : `${path}.${PROJECT_EXTENSION}`;
}

// mcp/atomic.ts
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
async function writeFileAtomically(target, contents) {
  const temp = (0, import_node_path.join)((0, import_node_path.dirname)(target), `.${(0, import_node_path.basename)(target)}.saving`);
  try {
    await (0, import_promises.writeFile)(temp, contents, "utf8");
    await (0, import_promises.rename)(temp, target);
  } catch (error) {
    await (0, import_promises.unlink)(temp).catch(() => void 0);
    throw error;
  }
}

// mcp/library.ts
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");

// src/core/library/libraryPart.ts
var LIBRARY_PART_FORMAT = "forgex-part";
var LIBRARY_PART_VERSION = 1;
var LIBRARY_EXTENSION = "forgexpart";
var LIBRARY_FOLDER_NAME = "Library";
var MAX_THUMBNAIL_CHARS = 6e5;
var MAX_LIBRARY_PART_BYTES = 64 * 1024 * 1024;
var LibraryError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LibraryError";
  }
};
function libraryPartFromScene(scene, id, options = {}) {
  const subtree = collectSubtree(scene, id);
  const root = subtree[0];
  const objects = {};
  for (const object of subtree) objects[object.id] = object;
  const [, y] = root.transform.position;
  const { locked: _locked, ...unlocked2 } = root;
  void _locked;
  objects[root.id] = { ...unlocked2, parentId: null, transform: { ...root.transform, position: [0, y, 0] } };
  const name = (options.name ?? root.name).trim().slice(0, 120) || root.name;
  const thumbnail = options.thumbnail && options.thumbnail.startsWith("data:image/") && options.thumbnail.length <= MAX_THUMBNAIL_CHARS ? options.thumbnail : void 0;
  return {
    name,
    description: (options.description ?? "").trim().slice(0, 500),
    createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
    scene: { objects, rootIds: [root.id] },
    ...thumbnail ? { thumbnail } : {}
  };
}
function serializeLibraryPart(part) {
  const file = {
    format: LIBRARY_PART_FORMAT,
    version: LIBRARY_PART_VERSION,
    generator: `${APP_NAME} ${APP_VERSION}`,
    name: part.name,
    description: part.description,
    createdAt: part.createdAt,
    scene: serializeScene(part.scene),
    ...part.thumbnail ? { thumbnail: part.thumbnail } : {}
  };
  return `${JSON.stringify(file, null, 1)}
`;
}
function parseLibraryPart(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${error.message}`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["This is not a FORGEX part file."] };
  const data = raw;
  if (data.format !== LIBRARY_PART_FORMAT) return { ok: false, errors: ["This is not a FORGEX part file."] };
  if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, errors: ["The part format version is missing or invalid."] };
  if (data.version > LIBRARY_PART_VERSION) {
    return { ok: false, errors: [`This part was saved by a newer FORGEX 3D (format version ${data.version}).`] };
  }
  const errors = [];
  if (typeof data.name !== "string" || !data.name.trim()) errors.push("The part needs a name.");
  const scene = readScene(data.scene, "scene", errors);
  if (scene && scene.rootIds.length !== 1) errors.push("A part holds exactly one root object.");
  if (errors.length || !scene) return { ok: false, errors };
  const thumbnail = typeof data.thumbnail === "string" && data.thumbnail.startsWith("data:image/") && data.thumbnail.length <= MAX_THUMBNAIL_CHARS ? data.thumbnail : void 0;
  return {
    ok: true,
    part: {
      name: data.name.trim().slice(0, 120),
      description: typeof data.description === "string" ? data.description.slice(0, 500) : "",
      createdAt: typeof data.createdAt === "string" ? data.createdAt.slice(0, 40) : "",
      scene,
      ...thumbnail ? { thumbnail } : {}
    }
  };
}
function libraryEntry(file, part) {
  return {
    file,
    name: part.name,
    description: part.description,
    createdAt: part.createdAt,
    objectCount: Object.keys(part.scene.objects).length,
    ...part.thumbnail ? { thumbnail: part.thumbnail } : {}
  };
}
function instantiateLibraryPart(part, createId) {
  return cloneSubtree(part.scene, part.scene.rootIds[0], createId);
}
function libraryFileName(name) {
  const base = name.normalize("NFKD").replace(/[^\w\s.-]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 60);
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base);
  return `${base && !reserved ? base : "Part"}.${LIBRARY_EXTENSION}`;
}
function isLibraryFileName(file) {
  return /^[\w\s.-]{1,80}$/.test(file) && file.toLowerCase().endsWith(`.${LIBRARY_EXTENSION}`) && !file.startsWith(".");
}
function findLibraryEntry(entries, ref) {
  const key = ref.trim().toLowerCase();
  return entries.find((entry) => entry.file.toLowerCase() === key) ?? entries.find((entry) => entry.name.toLowerCase() === key) ?? entries.find((entry) => entry.file.toLowerCase() === `${key}.${LIBRARY_EXTENSION}`);
}

// mcp/library.ts
var FolderLibrary = class {
  folder;
  constructor(projectsFolder) {
    this.folder = (0, import_node_path2.join)(projectsFolder, LIBRARY_FOLDER_NAME);
  }
  location() {
    return this.folder;
  }
  path(file) {
    if (!isLibraryFileName(file)) throw new LibraryError(`${file} is not a part file name.`);
    return (0, import_node_path2.join)(this.folder, file);
  }
  async list() {
    let files;
    try {
      files = await (0, import_promises2.readdir)(this.folder);
    } catch {
      return [];
    }
    const out = [];
    for (const file of files.filter(isLibraryFileName)) {
      try {
        const info = await (0, import_promises2.stat)((0, import_node_path2.join)(this.folder, file));
        if (info.size > MAX_LIBRARY_PART_BYTES) continue;
        const parsed = parseLibraryPart(await (0, import_promises2.readFile)((0, import_node_path2.join)(this.folder, file), "utf8"));
        if (parsed.ok) out.push(libraryEntry(file, parsed.part));
      } catch {
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async read(file) {
    let text;
    try {
      text = await (0, import_promises2.readFile)(this.path(file), "utf8");
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(`There is no part called ${file} in My Parts.`);
    }
    const parsed = parseLibraryPart(text);
    if (!parsed.ok) throw new LibraryError(`${file} could not be read: ${parsed.errors.join(" ")}`);
    return parsed.part;
  }
  async write(part, overwrite) {
    const file = libraryFileName(part.name);
    const target = this.path(file);
    await (0, import_promises2.mkdir)(this.folder, { recursive: true });
    if (!overwrite) {
      const taken = await (0, import_promises2.stat)(target).then(
        () => true,
        () => false
      );
      if (taken) throw new LibraryError(`My Parts already has ${file}. Choose another name, or pass overwrite true to replace it.`);
    }
    await writeFileAtomically(target, serializeLibraryPart(part));
    return file;
  }
  async remove(file) {
    await (0, import_promises2.unlink)(this.path(file));
  }
};

// mcp/paths.ts
var import_node_os = require("node:os");
var import_node_path3 = require("node:path");
function defaultProjectsFolder() {
  const configured = process.env.FORGEX_PROJECTS_DIR?.trim();
  return configured ? (0, import_node_path3.resolve)(configured) : (0, import_node_path3.resolve)((0, import_node_os.homedir)(), "Documents", "FORGEX 3D");
}
function resolveProjectPath(input, folder) {
  const trimmed = input.trim();
  return ensureProjectExtension((0, import_node_path3.isAbsolute)(trimmed) ? (0, import_node_path3.resolve)(trimmed) : (0, import_node_path3.resolve)(folder, trimmed));
}

// mcp/fileHost.ts
var MAX_PROJECT_BYTES = 512 * 1024 * 1024;
async function exists(path) {
  try {
    await (0, import_promises3.stat)(path);
    return true;
  } catch {
    return false;
  }
}
var FileHost = class {
  constructor(projectsFolder, appNote) {
    this.projectsFolder = projectsFolder;
    this.appNote = appNote;
    this.library = new FolderLibrary(projectsFolder);
  }
  store = new EditorStore(createEmptyDocument(), "Untitled", null);
  library;
  status() {
    return {
      mode: "file",
      detail: `Working directly on .forgex files (${this.appNote()}).`,
      projectsFolder: this.projectsFolder
    };
  }
  resolve(path) {
    return resolveProjectPath(path, this.projectsFolder);
  }
  async newProject({ path, empty }) {
    const target = path ? this.resolve(path) : null;
    if (target && await exists(target)) {
      throw new ToolError(`${target} already exists. Use open_project to edit it, or choose another name.`);
    }
    const document = empty ? createEmptyDocument() : createDefaultDocument();
    this.store.loadDocument(document, target ? projectNameFromPath(target) : "Untitled", target);
    if (!target) return "Started an untitled project. Call save_project with a name to write it to disk.";
    await this.write(target);
    return `Started ${projectNameFromPath(target)} at ${target}. Changes are saved there automatically.`;
  }
  async openProject(path) {
    const target = this.resolve(path);
    let info;
    try {
      info = await (0, import_promises3.stat)(target);
    } catch {
      throw new ToolError(`${target} does not exist.`);
    }
    if (info.size > MAX_PROJECT_BYTES) throw new ToolError(`${target} is larger than the 512 MB limit.`);
    const parsed = parseProject(await (0, import_promises3.readFile)(target, "utf8"));
    if (!parsed.ok) throw new ToolError(`${target} could not be opened:
${parsed.errors.join("\n")}`);
    this.store.loadDocument(parsed.document, projectNameFromPath(target), target);
    const count = Object.keys(parsed.document.scene.objects).length;
    const warnings = parsed.warnings.length ? `
Warnings:
${parsed.warnings.join("\n")}` : "";
    return `Opened ${target} with ${count} object${count === 1 ? "" : "s"}. Changes are saved there automatically.${warnings}`;
  }
  async saveProject(path) {
    const target = path ? this.resolve(path) : this.store.getState().project.path;
    if (!target) {
      throw new ToolError(`This project has no file yet. Pass a path, for example "kart" (saved in ${this.projectsFolder}).`);
    }
    await this.write(target);
    return `Saved ${target}.`;
  }
  /** Saves after a change when the project already has a file. Returns a note for the AI. */
  async afterChange() {
    const { project, dirty } = this.store.getState();
    if (!dirty) return "";
    if (!project.path) return "Not saved to disk yet: call save_project with a name to keep this work.";
    await this.write(project.path);
    return `Saved to ${project.path}.`;
  }
  async write(target) {
    const revision = this.store.revision;
    const { settings, references, snapshots } = this.store.getState();
    const text = serializeProject(this.store.toDocument());
    const check = parseProject(text);
    if (!check.ok) throw new ToolError(`The project failed validation, so nothing was written:
${check.errors.join("\n")}`);
    await (0, import_promises3.mkdir)((0, import_node_path4.dirname)(target), { recursive: true });
    await writeFileAtomically(target, text);
    this.store.markSaved(projectNameFromPath(target), target, revision, settings, references, snapshots);
  }
};

// mcp/server.ts
var import_promises4 = require("node:fs/promises");
var import_node_path5 = require("node:path");
var import_node_readline = require("node:readline");

// src/core/automation/instructions.ts
var SERVER_INSTRUCTIONS = [
  "FORGEX 3D is a 3D modelling studio for game assets (Roblox, Blender).",
  "Units are metres, +Y is up, the front of an asset faces +Z, and rotations are degrees applied in X, Y, Z order. For Roblox, 1 stud = 0.28 m.",
  "Call get_status first. When the FORGEX 3D app is open, every change appears live in its 3D view and undo history, and capture_viewport returns an image to check your work.",
  "Model the way the user does: create_blueprint draws dots joined by lines on a front, side or top plane and makes them flat, extruded or revolved; create_body lofts a smooth body (car, hull) from side, top and front outlines; create_point_mesh builds a mesh from vertices and edges, with faces from closed loops.",
  "add_template adds a ready-made supercar or saloon to start from; add_part adds primitives; group_objects and set_parent organise parts.",
  "Save a version with save_snapshot before a big change (restore_snapshot goes back). Respect locked objects: ask the user before unlocking them with set_lock.",
  "My Parts is a library shared by every project: save_to_library keeps a finished part, list_library and add_from_library reuse parts in later projects.",
  "Every change can be undone. When the app is closed, the Node server edits .forgex files directly: use save_project with a name (saved in the FORGEX projects folder) to keep work."
].join(" ");

// src/core/commands/command.ts
var CompositeCommand = class {
  constructor(label, commands, selectAfterApply) {
    this.label = label;
    this.commands = commands;
    this.selectAfterApply = selectAfterApply;
  }
  apply(scene) {
    return this.commands.reduce((current, command) => command.apply(current), scene);
  }
  revert(scene) {
    return [...this.commands].reverse().reduce((current, command) => command.revert(current), scene);
  }
};

// src/core/commands/sceneCommands.ts
var AddObjectsCommand = class {
  constructor(subtree, parentId = null, index, label) {
    this.subtree = subtree;
    this.parentId = parentId;
    this.index = index;
    if (subtree.length === 0) throw new SceneError("Nothing to add.");
    this.label = label ?? `Add ${subtree[0].name}`;
    this.selectAfterApply = subtree[0].id;
  }
  label;
  selectAfterApply;
  apply(scene) {
    return insertSubtree(scene, this.subtree, this.parentId, this.index);
  }
  revert(scene) {
    return removeSubtree(scene, this.subtree[0].id).scene;
  }
};
var DeleteObjectCommand = class {
  constructor(id, name) {
    this.id = id;
    this.label = `Delete ${name}`;
  }
  label;
  selectAfterApply = null;
  removed = null;
  parentId = null;
  index = 0;
  apply(scene) {
    const result2 = removeSubtree(scene, this.id);
    this.removed = result2.removed;
    this.parentId = result2.parentId;
    this.index = result2.index;
    return result2.scene;
  }
  revert(scene) {
    if (!this.removed) throw new SceneError("Delete was never applied.");
    return insertSubtree(scene, this.removed, this.parentId, this.index);
  }
};
var SetTransformCommand = class {
  constructor(id, before, after, label = "Edit transform") {
    this.id = id;
    this.label = label;
    this.before = cloneTransform(before);
    this.after = cloneTransform(after);
  }
  before;
  after;
  apply(scene) {
    return setObjectTransform(scene, this.id, cloneTransform(this.after));
  }
  revert(scene) {
    return setObjectTransform(scene, this.id, cloneTransform(this.before));
  }
};
var RenameObjectCommand = class {
  constructor(id, before, after) {
    this.id = id;
    this.before = before;
    this.after = after;
    this.label = `Rename to \u201C${after}\u201D`;
  }
  label;
  apply(scene) {
    return updateObject(scene, this.id, (o) => ({ ...o, name: this.after }));
  }
  revert(scene) {
    return updateObject(scene, this.id, (o) => ({ ...o, name: this.before }));
  }
};
var SetVisibilityCommand = class {
  constructor(id, visible, name) {
    this.id = id;
    this.visible = visible;
    this.label = `${visible ? "Show" : "Hide"} ${name}`;
  }
  label;
  before = true;
  apply(scene) {
    this.before = requireObject(scene, this.id).visible;
    return updateObject(scene, this.id, (o) => ({ ...o, visible: this.visible }));
  }
  revert(scene) {
    return updateObject(scene, this.id, (o) => ({ ...o, visible: this.before }));
  }
};
var SetLockCommand = class {
  constructor(id, locked, name) {
    this.id = id;
    this.locked = locked;
    this.label = `${locked ? "Lock" : "Unlock"} ${name}`;
  }
  label;
  before = false;
  write(scene, locked) {
    return updateObject(scene, this.id, (o) => {
      const { locked: _old, ...rest } = o;
      void _old;
      return locked ? { ...rest, locked: true } : rest;
    });
  }
  apply(scene) {
    this.before = !!requireObject(scene, this.id).locked;
    return this.write(scene, this.locked);
  }
  revert(scene) {
    return this.write(scene, this.before);
  }
};
var ReplaceSceneCommand = class {
  constructor(before, after, label) {
    this.before = before;
    this.after = after;
    this.label = label;
  }
  selectAfterApply = null;
  apply() {
    return this.after;
  }
  revert() {
    return this.before;
  }
};
function requireMesh(scene, id) {
  const object = requireObject(scene, id);
  if (object.kind !== "mesh") throw new SceneError(`${object.name} is not a mesh.`);
  return object;
}
var SetColorCommand = class {
  constructor(id, before, after) {
    this.id = id;
    this.before = before;
    this.after = after;
  }
  label = "Change colour";
  write(scene, color2) {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => ({ ...mesh, material: { ...mesh.material, color: color2 } }));
  }
  apply(scene) {
    return this.write(scene, this.after);
  }
  revert(scene) {
    return this.write(scene, this.before);
  }
};
var MoveObjectCommand = class {
  constructor(id, parentId, index, label = "Move in hierarchy") {
    this.id = id;
    this.parentId = parentId;
    this.index = index;
    this.label = label;
  }
  previous = null;
  apply(scene) {
    const object = requireObject(scene, this.id);
    this.previous = {
      parentId: object.parentId,
      index: indexInParent(scene, this.id),
      transform: cloneTransform(object.transform)
    };
    return moveObject(scene, this.id, this.parentId, this.index, true);
  }
  revert(scene) {
    if (!this.previous) throw new SceneError("Move was never applied.");
    const moved = moveObject(scene, this.id, this.previous.parentId, this.previous.index, false);
    return setObjectTransform(moved, this.id, cloneTransform(this.previous.transform));
  }
};
var SetSourceCommand = class {
  constructor(id, before, after, label) {
    this.id = id;
    this.before = before;
    this.after = after;
    this.label = label;
  }
  write(scene, source) {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => ({ ...mesh, source }));
  }
  apply(scene) {
    return this.write(scene, this.after);
  }
  revert(scene) {
    return this.write(scene, this.before);
  }
};
var SetMeshLookCommand = class {
  constructor(id, before, after, label) {
    this.id = id;
    this.before = before;
    this.after = after;
    this.label = label;
  }
  write(scene, look) {
    const mesh = requireMesh(scene, this.id);
    return updateObject(scene, this.id, () => {
      const { modifiers: _old, ...rest } = mesh;
      void _old;
      const material = look.smooth ? { ...mesh.material, smooth: true } : { color: mesh.material.color };
      return look.modifiers ? { ...rest, material, modifiers: look.modifiers } : { ...rest, material };
    });
  }
  apply(scene) {
    return this.write(scene, this.after);
  }
  revert(scene) {
    return this.write(scene, this.before);
  }
};
var SetGraphCommand = class {
  constructor(id, before, after, label) {
    this.id = id;
    this.before = before;
    this.after = after;
    this.label = label;
  }
  write(scene, graph) {
    const mesh = requireMesh(scene, this.id);
    if (mesh.source.type !== "construction") throw new SceneError(`${mesh.name} is not point-built.`);
    return updateObject(scene, this.id, () => ({ ...mesh, source: { type: "construction", graph } }));
  }
  apply(scene) {
    return this.write(scene, this.after);
  }
  revert(scene) {
    return this.write(scene, this.before);
  }
};

// src/core/automation/args.ts
function asArgs(raw) {
  if (raw === void 0 || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ToolError("Tool arguments must be a JSON object.");
  return raw;
}
function optString(args, key, maxLength = 200) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string") throw new ToolError(`${key} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) throw new ToolError(`${key} must not be empty.`);
  if (trimmed.length > maxLength) throw new ToolError(`${key} must be at most ${maxLength} characters.`);
  return trimmed;
}
function reqString(args, key, maxLength = 200) {
  const value = optString(args, key, maxLength);
  if (value === void 0) throw new ToolError(`${key} is required.`);
  return value;
}
function optBool(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "boolean") throw new ToolError(`${key} must be true or false.`);
  return value;
}
function optInt(args, key, min, max) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}
function toVec3(value, label) {
  if (!isVec3(value)) throw new ToolError(`${label} must be [x, y, z] with three finite numbers.`);
  return [value[0], value[1], value[2]];
}
function optVec3(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  return toVec3(value, key);
}
function optEnum(args, key, allowed) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ToolError(`${key} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}
function reqEnum(args, key, allowed) {
  const value = optEnum(args, key, allowed);
  if (value === void 0) throw new ToolError(`${key} is required (one of: ${allowed.join(", ")}).`);
  return value;
}
function optColor(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
    if (/^[0-9a-fA-F]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("").toLowerCase()}`;
  }
  throw new ToolError(`${key} must be a hex colour such as #3d9fe8.`);
}
function optArray(args, key, maxItems) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (!Array.isArray(value)) throw new ToolError(`${key} must be a list.`);
  if (value.length > maxItems) throw new ToolError(`${key} can hold at most ${maxItems} items per call.`);
  return value;
}
function toIndex(value, count, label) {
  if (!Number.isInteger(value) || value < 0 || value >= count) {
    throw new ToolError(`${label} must be a vertex index from 0 to ${count - 1}.`);
  }
  return value;
}
function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  const result2 = Math.round(value * factor) / factor;
  return Object.is(result2, -0) ? 0 : result2;
}
function roundVec(v, decimals = 4) {
  return v.map((n) => round(n, decimals));
}

// src/core/automation/tools.ts
var vec3 = (description) => ({ type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description });
var objectRef = (description = "Object id (such as obj_3f9a1c0b2d4e5f60) or exact name") => ({ type: "string", description });
var color = { type: "string", description: "Hex colour, for example #3d9fe8" };
var vertexRef = {
  anyOf: [
    { type: "string", description: "An existing vertex id, such as v3" },
    { type: "integer", minimum: 0, description: "Index into add_vertices from this same call" }
  ]
};
var transformProps = {
  position: vec3("Position in metres [x, y, z], +Y is up. Relative to the parent when one is given."),
  rotation: vec3("Rotation in degrees [x, y, z], applied in X, Y, Z order"),
  scale: vec3("Scale factors [x, y, z]")
};
var noArgs = { type: "object", properties: {}, additionalProperties: false };
var point2 = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
var shapeSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: [...SHAPE_MODES] },
    depth: { type: "number", minimum: 0, description: "Extrusion thickness in metres (default 0.2)" },
    segments: { type: "integer", minimum: 3, maximum: 256, description: "Steps around the axis when revolving (default 32)" },
    mirror: { type: "boolean", description: "Copy the drawing across x = 0" },
    axis: { type: "string", enum: [...REVOLVE_AXES], description: "Revolve around the vertical line x = 0 (default) or the horizontal line y = 0 (wheels)" },
    curve_steps: { type: "integer", minimum: MIN_CURVE_STEPS, maximum: MAX_CURVE_STEPS, description: "Straight pieces per curved line (default 10)" }
  },
  additionalProperties: false
};
var bodySchema = {
  type: "object",
  properties: {
    stations: { type: "integer", minimum: BODY_LIMITS.stations[0], maximum: BODY_LIMITS.stations[1], description: "Slices along the length (default 48)" },
    section_points: { type: "integer", minimum: BODY_LIMITS.sectionPoints[0], maximum: BODY_LIMITS.sectionPoints[1], description: "Points around each slice (default 40)" },
    roundness: { type: "number", minimum: BODY_LIMITS.roundness[0], maximum: BODY_LIMITS.roundness[1], description: "Cross-section when there is no front view: 2 oval, higher boxier (default 4)" },
    symmetric: { type: "boolean", description: "Top and front views are right halves, mirrored (default true)" },
    curve_steps: { type: "integer", minimum: MIN_CURVE_STEPS, maximum: MAX_CURVE_STEPS }
  },
  additionalProperties: false
};
var readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
var edit = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
var MAX_VERTICES = 5e4;
var MAX_LISTED_ELEMENTS = 3e3;
function sceneOf(ctx) {
  return ctx.store.getState().scene;
}
function libraryOf(ctx) {
  if (!ctx.host.library) throw new ToolError("My Parts is not available here.");
  return ctx.host.library;
}
function apply(ctx, command) {
  if (ctx.store.execute(command)) return;
  const last = ctx.store.getState().messages.at(-1);
  throw new ToolError(last ? `${last.text}${last.detail ? ` ${last.detail}` : ""}` : `${command.label} failed.`);
}
function result(summary, details) {
  return { text: details === void 0 ? summary : `${summary}
${JSON.stringify(details, null, 1)}` };
}
function resolveObject(scene, ref, label = "object") {
  if (typeof ref !== "string" || !ref.trim()) throw new ToolError(`${label} must be an object id or name.`);
  const key = ref.trim();
  if (scene.objects[key]) return scene.objects[key];
  const all = Object.values(scene.objects);
  let matches = all.filter((o) => o.name === key);
  if (matches.length === 0) matches = all.filter((o) => o.name.toLowerCase() === key.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ToolError(`"${key}" matches ${matches.length} objects. Use an id instead: ${matches.map((o) => o.id).join(", ")}.`);
  }
  throw new ToolError(`No object is called "${key}". Use list_objects to see ids and names.`);
}
function unlocked(scene, object) {
  if (isLocked(scene, object.id)) {
    const where = object.locked ? `${object.name} is locked` : `${object.name} is inside a locked group`;
    throw new ToolError(`${where}, so it cannot be changed. Ask the user first, then call set_lock with locked false on it.`);
  }
  return object;
}
function resolveConstruction(scene, ref) {
  const object = resolveObject(scene, ref);
  if (isSketchMesh(object) || isBodyMesh(object)) {
    throw new ToolError(`${object.name} is drawn (a ${isBodyMesh(object) ? "body" : "blueprint"}): change it with edit_blueprint, or call convert_to_points first to edit its 3D points directly.`);
  }
  if (!isConstructionMesh(object)) {
    throw new ToolError(`${object.name} is not point-built. Only objects made with create_point_mesh, Cube or Plane have editable points.`);
  }
  return object;
}
function resolveDrawn(scene, ref) {
  const object = resolveObject(scene, ref);
  if (!isSketchMesh(object) && !isBodyMesh(object)) {
    throw new ToolError(`${object.name} is not drawn. Blueprints come from create_blueprint, bodies from create_body, or both from drawing on the board.`);
  }
  return object;
}
function readShape(raw, base) {
  if (raw === void 0 || raw === null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ToolError('shape must be an object such as { "mode": "extrude", "depth": 0.2 }.');
  const shapeArgs = raw;
  return clampShape({
    mode: optEnum(shapeArgs, "mode", SHAPE_MODES) ?? base.mode,
    depth: shapeArgs.depth === void 0 ? base.depth : Number(shapeArgs.depth),
    segments: shapeArgs.segments === void 0 ? base.segments : Number(shapeArgs.segments),
    mirror: optBool(shapeArgs, "mirror") ?? base.mirror,
    axis: optEnum(shapeArgs, "axis", REVOLVE_AXES) ?? base.axis,
    curveSteps: shapeArgs.curve_steps === void 0 ? base.curveSteps : Number(shapeArgs.curve_steps)
  });
}
function readBodySettings(raw, base) {
  if (raw === void 0 || raw === null) return base;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ToolError('body must be an object such as { "stations": 64 }.');
  const b = raw;
  const num = (key, fallback) => b[key] === void 0 ? fallback : Number(b[key]);
  return clampBody({
    stations: num("stations", base.stations),
    sectionPoints: num("section_points", base.sectionPoints),
    roundness: num("roundness", base.roundness),
    symmetric: optBool(b, "symmetric") ?? base.symmetric,
    curveSteps: num("curve_steps", base.curveSteps)
  });
}
function blueprintSummary(object) {
  const { sketch, shape } = object.source;
  const generated = generateShape(sketch, shape);
  return {
    plane: sketch.plane,
    shape,
    filledAreas: generated.regions,
    geometry: reportSummary(analyzeGraph(meshGraphOf(object) ?? generated.graph))
  };
}
function bodySummary(object) {
  const generated = generateBody(object.source.views, object.source.body);
  return {
    body: object.source.body,
    closedViews: generated.closed,
    slices: generated.stations,
    ...generated.message ? { missing: generated.message } : {},
    geometry: reportSummary(analyzeGraph(meshGraphOf(object) ?? generated.graph))
  };
}
function typeOf(object) {
  if (object.kind === "group") return "group";
  if (object.source.type === "sketch") return "blueprint";
  if (object.source.type === "body") return "body";
  return object.source.type === "construction" ? "point-built" : object.source.primitive;
}
function drawingFromArgs(plane, rawPoints, label, closed, smooth) {
  let sketch = createSketch(plane);
  const ids = [];
  const smoothSet = smoothIndices(smooth, rawPoints.length, `${label} smooth`);
  rawPoints.forEach((item, i) => {
    if (!Array.isArray(item) || item.length !== 2 || !item.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new ToolError(`${label}[${i}] must be [x, y] with two finite numbers.`);
    }
    const added = addPoint(sketch, item[0], item[1], smoothSet.has(i));
    sketch = added.sketch;
    ids.push(added.pointId);
  });
  for (let i = 0; i + 1 < ids.length; i++) sketch = addLine(sketch, ids[i], ids[i + 1]).sketch;
  if (closed && ids.length >= 3) sketch = addLine(sketch, ids[ids.length - 1], ids[0]).sketch;
  return { sketch, ids };
}
function smoothIndices(raw, count, label) {
  if (raw === void 0 || raw === null || raw === false) return /* @__PURE__ */ new Set();
  if (raw === true) return new Set(Array.from({ length: count }, (_, i) => i));
  if (!Array.isArray(raw)) throw new ToolError(`${label} must be true, false or a list of point indices.`);
  return new Set(raw.map((value) => toIndex(value, count, label)));
}
function describe(object) {
  const out = {
    id: object.id,
    name: object.name,
    type: typeOf(object),
    position: roundVec(object.transform.position),
    rotation: roundVec(object.transform.rotation, 2),
    scale: roundVec(object.transform.scale)
  };
  if (object.kind === "mesh") {
    out.color = object.material.color;
    if (object.material.smooth) out.smoothShading = true;
    if (hasModifiers(object.modifiers)) out.modifiers = object.modifiers;
  }
  if (!object.visible) out.hidden = true;
  if (object.locked) out.locked = true;
  return out;
}
function tree(scene, ids) {
  return ids.map((id) => {
    const object = scene.objects[id];
    const node = describe(object);
    if (object.childIds.length) node.children = tree(scene, object.childIds);
    return node;
  });
}
function reportSummary(report) {
  return {
    vertices: report.vertices,
    edges: report.edges,
    faces: report.faces,
    triangles: report.triangles,
    closed: report.closed,
    problems: report.issues.filter((i) => i.severity !== "info").map((i) => i.message),
    notes: report.issues.filter((i) => i.severity === "info").map((i) => i.message)
  };
}
function applyTransformArgs(base, args) {
  return cleanTransform({
    position: optVec3(args, "position") ?? base.position,
    rotation: optVec3(args, "rotation") ?? base.rotation,
    scale: optVec3(args, "scale") ?? base.scale
  });
}
function parentFromArgs(scene, args) {
  const parent = args.parent;
  if (parent === void 0 || parent === null) return null;
  return resolveObject(scene, parent, "parent").id;
}
function addFaceWithEdges(graph, loop, allowNonPlanar, label) {
  if (new Set(loop).size !== loop.length) throw new ToolError(`${label} repeats a vertex.`);
  let next = graph;
  for (let i = 0; i < loop.length; i++) next = addEdge(next, loop[i], loop[(i + 1) % loop.length]).graph;
  try {
    return addFace(next, loop, { requirePlanar: !allowNonPlanar }).graph;
  } catch (error) {
    if (!(error instanceof GeometryError)) throw error;
    const hint = error.code === "non-planar" ? " Pass allow_non_planar: true to keep a bent face, or split it into triangles." : "";
    throw new ToolError(`${label} was rejected: ${error.message}${hint}`);
  }
}
function geometryCall(label, fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GeometryError) throw new ToolError(`${label}: ${error.message}`);
    throw error;
  }
}
function readVertexList(value, label) {
  return (value ?? []).map((item, i) => cleanVec3(toVec3(item, `${label}[${i}]`)));
}
var TOOLS = [
  {
    name: "get_status",
    title: "Get FORGEX status",
    description: "Shows where the tools are working (the open FORGEX 3D app, or a .forgex file), the project name and path, unsaved changes, object count, grid settings and the world conventions. Call this first.",
    inputSchema: noArgs,
    annotations: readOnly,
    run(_args, ctx) {
      const state = ctx.store.getState();
      const host = ctx.host.status();
      const count = Object.keys(state.scene.objects).length;
      const where = state.project.path ? `saved at ${state.project.path}` : "not saved to disk yet";
      return result(`${host.detail} Project "${state.project.name}" is ${where}, with ${count} object${count === 1 ? "" : "s"}${state.dirty ? " and unsaved changes" : ""}.`, {
        mode: host.mode,
        project: { name: state.project.name, path: state.project.path, unsavedChanges: state.dirty },
        projectsFolder: host.projectsFolder,
        objects: count,
        selected: state.selectedId,
        grid: state.settings,
        conventions: {
          units: "metres",
          up: "+Y",
          front: "+Z",
          rotation: "degrees, applied in X, Y, Z order",
          robloxStud: `${METERS_PER_ROBLOX_STUD} m`
        }
      });
    }
  },
  {
    name: "list_objects",
    title: "List scene objects",
    description: "Lists every object as a tree (groups contain children) with id, name, type, position, rotation, scale and colour.",
    inputSchema: noArgs,
    annotations: readOnly,
    run(_args, ctx) {
      const scene = sceneOf(ctx);
      const count = Object.keys(scene.objects).length;
      if (count === 0) return result("The scene is empty.");
      return result(`${count} object${count === 1 ? "" : "s"}:`, tree(scene, scene.rootIds));
    }
  },
  {
    name: "get_object",
    title: "Get object details",
    description: "Returns one object in full: transform, world position, parent and children. For point-built objects it also returns the geometry report and the vertex, edge and face ids you need for edit_point_mesh.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        include_geometry: { type: "boolean", description: "Include vertex, edge and face lists (default true)" }
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: readOnly,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const object = resolveObject(scene, args.object);
      const details = {
        ...describe(object),
        parent: object.parentId,
        children: object.childIds,
        worldPosition: roundVec(decomposeMatrix(worldMatrix(scene, object.id)).position)
      };
      const dots = (sketch) => ({
        points: Object.values(sketch.points).slice(0, MAX_LISTED_ELEMENTS).map((p) => ({ id: p.id, x: round(p.x, 6), y: round(p.y, 6), ...p.smooth ? { smooth: true } : {} })),
        lines: Object.values(sketch.lines).slice(0, MAX_LISTED_ELEMENTS).map((l) => ({ id: l.id, a: l.a, b: l.b }))
      });
      if (isSketchMesh(object)) {
        Object.assign(details, blueprintSummary(object), dots(object.source.sketch));
      }
      if (isBodyMesh(object)) {
        Object.assign(details, bodySummary(object), {
          views: Object.fromEntries(BODY_VIEWS.map((view) => [view, dots(object.source.views[view])]))
        });
      }
      if (isConstructionMesh(object)) {
        const graph = object.source.graph;
        details.geometry = reportSummary(analyzeGraph(graph));
        if (optBool(args, "include_geometry") !== false) {
          const vertices = Object.values(graph.vertices);
          const edges = Object.values(graph.edges);
          const faces = Object.values(graph.faces);
          details.vertices = vertices.slice(0, MAX_LISTED_ELEMENTS).map((v) => ({ id: v.id, position: roundVec(v.position, 6) }));
          details.edges = edges.slice(0, MAX_LISTED_ELEMENTS).map((e) => ({ id: e.id, a: e.a, b: e.b }));
          details.faces = faces.slice(0, MAX_LISTED_ELEMENTS).map((f) => ({ id: f.id, vertices: f.vertexIds }));
          if ([vertices, edges, faces].some((list) => list.length > MAX_LISTED_ELEMENTS)) {
            details.truncated = `Lists are cut at ${MAX_LISTED_ELEMENTS} items.`;
          }
        }
      }
      return result(`${object.name} (${typeOf(object)})`, details);
    }
  },
  {
    name: "list_parts",
    title: "List parts",
    description: "Lists the parts that add_part can create.",
    inputSchema: noArgs,
    annotations: readOnly,
    run() {
      return result(
        "Available parts:",
        PARTS.map((p) => ({ part: p.id, name: p.name, kind: p.category, description: p.description }))
      );
    }
  },
  {
    name: "add_part",
    title: "Add a part",
    description: "Adds a part from the library. cube and plane are point-built (editable vertices); sphere and cylinder are smooth 1 m primitives; group is an empty parent. Without a position the part rests on the ground at the origin. Names are made unique.",
    inputSchema: {
      type: "object",
      properties: {
        part: { type: "string", enum: PARTS.map((p) => p.id) },
        name: { type: "string" },
        ...transformProps,
        color,
        parent: objectRef("Optional parent object id or name")
      },
      required: ["part"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const partId = reqEnum(args, "part", PARTS.map((p) => p.id));
      const parentId = parentFromArgs(scene, args);
      const base = createPartObject(partId, { name: uniqueName(scene, optString(args, "name") ?? getPart(partId).name) });
      const transform = applyTransformArgs(base.transform, args);
      const colorValue = optColor(args, "color");
      const object = base.kind === "mesh" ? { ...base, transform, material: { color: colorValue ?? base.material.color } } : { ...base, transform };
      apply(ctx, new AddObjectsCommand([object], parentId, void 0, `AI: add ${object.name}`));
      return result(`Added ${object.name} (${object.id}).`, describe(object));
    }
  },
  {
    name: "create_point_mesh",
    title: "Build a mesh from points",
    description: "The FORGEX way to model: give vertices, connect them with edges, and faces are generated from the closed loops (or give faces explicitly). Positions are in metres in the object's local space, +Y up. Faces must be flat unless allow_non_planar is true. Normals are oriented automatically (closed shells face outward). Example cube: 8 vertices and 12 edges with fill_loops.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        vertices: { type: "array", items: vec3("Vertex position"), minItems: 1, description: "Vertex positions; edges and faces refer to them by index" },
        edges: {
          type: "array",
          items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 2, maxItems: 2 },
          description: "Pairs of vertex indices to connect"
        },
        faces: {
          type: "array",
          items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 3 },
          description: "Optional explicit faces as loops of vertex indices. Missing boundary edges are added."
        },
        fill_loops: { type: "boolean", description: "Generate faces from closed edge loops (default: true when no faces are given)" },
        allow_non_planar: { type: "boolean", description: "Allow bent explicit faces (default false)" },
        ...transformProps,
        color,
        parent: objectRef("Optional parent object id or name")
      },
      required: ["name", "vertices"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const name = uniqueName(scene, reqString(args, "name"));
      const positions = readVertexList(optArray(args, "vertices", MAX_VERTICES), "vertices");
      if (positions.length === 0) throw new ToolError("vertices needs at least one position.");
      const edges = optArray(args, "edges", MAX_VERTICES * 4);
      const faces = optArray(args, "faces", MAX_VERTICES * 2);
      const fill = optBool(args, "fill_loops") ?? !faces;
      const allowNonPlanar = optBool(args, "allow_non_planar") ?? false;
      const parentId = parentFromArgs(scene, args);
      let graph = createEmptyGraph();
      const ids = [];
      for (const p of positions) {
        const added = addVertex(graph, p);
        graph = added.graph;
        ids.push(added.vertexId);
      }
      edges?.forEach((edge, i) => {
        if (!Array.isArray(edge) || edge.length !== 2) throw new ToolError(`edges[${i}] must be a pair of vertex indices [a, b].`);
        const a = toIndex(edge[0], ids.length, `edges[${i}][0]`);
        const b = toIndex(edge[1], ids.length, `edges[${i}][1]`);
        if (a === b) throw new ToolError(`edges[${i}] connects vertex ${a} to itself.`);
        graph = addEdge(graph, ids[a], ids[b]).graph;
      });
      faces?.forEach((face, i) => {
        if (!Array.isArray(face) || face.length < 3) throw new ToolError(`faces[${i}] must list at least 3 vertex indices.`);
        const loop = face.map((v, k) => ids[toIndex(v, ids.length, `faces[${i}][${k}]`)]);
        graph = addFaceWithEdges(graph, loop, allowNonPlanar, `faces[${i}]`);
      });
      let filled = 0;
      if (fill) {
        const fillResult = fillClosedLoops(graph);
        graph = fillResult.graph;
        filled = fillResult.faceIds.length;
      }
      if (Object.keys(graph.faces).length > 0) graph = orientFaces(graph).graph;
      const object = {
        id: createObjectId(),
        name,
        kind: "mesh",
        parentId: null,
        childIds: [],
        visible: true,
        transform: applyTransformArgs(identityTransform(), args),
        material: { color: optColor(args, "color") ?? "#3d9fe8" },
        source: { type: "construction", graph }
      };
      apply(ctx, new AddObjectsCommand([object], parentId, void 0, `AI: build ${name}`));
      const report = reportSummary(analyzeGraph(graph));
      return result(`Built ${name} (${object.id}) from ${ids.length} points${filled ? `; ${filled} faces generated from closed loops` : ""}.`, {
        id: object.id,
        name,
        vertexIds: ids,
        geometry: report
      });
    }
  },
  {
    name: "edit_point_mesh",
    title: "Edit a point-built mesh",
    description: "Edits the vertices, edges and faces of a point-built object in one undoable step. Steps run in this order: remove faces, remove edges, remove vertices (dependent edges and faces go too), add vertices, move vertices, add edges, add faces, fill loops, recalculate normals. Refer to existing vertices by id (v3) and to vertices added in this call by their index in add_vertices. Positions are local, in metres.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        remove_faces: { type: "array", items: { type: "string" }, description: "Face ids such as f2" },
        remove_edges: { type: "array", items: { type: "string" }, description: "Edge ids such as e5" },
        remove_vertices: { type: "array", items: { type: "string" }, description: "Vertex ids such as v3" },
        add_vertices: { type: "array", items: vec3("Vertex position") },
        move_vertices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              vertex: vertexRef,
              position: vec3("New position"),
              offset: vec3("Move by this amount instead")
            },
            required: ["vertex"]
          }
        },
        add_edges: { type: "array", items: { type: "array", items: vertexRef, minItems: 2, maxItems: 2 } },
        add_faces: { type: "array", items: { type: "array", items: vertexRef, minItems: 3 } },
        fill_loops: { type: "boolean", description: "Generate faces from closed edge loops after the other steps" },
        recalculate_normals: { type: "boolean", description: "Re-orient all faces (default true when faces were added)" },
        allow_non_planar: { type: "boolean", description: "Allow bent faces in add_faces (default false)" }
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveConstruction(sceneOf(ctx), args.object));
      const before = object.source.graph;
      let graph = before;
      const allowNonPlanar = optBool(args, "allow_non_planar") ?? false;
      for (const id of optArray(args, "remove_faces", MAX_VERTICES) ?? []) {
        graph = geometryCall("remove_faces", () => removeFace(graph, String(id)));
      }
      for (const id of optArray(args, "remove_edges", MAX_VERTICES) ?? []) {
        graph = geometryCall("remove_edges", () => removeEdge(graph, String(id)));
      }
      for (const id of optArray(args, "remove_vertices", MAX_VERTICES) ?? []) {
        graph = geometryCall("remove_vertices", () => removeVertex(graph, String(id)));
      }
      const newIds = [];
      for (const p of readVertexList(optArray(args, "add_vertices", MAX_VERTICES), "add_vertices")) {
        const added = addVertex(graph, p);
        graph = added.graph;
        newIds.push(added.vertexId);
      }
      const ref = (value, label) => {
        if (typeof value === "string") {
          if (!graph.vertices[value]) throw new ToolError(`${label}: vertex ${value} does not exist. Use get_object to see vertex ids.`);
          return value;
        }
        if (newIds.length === 0) throw new ToolError(`${label}: use a vertex id such as v3 (no add_vertices in this call).`);
        return newIds[toIndex(value, newIds.length, label)];
      };
      (optArray(args, "move_vertices", MAX_VERTICES) ?? []).forEach((item, i) => {
        if (typeof item !== "object" || item === null) throw new ToolError(`move_vertices[${i}] must be { vertex, position } or { vertex, offset }.`);
        const move = item;
        const id = ref(move.vertex, `move_vertices[${i}].vertex`);
        const position = optVec3(move, "position");
        const offset = optVec3(move, "offset");
        if (!position && !offset) throw new ToolError(`move_vertices[${i}] needs position or offset.`);
        const target = position ?? add(graph.vertices[id].position, offset);
        graph = moveVertex(graph, id, cleanVec3(target));
      });
      (optArray(args, "add_edges", MAX_VERTICES * 4) ?? []).forEach((edge, i) => {
        if (!Array.isArray(edge) || edge.length !== 2) throw new ToolError(`add_edges[${i}] must be a pair of vertices.`);
        const a = ref(edge[0], `add_edges[${i}][0]`);
        const b = ref(edge[1], `add_edges[${i}][1]`);
        graph = geometryCall(`add_edges[${i}]`, () => addEdge(graph, a, b).graph);
      });
      let facesAdded = 0;
      (optArray(args, "add_faces", MAX_VERTICES * 2) ?? []).forEach((face, i) => {
        if (!Array.isArray(face) || face.length < 3) throw new ToolError(`add_faces[${i}] must list at least 3 vertices.`);
        const loop = face.map((v, k) => ref(v, `add_faces[${i}][${k}]`));
        graph = addFaceWithEdges(graph, loop, allowNonPlanar, `add_faces[${i}]`);
        facesAdded++;
      });
      if (optBool(args, "fill_loops")) {
        const filled = fillClosedLoops(graph);
        graph = filled.graph;
        facesAdded += filled.faceIds.length;
      }
      if (optBool(args, "recalculate_normals") ?? facesAdded > 0) graph = orientFaces(graph).graph;
      if (graph === before) return result(`Nothing changed on ${object.name}.`);
      apply(ctx, new SetGraphCommand(object.id, before, graph, `AI: edit points of ${object.name}`));
      return result(`Edited ${object.name}.`, {
        addedVertexIds: newIds,
        facesAdded,
        geometry: reportSummary(analyzeGraph(graph))
      });
    }
  },
  {
    name: "check_geometry",
    title: "Check geometry",
    description: "Checks point-built and blueprint objects against the geometry invariants: loose vertices, open boundaries, non-manifold edges, bent or zero-area faces, and inconsistent normals. Checks every such object when none is named.",
    inputSchema: { type: "object", properties: { object: objectRef("Optional object id or name") }, additionalProperties: false },
    annotations: readOnly,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const targets = args.object !== void 0 && args.object !== null ? [resolveObject(scene, args.object)] : Object.values(scene.objects).filter((o) => meshGraphOf(o) !== null);
      const checkable = targets.filter((o) => meshGraphOf(o) !== null);
      if (checkable.length === 0) return result("There are no point-built or blueprint objects to check.");
      const reports = checkable.map((o) => ({ id: o.id, name: o.name, ...reportSummary(analyzeGraph(meshGraphOf(o))) }));
      const problems = reports.reduce((n, r) => n + r.problems.length, 0);
      return result(problems === 0 ? "No geometry problems found." : `${problems} geometry problem${problems === 1 ? "" : "s"} found.`, reports);
    }
  },
  {
    name: "create_blueprint",
    title: "Draw a blueprint",
    description: 'Draws a 2D outline of dots and lines on a plane (front, side or top) and turns it into a 3D object, the same way the user draws on the FORGEX board. Closed loops are filled; a loop inside another becomes a hole. shape.mode: "extrude" (default, gives the outline a thickness of shape.depth metres), "flat" (a panel), or "revolve" (spins the lines around an axis like a lathe: shape.axis "vertical" spins around x = 0 for bottles and vases, draw the right half with x >= 0; "horizontal" spins around y = 0 for wheels and barrels, draw the profile above the line with y >= 0; on the front plane that axle runs along X). shape.mirror copies the drawing across x = 0, so you can draw half of a symmetric object. smooth turns corners into curves. Without lines or loops, the points are joined in order into one closed outline. For a car body, plane or boat hull use create_body instead.',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        plane: {
          type: "string",
          enum: [...SKETCH_PLANES],
          description: "front: x right (+X), y up (+Y), thickness along Z. side: seen from the right, x towards the back (-Z), y up, thickness along X. top: seen from above, x right (+X), y towards the back (-Z); extrusions grow upwards from the ground like walls. Default front."
        },
        points: {
          type: "array",
          items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          minItems: 1,
          description: "Dot positions [x, y] in metres on the plane"
        },
        lines: { type: "array", items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 2, maxItems: 2 }, description: "Pairs of point indices to join" },
        loops: { type: "array", items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 3 }, description: "Closed outlines as lists of point indices" },
        closed: { type: "boolean", description: "When no lines or loops are given: close the outline (default true)" },
        smooth: {
          anyOf: [{ type: "boolean" }, { type: "array", items: { type: "integer", minimum: 0 } }],
          description: "Smooth dots bend their lines into curves through the dot (true for all, or a list of point indices). Use for car bodies, blades, organic shapes."
        },
        shape: shapeSchema,
        ...transformProps,
        color,
        parent: objectRef("Optional parent object id or name")
      },
      required: ["name", "points"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const plane = optEnum(args, "plane", SKETCH_PLANES) ?? "front";
      const rawPoints = optArray(args, "points", MAX_VERTICES) ?? [];
      if (rawPoints.length === 0) throw new ToolError("points needs at least one [x, y] position.");
      let sketch = createSketch(plane);
      const ids = [];
      const smoothSet = smoothIndices(args.smooth, rawPoints.length, "smooth");
      rawPoints.forEach((item, i) => {
        if (!Array.isArray(item) || item.length !== 2 || !item.every((n) => typeof n === "number" && Number.isFinite(n))) {
          throw new ToolError(`points[${i}] must be [x, y] with two finite numbers.`);
        }
        const added = addPoint(sketch, item[0], item[1], smoothSet.has(i));
        sketch = added.sketch;
        ids.push(added.pointId);
      });
      const join3 = (a, b, label) => {
        const ia = toIndex(a, ids.length, label);
        const ib = toIndex(b, ids.length, label);
        if (ia === ib) throw new ToolError(`${label} joins point ${ia} to itself.`);
        sketch = addLine(sketch, ids[ia], ids[ib]).sketch;
      };
      const lines = optArray(args, "lines", MAX_VERTICES * 4);
      const loops = optArray(args, "loops", MAX_VERTICES);
      lines?.forEach((line, i) => {
        if (!Array.isArray(line) || line.length !== 2) throw new ToolError(`lines[${i}] must be a pair of point indices.`);
        join3(line[0], line[1], `lines[${i}]`);
      });
      loops?.forEach((loop, i) => {
        if (!Array.isArray(loop) || loop.length < 3) throw new ToolError(`loops[${i}] must list at least 3 point indices.`);
        loop.forEach((index, k) => join3(index, loop[(k + 1) % loop.length], `loops[${i}]`));
      });
      if (!lines && !loops && ids.length >= 2) {
        for (let i = 0; i + 1 < ids.length; i++) sketch = addLine(sketch, ids[i], ids[i + 1]).sketch;
        if ((optBool(args, "closed") ?? true) && ids.length >= 3) sketch = addLine(sketch, ids[ids.length - 1], ids[0]).sketch;
      }
      const shape = readShape(args.shape, DEFAULT_SHAPE);
      const base = createBlueprintObject({
        name: uniqueName(scene, reqString(args, "name")),
        sketch,
        shape,
        color: optColor(args, "color") ?? BLUEPRINT_COLORS[Object.keys(scene.objects).length % BLUEPRINT_COLORS.length]
      });
      const object = { ...base, transform: applyTransformArgs(base.transform, args) };
      apply(ctx, new AddObjectsCommand([object], parentFromArgs(scene, args), void 0, `AI: draw ${object.name}`));
      return result(`Drew ${object.name} (${object.id}) with ${ids.length} dots.`, {
        id: object.id,
        pointIds: ids,
        ...blueprintSummary(object)
      });
    }
  },
  {
    name: "edit_blueprint",
    title: "Edit a blueprint",
    description: "Changes a blueprint drawing and how it becomes 3D, in one undoable step. Steps run in order: remove lines, remove points (their lines go too), add points, move points, add lines, then plane and shape. Refer to existing dots by id (p3) and to dots added in this call by their index in add_points. Coordinates are [x, y] metres on the drawing plane.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        remove_lines: { type: "array", items: { type: "string" } },
        remove_points: { type: "array", items: { type: "string" } },
        add_points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } },
        move_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              point: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0 }] },
              position: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
              offset: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }
            },
            required: ["point"]
          }
        },
        add_lines: {
          type: "array",
          items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0 }] }, minItems: 2, maxItems: 2 }
        },
        smooth_points: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0 }] }, description: "Dots to make smooth (curved)" },
        sharp_points: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0 }] }, description: "Dots to make sharp corners" },
        view: { type: "string", enum: [...BODY_VIEWS], description: "For a body: which drawing to edit (side, top or front). Required for bodies." },
        plane: { type: "string", enum: [...SKETCH_PLANES], description: "Blueprints only: move the drawing to another plane" },
        shape: shapeSchema,
        body: bodySchema
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveDrawn(sceneOf(ctx), args.object));
      const before = object.source;
      const view = optEnum(args, "view", BODY_VIEWS);
      if (before.type === "body" && !view) throw new ToolError(`${object.name} is a body: say which drawing to edit with view (side, top or front).`);
      const original = before.type === "body" ? before.views[view] : before.sketch;
      let sketch = original;
      const guard = (label, fn) => {
        try {
          return fn();
        } catch (error) {
          if (error instanceof SketchError) throw new ToolError(`${label}: ${error.message}`);
          throw error;
        }
      };
      for (const id of optArray(args, "remove_lines", MAX_VERTICES) ?? []) sketch = guard("remove_lines", () => removeLine(sketch, String(id)));
      for (const id of optArray(args, "remove_points", MAX_VERTICES) ?? []) sketch = guard("remove_points", () => removePoint(sketch, String(id)));
      const newIds = [];
      (optArray(args, "add_points", MAX_VERTICES) ?? []).forEach((item, i) => {
        if (!Array.isArray(item) || item.length !== 2) throw new ToolError(`add_points[${i}] must be [x, y].`);
        const added = guard(`add_points[${i}]`, () => addPoint(sketch, Number(item[0]), Number(item[1])));
        sketch = added.sketch;
        newIds.push(added.pointId);
      });
      const ref = (value, label) => {
        if (typeof value === "string") {
          if (!sketch.points[value]) throw new ToolError(`${label}: dot ${value} does not exist. Use get_object to see dot ids.`);
          return value;
        }
        return newIds[toIndex(value, newIds.length, label)];
      };
      (optArray(args, "move_points", MAX_VERTICES) ?? []).forEach((item, i) => {
        if (typeof item !== "object" || item === null) throw new ToolError(`move_points[${i}] must be { point, position } or { point, offset }.`);
        const move = item;
        const id = ref(move.point, `move_points[${i}].point`);
        const position = Array.isArray(move.position) ? move.position.map(Number) : null;
        const offset = Array.isArray(move.offset) ? move.offset.map(Number) : null;
        const current = sketch.points[id];
        const target = position ?? (offset ? [current.x + offset[0], current.y + offset[1]] : null);
        if (!target) throw new ToolError(`move_points[${i}] needs position or offset.`);
        sketch = guard(`move_points[${i}]`, () => movePoint(sketch, id, target[0], target[1]));
      });
      (optArray(args, "add_lines", MAX_VERTICES * 4) ?? []).forEach((line, i) => {
        if (!Array.isArray(line) || line.length !== 2) throw new ToolError(`add_lines[${i}] must be a pair of dots.`);
        const a = ref(line[0], `add_lines[${i}][0]`);
        const b = ref(line[1], `add_lines[${i}][1]`);
        sketch = guard(`add_lines[${i}]`, () => addLine(sketch, a, b).sketch);
      });
      const smoothRefs = (key) => (optArray(args, key, MAX_VERTICES) ?? []).map((value, i) => ref(value, `${key}[${i}]`));
      sketch = setPointsSmooth(sketch, smoothRefs("smooth_points"), true);
      sketch = setPointsSmooth(sketch, smoothRefs("sharp_points"), false);
      let after;
      if (before.type === "body") {
        if (args.plane !== void 0 || args.shape !== void 0) throw new ToolError("plane and shape are for blueprints; bodies use view and body settings.");
        const body2 = readBodySettings(args.body, before.body);
        if (sketch === original && JSON.stringify(body2) === JSON.stringify(before.body)) return result(`Nothing changed on ${object.name}.`);
        after = { type: "body", views: { ...before.views, [view]: sketch }, body: body2 };
      } else {
        if (args.body !== void 0) throw new ToolError("body settings are for bodies; blueprints use shape.");
        const plane = optEnum(args, "plane", SKETCH_PLANES);
        if (plane) sketch = setPlane(sketch, plane);
        const shape = readShape(args.shape, before.shape);
        if (sketch === original && JSON.stringify(shape) === JSON.stringify(before.shape)) return result(`Nothing changed on ${object.name}.`);
        after = { type: "sketch", sketch, shape };
      }
      apply(ctx, new SetSourceCommand(object.id, before, after, `AI: edit ${object.name}${view ? ` (${view} view)` : ""}`));
      const edited = { ...object, source: after };
      return result(`Edited ${object.name}.`, {
        addedPointIds: newIds,
        ...edited.source.type === "body" ? bodySummary(edited) : blueprintSummary(edited)
      });
    }
  },
  {
    name: "create_body",
    title: "Loft a body from three views",
    description: "Builds a smooth closed body from three outlines, the way car designers work from blueprints: the side view (length and height), the top view (length and width) and an optional front view (the cross-section shape). Use it for car bodies, cabins, aircraft fuselages, boat hulls and helmets. Coordinates: side view [x, y] has x = -Z (the front of the object, +Z, is on the left) and y = up; top view [x, y] has x = X and y = -Z (front at the bottom); front view [x, y] has x = X and y = up. The side view is a closed outline. With symmetric (default true) the top and front views are the right half only (x >= 0), drawn from the centre line round to the centre line. Notches cut up into the bottom of the side outline make wheel arches. smooth (default true) curves the outlines through the dots. Build a car from several bodies (body, cabin) plus revolved wheels; add_template shows complete examples.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        side: { type: "array", items: point2, minItems: 3, description: "Side view outline [x = -Z, y = up], closed" },
        top: { type: "array", items: point2, minItems: 2, description: "Top view outline [x = X, y = -Z]: right half when symmetric" },
        front: { type: "array", items: point2, description: "Optional front view cross-section [x = X, y = up]: right half when symmetric" },
        smooth: { type: "boolean", description: "Curve the outlines through every dot (default true)" },
        body: bodySchema,
        ...transformProps,
        color,
        parent: objectRef("Optional parent object id or name")
      },
      required: ["name", "side", "top"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const body2 = readBodySettings(args.body, DEFAULT_BODY);
      const smooth = optBool(args, "smooth") ?? true;
      const empty = createBodyViews();
      const read = (key, closed) => {
        const list = optArray(args, key, MAX_VERTICES);
        return list && list.length ? drawingFromArgs(key, list, key, closed, smooth).sketch : empty[key];
      };
      const views2 = { side: read("side", true), top: read("top", !body2.symmetric), front: read("front", !body2.symmetric) };
      const base = createBodyObject({
        name: uniqueName(scene, reqString(args, "name")),
        views: views2,
        body: body2,
        color: optColor(args, "color") ?? BLUEPRINT_COLORS[Object.keys(scene.objects).length % BLUEPRINT_COLORS.length]
      });
      const object = { ...base, transform: applyTransformArgs(base.transform, args) };
      apply(ctx, new AddObjectsCommand([object], parentFromArgs(scene, args), void 0, `AI: loft ${object.name}`));
      const summary = bodySummary(object);
      return result(summary.missing ? `Created ${object.name} (${object.id}), but ${String(summary.missing)}` : `Lofted ${object.name} (${object.id}).`, { id: object.id, ...summary });
    }
  },
  {
    name: "add_template",
    title: "Add a ready-made model",
    description: "Adds a complete, fully editable model built from bodies and blueprints: supercar (low mid-engine sports car) or saloon (long luxury limousine). Every part (body, cabin, lights, wheels with tyres, rims and spokes) can be reshaped afterwards with edit_blueprint. A good starting point for cars.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: TEMPLATES.map((t) => t.id) },
        name: { type: "string" },
        position: vec3("Where to put it, in metres; it rests on the ground"),
        color: { type: "string", description: "Paint colour for the body, for example #c0392b" }
      },
      required: ["template"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const id = reqEnum(args, "template", TEMPLATES.map((t) => t.id));
      const position = optVec3(args, "position");
      let objects = createTemplate(id, { groundPosition: position ? [position[0], position[2]] : [0, 0] });
      const paint = optColor(args, "color");
      objects = objects.map((o, i) => {
        if (i === 0) return { ...o, name: uniqueName(scene, optString(args, "name") ?? getTemplate(id).name) };
        if (paint && o.kind === "mesh" && o.name === "Body" && o.parentId === objects[0].id) return { ...o, material: { ...o.material, color: paint } };
        return o;
      });
      apply(ctx, new AddObjectsCommand(objects, null, void 0, `AI: add ${objects[0].name}`));
      return result(`Added ${objects[0].name} (${objects[0].id}) with ${objects.length - 1} parts.`, tree(sceneOf(ctx), [objects[0].id]));
    }
  },
  {
    name: "set_modifiers",
    title: "Smooth and mirror a mesh",
    description: "Non-destructive finishing for any mesh: subdivide (0 to 3 levels of Catmull-Clark smoothing, which rounds blocky point-built shapes into organic ones), mirror (copy the mesh across its local x, y or z = 0 plane and join the halves, so you can model one half), and smooth_shading (curved surfaces look round). The editable source is unchanged; values you leave out stay as they are.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        subdivide: { type: "integer", minimum: 0, maximum: MAX_SUBDIVISION },
        mirror: { type: "string", enum: [...MIRROR_AXES] },
        smooth_shading: { type: "boolean" }
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
      if (object.kind !== "mesh") throw new ToolError(`${object.name} is a group; modifiers work on meshes.`);
      const current = object.modifiers ?? NO_MODIFIERS;
      const modifiers = cleanModifiers({
        mirror: optEnum(args, "mirror", MIRROR_AXES) ?? current.mirror,
        subdivide: args.subdivide === void 0 ? current.subdivide : Number(args.subdivide)
      });
      const smooth = optBool(args, "smooth_shading") ?? !!object.material.smooth;
      apply(
        ctx,
        new SetMeshLookCommand(
          object.id,
          { modifiers: object.modifiers, smooth: !!object.material.smooth },
          { modifiers: hasModifiers(modifiers) ? modifiers : void 0, smooth },
          `AI: modifiers on ${object.name}`
        )
      );
      const updated = sceneOf(ctx).objects[object.id];
      return result(`Updated ${object.name}.`, { ...describe(updated), geometry: reportSummary(analyzeGraph(meshGraphOf(updated))) });
    }
  },
  {
    name: "convert_to_points",
    title: "Convert blueprint to points",
    description: "Turns a blueprint or body into a point-built object with its current 3D shape, so individual vertices can be edited with edit_point_mesh. The drawings are no longer used afterwards (undo restores them). Modifiers stay on.",
    inputSchema: { type: "object", properties: { object: objectRef() }, required: ["object"], additionalProperties: false },
    annotations: edit,
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveDrawn(sceneOf(ctx), args.object));
      const graph = sourceGraphOf(object);
      apply(ctx, new SetSourceCommand(object.id, object.source, { type: "construction", graph }, `AI: convert ${object.name} to points`));
      const counts = analyzeGraph(graph);
      return result(`${object.name} is now point-built with ${counts.vertices} vertices and ${counts.faces} faces.`);
    }
  },
  {
    name: "set_transform",
    title: "Set transform",
    description: "Sets position (metres), rotation (degrees) and/or scale of an object, relative to its parent. Values you leave out stay as they are.",
    inputSchema: {
      type: "object",
      properties: { object: objectRef(), ...transformProps },
      required: ["object"],
      additionalProperties: false
    },
    annotations: { ...edit, idempotentHint: true },
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
      if (args.position === void 0 && args.rotation === void 0 && args.scale === void 0) {
        throw new ToolError("Give at least one of position, rotation or scale.");
      }
      const after = applyTransformArgs(object.transform, args);
      apply(ctx, new SetTransformCommand(object.id, object.transform, after, `AI: transform ${object.name}`));
      return result(`Updated ${object.name}.`, describe({ ...object, transform: after }));
    }
  },
  {
    name: "set_color",
    title: "Set colour",
    description: "Sets the colour of a mesh object.",
    inputSchema: { type: "object", properties: { object: objectRef(), color }, required: ["object", "color"], additionalProperties: false },
    annotations: { ...edit, idempotentHint: true },
    run(args, ctx) {
      const object = unlocked(sceneOf(ctx), resolveObject(sceneOf(ctx), args.object));
      if (object.kind !== "mesh") throw new ToolError(`${object.name} is a group and has no colour.`);
      const value = optColor(args, "color");
      if (!value) throw new ToolError("color is required.");
      if (value !== object.material.color) apply(ctx, new SetColorCommand(object.id, object.material.color, value));
      return result(`${object.name} is now ${value}.`);
    }
  },
  {
    name: "rename_object",
    title: "Rename object",
    description: "Renames an object. Names show in the scene hierarchy and are saved in the project.",
    inputSchema: { type: "object", properties: { object: objectRef(), name: { type: "string" } }, required: ["object", "name"], additionalProperties: false },
    annotations: { ...edit, idempotentHint: true },
    run(args, ctx) {
      const object = resolveObject(sceneOf(ctx), args.object);
      const name = reqString(args, "name");
      if (name !== object.name) apply(ctx, new RenameObjectCommand(object.id, object.name, name));
      return result(`Renamed ${object.id} to ${name}.`);
    }
  },
  {
    name: "set_visibility",
    title: "Show or hide",
    description: "Shows or hides an object (and, in the viewport, its children).",
    inputSchema: {
      type: "object",
      properties: { object: objectRef(), visible: { type: "boolean" } },
      required: ["object", "visible"],
      additionalProperties: false
    },
    annotations: { ...edit, idempotentHint: true },
    run(args, ctx) {
      const object = resolveObject(sceneOf(ctx), args.object);
      const visible = optBool(args, "visible");
      if (visible === void 0) throw new ToolError("visible is required.");
      if (visible !== object.visible) apply(ctx, new SetVisibilityCommand(object.id, visible, object.name));
      return result(`${object.name} is now ${visible ? "visible" : "hidden"}.`);
    }
  },
  {
    name: "delete_object",
    title: "Delete object",
    description: "Deletes an object together with all its children. It can be undone.",
    inputSchema: { type: "object", properties: { object: objectRef() }, required: ["object"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const object = unlocked(scene, resolveObject(scene, args.object));
      const count = Object.values(scene.objects).filter((o) => isSelfOrAncestor(scene, object.id, o.id)).length;
      apply(ctx, new DeleteObjectCommand(object.id, object.name));
      return result(`Deleted ${object.name}${count > 1 ? ` and ${count - 1} child object${count === 2 ? "" : "s"}` : ""}. undo brings it back.`);
    }
  },
  {
    name: "duplicate_object",
    title: "Duplicate object",
    description: "Copies an object and all its children with new ids, placed next to the original in the hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        offset: vec3("Move the copy by this amount in metres (default [0, 0, 0])"),
        name: { type: "string" }
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const object = resolveObject(scene, args.object);
      const copies = cloneSubtree(scene, object.id, createObjectId);
      const offset = optVec3(args, "offset") ?? [0, 0, 0];
      copies[0] = {
        ...copies[0],
        name: uniqueName(scene, optString(args, "name") ?? object.name),
        transform: cleanTransform({ ...copies[0].transform, position: add(copies[0].transform.position, offset) })
      };
      apply(ctx, new AddObjectsCommand(copies, object.parentId, indexInParent(scene, object.id) + 1, `AI: duplicate ${object.name}`));
      return result(`Created ${copies[0].name} (${copies[0].id})${copies.length > 1 ? ` with ${copies.length - 1} children` : ""}.`, describe(copies[0]));
    }
  },
  {
    name: "set_parent",
    title: "Set parent",
    description: "Moves an object under another object (or to the top level with parent null). Its position in the world stays the same.",
    inputSchema: {
      type: "object",
      properties: { object: objectRef(), parent: { type: ["string", "null"], description: "New parent id or name, or null for the top level" } },
      required: ["object", "parent"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const object = unlocked(scene, resolveObject(scene, args.object));
      const parentId = parentFromArgs(scene, args);
      if (parentId !== null && isSelfOrAncestor(scene, object.id, parentId)) {
        throw new ToolError(`${object.name} cannot go inside itself or one of its children.`);
      }
      if (parentId === object.parentId) return result(`${object.name} already has that parent.`);
      const siblings = parentId === null ? scene.rootIds : scene.objects[parentId].childIds;
      apply(ctx, new MoveObjectCommand(object.id, parentId, siblings.length, `AI: move ${object.name}`));
      return result(`${object.name} is now ${parentId ? `inside ${scene.objects[parentId].name}` : "at the top level"}.`);
    }
  },
  {
    name: "group_objects",
    title: "Group objects",
    description: "Creates a group at the centre of the given objects and moves them into it, keeping their world positions.",
    inputSchema: {
      type: "object",
      properties: { objects: { type: "array", items: { type: "string" }, minItems: 1 }, name: { type: "string" } },
      required: ["objects"],
      additionalProperties: false
    },
    annotations: edit,
    run(args, ctx) {
      const scene = sceneOf(ctx);
      const refs = optArray(args, "objects", 1e3);
      if (!refs || refs.length === 0) throw new ToolError("objects needs at least one object.");
      const chosen = [...new Map(refs.map((r) => resolveObject(scene, r)).map((o) => [o.id, o])).values()];
      const tops = chosen.filter((o) => !chosen.some((other) => other.id !== o.id && isSelfOrAncestor(scene, other.id, o.id)));
      const centre = tops.map((o) => decomposeMatrix(worldMatrix(scene, o.id)).position).reduce((sum, p) => add(sum, p), [0, 0, 0]).map((v) => round(v / tops.length, 6));
      const group2 = createPartObject("group", { name: uniqueName(scene, optString(args, "name") ?? "Group") });
      const placed = { ...group2, transform: { ...group2.transform, position: centre } };
      const commands = [new AddObjectsCommand([placed], null)];
      tops.forEach((o, i) => commands.push(new MoveObjectCommand(o.id, placed.id, i)));
      apply(ctx, new CompositeCommand(`AI: group ${tops.length} objects`, commands, placed.id));
      return result(`Grouped ${tops.map((o) => o.name).join(", ")} into ${placed.name} (${placed.id}).`);
    }
  },
  {
    name: "select_object",
    title: "Select object",
    description: "Selects an object in the editor (pass null to clear the selection). Useful before capture_viewport in the app.",
    inputSchema: { type: "object", properties: { object: { type: ["string", "null"] } }, required: ["object"], additionalProperties: false },
    annotations: { ...readOnly, idempotentHint: true },
    run(args, ctx) {
      if (args.object === null) {
        ctx.store.select(null);
        return result("Selection cleared.");
      }
      const object = resolveObject(sceneOf(ctx), args.object);
      ctx.store.select(object.id);
      return result(`Selected ${object.name}.`);
    }
  },
  {
    name: "set_lock",
    title: "Lock or unlock object",
    description: "Locks an object so it cannot be picked in the 3D view, moved, edited or deleted (by the user or by these tools) until it is unlocked. Use it to protect finished parts. Locking a group protects everything inside it.",
    inputSchema: {
      type: "object",
      properties: { object: objectRef(), locked: { type: "boolean" } },
      required: ["object", "locked"],
      additionalProperties: false
    },
    annotations: { ...edit, idempotentHint: true },
    run(args, ctx) {
      const object = resolveObject(sceneOf(ctx), args.object);
      const locked = optBool(args, "locked");
      if (locked === void 0) throw new ToolError("locked must be true or false.");
      if (!!object.locked === locked) return result(`${object.name} is already ${locked ? "locked" : "unlocked"}.`);
      apply(ctx, new SetLockCommand(object.id, locked, object.name));
      return result(`${object.name} is now ${locked ? "locked" : "unlocked"}.`);
    }
  },
  {
    name: "list_snapshots",
    title: "List snapshots",
    description: "Lists the saved versions (snapshots) stored in this project, oldest first, with their ids, names, dates and object counts.",
    inputSchema: noArgs,
    annotations: readOnly,
    run(_args, ctx) {
      const snapshots = ctx.store.getState().snapshots;
      if (snapshots.length === 0) return result("This project has no snapshots yet. save_snapshot takes one.");
      return result(
        `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}:`,
        snapshots.map((snapshot) => ({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, objects: Object.keys(snapshot.scene.objects).length }))
      );
    }
  },
  {
    name: "save_snapshot",
    title: "Save snapshot",
    description: "Saves the whole scene as a named version inside the project, to come back to with restore_snapshot. Take one before a big or risky change. Projects keep the latest 40.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: 'Name such as "Before new wheels" (default "Version N")' } }, additionalProperties: false },
    annotations: edit,
    run(args, ctx) {
      const state = ctx.store.getState();
      const name = optString(args, "name", 120) ?? nextSnapshotName(state.snapshots);
      const snapshot = createSnapshot(state.scene, name, randomId("snap"));
      ctx.store.setSnapshots(addSnapshot(state.snapshots, snapshot));
      return result(`Saved snapshot \u201C${snapshot.name}\u201D (${snapshot.id}) with ${Object.keys(snapshot.scene.objects).length} objects.`);
    }
  },
  {
    name: "restore_snapshot",
    title: "Restore snapshot",
    description: "Replaces the scene with a saved snapshot. This is one undoable change: undo brings back the scene as it was before.",
    inputSchema: { type: "object", properties: { snapshot: { type: "string", description: "Snapshot id or exact name" } }, required: ["snapshot"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run(args, ctx) {
      const ref = reqString(args, "snapshot", 200).trim();
      const state = ctx.store.getState();
      const snapshot = state.snapshots.find((s) => s.id === ref) ?? state.snapshots.find((s) => s.name === ref) ?? state.snapshots.find((s) => s.name.toLowerCase() === ref.toLowerCase());
      if (!snapshot) throw new ToolError(`No snapshot is called "${ref}". Use list_snapshots to see them.`);
      apply(ctx, new ReplaceSceneCommand(state.scene, snapshot.scene, `Restore ${snapshot.name}`));
      return result(`Restored \u201C${snapshot.name}\u201D (${Object.keys(snapshot.scene.objects).length} objects). undo returns to the scene before.`);
    }
  },
  {
    name: "list_library",
    title: "List My Parts",
    description: "Lists the reusable parts in My Parts, the shared library every FORGEX project can use (on Windows: Documents\\FORGEX 3D\\Library). Parts saved here in one project can be added to any other with add_from_library.",
    inputSchema: noArgs,
    annotations: readOnly,
    async run(_args, ctx) {
      const library = libraryOf(ctx);
      const entries = await library.list();
      if (entries.length === 0) return result(`My Parts is empty (${library.location()}). save_to_library adds an object.`);
      return result(
        `${entries.length} part${entries.length === 1 ? "" : "s"} in My Parts (${library.location()}):`,
        entries.map((entry) => ({ name: entry.name, file: entry.file, objects: entry.objectCount, ...entry.description ? { description: entry.description } : {} }))
      );
    }
  },
  {
    name: "save_to_library",
    title: "Save to My Parts",
    description: "Saves an object and everything inside it to My Parts, so it can be reused in any project. The saved copy stands at the origin; the object in this scene is not changed.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectRef(),
        name: { type: "string", description: "Part name (default: the object name)" },
        description: { type: "string", description: "A short note on what the part is for" },
        overwrite: { type: "boolean", description: "Replace a part with the same name (default false)" }
      },
      required: ["object"],
      additionalProperties: false
    },
    annotations: edit,
    async run(args, ctx) {
      const library = libraryOf(ctx);
      const object = resolveObject(sceneOf(ctx), args.object);
      const part = libraryPartFromScene(sceneOf(ctx), object.id, { name: optString(args, "name", 120), description: optString(args, "description", 500) });
      try {
        const file = await library.write(part, optBool(args, "overwrite") ?? false);
        return result(`Saved ${part.name} to My Parts as ${file} (${Object.keys(part.scene.objects).length} objects).`);
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error));
      }
    }
  },
  {
    name: "add_from_library",
    title: "Add from My Parts",
    description: "Adds a copy of a part from My Parts to the scene, with new ids. Without a position it is placed clear of the existing objects.",
    inputSchema: {
      type: "object",
      properties: {
        part: { type: "string", description: "Part name or file name from list_library" },
        position: vec3("Where to put it, in metres (default: beside the scene)"),
        parent: { type: ["string", "null"], description: "Optional parent object id or name" }
      },
      required: ["part"],
      additionalProperties: false
    },
    annotations: edit,
    async run(args, ctx) {
      const library = libraryOf(ctx);
      const ref = reqString(args, "part", 200);
      const entry = findLibraryEntry(await library.list(), ref);
      if (!entry) throw new ToolError(`My Parts has no part called "${ref}". Use list_library to see them.`);
      let part;
      try {
        part = await library.read(entry.file);
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error));
      }
      const scene = sceneOf(ctx);
      const objects = instantiateLibraryPart(part, createObjectId);
      const position = optVec3(args, "position");
      const parentId = parentFromArgs(scene, args);
      const root = objects[0];
      const [, y, z] = root.transform.position;
      objects[0] = {
        ...root,
        name: uniqueName(scene, part.name),
        transform: cleanTransform({ ...root.transform, position: position ?? [parentId ? 0 : clearSpotX(scene, objects), y, z] })
      };
      apply(ctx, new AddObjectsCommand(objects, parentId, void 0, `AI: add ${part.name} from My Parts`));
      return result(`Added ${objects[0].name} (${objects[0].id}) from My Parts${objects.length > 1 ? ` with ${objects.length - 1} children` : ""}.`, describe(objects[0]));
    }
  },
  {
    name: "undo",
    title: "Undo",
    description: "Undoes the most recent changes in FORGEX, whether the AI or the user made them.",
    inputSchema: { type: "object", properties: { steps: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    annotations: edit,
    run(args, ctx) {
      const steps = optInt(args, "steps", 1, 50) ?? 1;
      const undone = [];
      for (let i = 0; i < steps; i++) {
        const label = ctx.store.getState().history.undoLabel;
        if (!label || !ctx.store.undo()) break;
        undone.push(label);
      }
      return result(undone.length ? `Undid: ${undone.join("; ")}.` : "There was nothing to undo.");
    }
  },
  {
    name: "redo",
    title: "Redo",
    description: "Redoes changes that were undone.",
    inputSchema: { type: "object", properties: { steps: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    annotations: edit,
    run(args, ctx) {
      const steps = optInt(args, "steps", 1, 50) ?? 1;
      const redone = [];
      for (let i = 0; i < steps; i++) {
        const label = ctx.store.getState().history.redoLabel;
        if (!label || !ctx.store.redo()) break;
        redone.push(label);
      }
      return result(redone.length ? `Redid: ${redone.join("; ")}.` : "There was nothing to redo.");
    }
  },
  {
    name: "new_project",
    title: "New project",
    description: 'Starts a new project. In the app, the user is asked first if there are unsaved changes. A relative path (like "kart") goes in the FORGEX projects folder; the file is written when saved.',
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional .forgex path for the new project" },
        empty: { type: "boolean", description: "Start with an empty scene (default true); false starts with the default cube" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run(args, ctx) {
      return result(await ctx.host.newProject({ path: optString(args, "path", 1e3), empty: optBool(args, "empty") ?? true }));
    }
  },
  {
    name: "open_project",
    title: "Open project",
    description: "Opens a .forgex project. In the app, the user is asked first if there are unsaved changes. Relative paths use the FORGEX projects folder.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run(args, ctx) {
      return result(await ctx.host.openProject(reqString(args, "path", 1e3)));
    }
  },
  {
    name: "save_project",
    title: "Save project",
    description: "Saves the project as a .forgex file, to the given path or to where it was last saved. Relative paths use the FORGEX projects folder.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run(args, ctx) {
      return result(await ctx.host.saveProject(optString(args, "path", 1e3)));
    }
  },
  {
    name: "capture_viewport",
    title: "Capture viewport image",
    description: "Returns an image of the FORGEX 3D viewport so you can check your work. Needs the app to be open. view picks a camera angle (current keeps the user's view); frame fits all objects in view first.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: [...VIEW_PRESETS] },
        frame: { type: "boolean", description: "Fit all objects in view (default true unless view is current)" },
        width: { type: "integer", minimum: 256, maximum: 1600, description: "Image width in pixels (default 1024)" }
      },
      additionalProperties: false
    },
    annotations: readOnly,
    async run(args, ctx) {
      if (!ctx.host.captureViewport) {
        throw new ToolError("Viewport images need the FORGEX 3D app. Start it (npm run desktop or npm run dev) and it links to this server automatically.");
      }
      const view = optEnum(args, "view", VIEW_PRESETS) ?? "current";
      const frame = optBool(args, "frame") ?? view !== "current";
      const width = optInt(args, "width", 256, 1600) ?? 1024;
      const image = await ctx.host.captureViewport({ view, frame, width });
      return { text: `Viewport image (${view} view${frame ? ", framed" : ""}).`, image };
    }
  }
];
var TOOL_SPECS = TOOLS.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations
}));
var TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));
function hasTool(name) {
  return TOOL_MAP.has(name);
}
async function runTool(name, rawArgs, ctx) {
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  return tool.run(asArgs(rawArgs), ctx);
}
function isReadOnlyTool(name) {
  return TOOL_MAP.get(name)?.annotations?.readOnlyHint === true;
}

// mcp/server.ts
var SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
var LATEST_PROTOCOL_VERSION = "2025-11-25";
var DIALOG_TOOLS = /* @__PURE__ */ new Set(["new_project", "open_project", "save_project"]);
var PROJECT_TOOLS = /* @__PURE__ */ new Set(["new_project", "open_project", "save_project"]);
function ok(id, result2) {
  return { jsonrpc: "2.0", id: id ?? null, result: result2 };
}
function fail(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: data === void 0 ? { code, message } : { code, message, data } };
}
function toMcpResult(output) {
  const content = [{ type: "text", text: output.text }];
  if (output.image) content.push({ type: "image", data: output.image.data, mimeType: output.image.mimeType });
  return { content };
}
function toolFailure(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function negotiateVersion(requested) {
  if (typeof requested === "string") {
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
    if (/^\d{4}-\d{2}-\d{2}$/.test(requested) && requested > LATEST_PROTOCOL_VERSION) return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}
function createMcpHandler(options) {
  const { mode, bridge, fileHost } = options;
  const log2 = options.log ?? (() => void 0);
  const useApp = () => mode !== "file" && bridge !== null && bridge.connected;
  async function prepareForApp(name, args) {
    if (!PROJECT_TOOLS.has(name) || typeof args !== "object" || args === null) return args;
    const record = { ...args };
    if (typeof record.path === "string" && record.path.trim()) {
      record.path = fileHost.resolve(record.path);
      if (name !== "open_project") await (0, import_promises4.mkdir)((0, import_node_path5.dirname)(record.path), { recursive: true });
    }
    return record;
  }
  async function callTool(params) {
    const { name, arguments: args } = params ?? {};
    if (typeof name !== "string" || !hasTool(name)) throw new UnknownToolError(String(name));
    if (useApp()) {
      const forwarded = await prepareForApp(name, args ?? {});
      const timeout = DIALOG_TOOLS.has(name) ? 10 * 6e4 : name === "capture_viewport" ? 6e4 : 3e4;
      const reply = await bridge.call(name, forwarded, timeout);
      return reply.ok && reply.output ? toMcpResult(reply.output) : toolFailure(reply.error ?? "FORGEX 3D reported an unknown error.");
    }
    if (mode === "live") {
      return toolFailure("FORGEX 3D is not open. Start the app (npm run desktop) and it links to this server automatically.");
    }
    try {
      let output = await runTool(name, args ?? {}, { store: fileHost.store, host: fileHost });
      if (!isReadOnlyTool(name) && !PROJECT_TOOLS.has(name)) {
        const note = await fileHost.afterChange();
        if (note) output = { ...output, text: `${output.text}
${note}` };
      }
      return toMcpResult(output);
    } catch (error) {
      if (error instanceof ToolError) return toolFailure(error.message);
      log2(`Tool ${name} crashed: ${error.stack ?? String(error)}`);
      return toolFailure(`FORGEX could not run ${name}: ${error.message ?? String(error)}`);
    }
  }
  return async (message) => {
    if (typeof message !== "object" || message === null || message.jsonrpc !== "2.0") {
      return fail(null, -32600, "Invalid request: expected a JSON-RPC 2.0 message.");
    }
    const { id, method, params } = message;
    const isNotification = id === void 0;
    if (typeof method !== "string") return null;
    try {
      switch (method) {
        case "initialize": {
          const requested = params?.protocolVersion;
          return ok(id, {
            protocolVersion: negotiateVersion(requested),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "forgex-3d", title: APP_NAME, version: APP_VERSION },
            instructions: SERVER_INSTRUCTIONS
          });
        }
        case "ping":
          return isNotification ? null : ok(id, {});
        case "tools/list":
          return ok(id, { tools: TOOL_SPECS });
        case "tools/call":
          return ok(id, await callTool(params));
        default:
          if (method.startsWith("notifications/") || isNotification) return null;
          return fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      if (error instanceof UnknownToolError) return fail(id, -32602, `Unknown tool: ${error.toolName}`);
      log2(`Request ${method} failed: ${error.stack ?? String(error)}`);
      return isNotification ? null : fail(id, -32603, error.message ?? "Internal error");
    }
  };
}
var UnknownToolError = class extends Error {
  constructor(toolName) {
    super(`Unknown tool: ${toolName}`);
    this.toolName = toolName;
  }
};
function serveStdio(handler, input, output, onClose) {
  const write = (value) => output.write(`${JSON.stringify(value)}
`);
  const lines = (0, import_node_readline.createInterface)({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write(fail(null, -32700, "Parse error: each line must be one JSON message."));
      return;
    }
    if (Array.isArray(message)) {
      void Promise.all(message.map(handler)).then((replies) => {
        const sent = replies.filter((reply) => reply !== null);
        if (sent.length) write(sent);
      });
      return;
    }
    void handler(message).then((reply) => {
      if (reply) write(reply);
    });
  });
  lines.on("close", onClose);
}

// mcp/main.ts
var log = (message) => process.stderr.write(`[forgex-mcp] ${message}
`);
function readMode(value) {
  return value === "live" || value === "file" ? value : "auto";
}
async function main() {
  const mode = readMode(process.env.FORGEX_MCP_MODE?.trim().toLowerCase());
  const port = Number(process.env.FORGEX_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT;
  let bridge = null;
  if (mode !== "file") {
    const candidate = new AppBridge(log);
    if (await candidate.start(port)) {
      bridge = candidate;
      log(`Waiting for the FORGEX 3D app on 127.0.0.1:${port}.`);
    } else {
      log("Another FORGEX MCP server already has the app link; this one works on files only.");
    }
  }
  const appNote = () => mode === "file" ? "file mode was chosen with FORGEX_MCP_MODE" : bridge ? "the FORGEX 3D app is not open; start it and it links automatically" : `the app link is unavailable because port ${port} is in use by another FORGEX MCP server`;
  const fileHost = new FileHost(defaultProjectsFolder(), appNote);
  const handler = createMcpHandler({ mode, bridge, fileHost, log });
  serveStdio(handler, process.stdin, process.stdout, () => {
    bridge?.stop();
    process.exit(0);
  });
  log(`Ready (mode: ${mode}, projects folder: ${fileHost.projectsFolder}).`);
}
process.on("uncaughtException", (error) => log(`Unexpected error: ${error.stack ?? error.message}`));
process.on("unhandledRejection", (error) => log(`Unexpected rejection: ${String(error)}`));
void main();
