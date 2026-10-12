import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { BOARD_SNAP_SIZES, boardStore, isPenTool, type BoardTool } from '../app/boardState';
import { drawingOf, isDrawn, type ActiveDrawing, type DrawnObject } from '../app/drawing';
import { useActions, useEditor } from '../app/EditorContext';
import type { MeshSource } from '../core/scene/types';
import { bodyExtents, BODY_VIEWS, generateBody, type BodyView } from '../core/sketch/body';
import { findRegions, resolveSketch } from '../core/sketch/regions';
import {
  addLine,
  addPoint,
  addPolyline,
  AXIS_EPSILON,
  createSketch,
  linesBetween,
  mergePoints,
  pointDegree,
  polygonPoints,
  rectanglePoints,
  SKETCH_PLANES,
  splitLine,
  translatePoints,
  type Sketch,
  type SketchPlane,
} from '../core/sketch/sketch';
import { metersToStuds } from '../core/units';
import { Icon, type IconName } from '../ui/icons';
import { dotAt, fitView, metres, pathAt, snapPoint, toPlane, toScreen, zoomAt, type BoardBox, type BoardView } from './boardMath';
import { ReferencePanel } from './ReferencePanel';

type P = [number, number];

/** Where the pointer is on the board, after snapping. */
interface Hover {
  sx: number;
  sy: number;
  x: number;
  y: number;
  /** Existing dot under the pointer. */
  dot: string | null;
  /** Existing line under the pointer (when no dot is). */
  line: string | null;
  /** Smart guides: the x / y of a dot the pointer lined up with. */
  guideX: number | null;
  guideY: number | null;
}

type Gesture =
  | { kind: 'pan'; sx0: number; sy0: number; view0: BoardView; moved: boolean; button: number }
  | { kind: 'press'; sx0: number; sy0: number; click: Hover }
  | {
      kind: 'dots';
      objectId: string;
      view: BodyView | null;
      ids: string[];
      anchor: P;
      grab: P;
      before: MeshSource;
      base: Sketch;
      sx0: number;
      sy0: number;
      moved: boolean;
      click: Hover | null;
      current: Sketch | null;
      mergeInto: string | null;
    }
  | { kind: 'marquee'; sx0: number; sy0: number; additive: boolean }
  | { kind: 'rect'; x0: number; y0: number }
  | { kind: 'circle'; cx: number; cy: number }
  | { kind: 'reference'; id: string; px0: number; py0: number; x0: number; y0: number };

type Preview =
  | { kind: 'marquee'; x: number; y: number; width: number; height: number }
  | { kind: 'shape'; points: P[] };

const TOOLS: { tool: BoardTool; label: string; key: string; icon: IconName }[] = [
  { tool: 'draw', label: 'Draw corners: dots joined by straight lines', key: 'D', icon: 'pen' },
  { tool: 'curve', label: 'Draw curves: smooth dots, lines bend through them', key: 'C', icon: 'curvePen' },
  { tool: 'select', label: 'Pick and move dots', key: 'V', icon: 'select' },
  { tool: 'rectangle', label: 'Rectangle', key: 'B', icon: 'rectangle' },
  { tool: 'circle', label: 'Circle', key: 'O', icon: 'circle' },
];

const PLANE_INFO: Record<SketchPlane, { label: string; caption: string; title: string }> = {
  front: { label: 'Front', caption: 'Front view · X right · Y up', title: 'Draw what you see from the front. Thickness goes front to back.' },
  side: { label: 'Side', caption: 'Side view · front of the object on the left · Y up', title: 'Draw what you see from the right side. Thickness goes left to right.' },
  top: { label: 'Top', caption: 'Top view · X right · front of the object at the bottom', title: 'Draw a plan seen from above. Thickness grows upwards from the ground.' },
};

const VIEW_HELP: Record<BodyView, string> = {
  side: 'Side view: click round the silhouette seen from the side, front on the left. Notches in the bottom edge make wheel arches.',
  top: 'Top view: the outline seen from above, front at the bottom. With Symmetric on, draw the right half from the centre line round to the centre line.',
  front: 'Front view (optional): the shape of a slice through the body. With Symmetric on, draw the right half. Without it, slices are rounded boxes.',
};

const CLICK_SLOP = 4;
const GUIDE_PX = 7;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function pathOf(points: readonly (readonly [number, number])[], close: boolean): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Display label for a drawn object in the picker: "Supercar › Body". */
function labelOf(object: DrawnObject, objects: Readonly<Record<string, { name: string }>>): string {
  const parent = object.parentId ? objects[object.parentId] : undefined;
  return `${parent ? `${parent.name} › ` : ''}${object.name}`;
}

/**
 * The blueprint board: click to place dots, each joined to the last by a line. Closed
 * outlines fill in, and the selected blueprint or body updates live in the 3D view.
 */
export function SketchBoard() {
  const actions = useActions();
  const board = useSyncExternalStore(boardStore.subscribe, boardStore.getState);
  const selected = useEditor((s) => (s.selectedId ? s.scene.objects[s.selectedId] ?? null : null));
  const scene = useEditor((s) => s.scene);
  const references = useEditor((s) => s.references);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setViewState] = useState<BoardView>({ scale: 120, ox: 0, oy: 0 });
  const viewRef = useRef(view);
  const [hover, setHover] = useState<Hover | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const gestureRef = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const overBoardRef = useRef(false);
  // The drawing the board has adopted (fitted the view to, cleared picks for).
  const adoptedRef = useRef<string | null | undefined>(undefined);
  const needsFitRef = useRef(true);

  const drawing = useMemo(() => drawingOf(selected, board.bodyView), [selected, board.bodyView]);
  const sketch = drawing?.sketch ?? null;
  const object = drawing?.object ?? null;
  const isBody = object?.source.type === 'body';
  const plane: SketchPlane = drawing ? drawing.sketch.plane : board.newPlane;
  const revolveAxis = drawing?.revolveAxis ?? null;
  const showVerticalAxis = !!drawing && (drawing.mirror || revolveAxis === 'vertical');

  const setView = (next: BoardView) => {
    viewRef.current = next;
    setViewState(next);
  };

  const drawn = useMemo(() => Object.values(scene.objects).filter((o): o is DrawnObject => isDrawn(o)), [scene]);

  // -- Sizing, fitting and adopting the selected drawing --------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, []);

  const drawingKey = object ? `${object.id}:${drawing?.view ?? ''}` : null;
  useEffect(() => {
    if (adoptedRef.current === drawingKey) return;
    adoptedRef.current = drawingKey;
    needsFitRef.current = true;
    boardStore.set({ chainFrom: null, selectedPoints: [], selectedLines: [] });
  }, [drawingKey]);

  /** Where this view's visible reference pictures sit on the board, and where the body's other views reach. */
  const referenceBoxes = (): BoardBox[] => {
    const boxes: BoardBox[] = actions.store
      .getState()
      .references.filter((r) => r.plane === (drawing?.sketch.plane ?? board.newPlane) && r.visible)
      .map((r) => [r.x - r.width / 2, r.y - (r.width * r.aspect) / 2, r.x + r.width / 2, r.y + (r.width * r.aspect) / 2]);
    const xs = guides.filter((g) => g.axis === 'x').map((g) => g.value);
    const ys = guides.filter((g) => g.axis === 'y').map((g) => g.value);
    if (xs.length || ys.length) {
      const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      const spanY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      // An empty view still shows the room the other views have set out for it.
      boxes.push([
        xs.length ? Math.min(...xs) : -spanY * 0.25,
        ys.length ? Math.min(...ys) : 0,
        xs.length ? Math.max(...xs) : spanY * 0.25,
        ys.length ? Math.max(...ys) : spanX * 0.3,
      ]);
    }
    return boxes;
  };

  useEffect(() => {
    if (!needsFitRef.current || size.width === 0 || size.height === 0) return;
    needsFitRef.current = false;
    setView(fitView(sketch, size.width, size.height, !!drawing?.mirror, referenceBoxes()));
    // Only refit when a different drawing is adopted or the board first gets a size.
  }, [drawingKey, size.width, size.height]);

  const fit = () => {
    if (size.width && size.height) setView(fitView(sketch, size.width, size.height, !!drawing?.mirror, referenceBoxes()));
  };

  // A newly added picture is shown whole, so it can be traced edge to edge.
  const referenceCount = references.length;
  const lastReferenceCount = useRef(referenceCount);
  useEffect(() => {
    if (referenceCount > lastReferenceCount.current) fit();
    lastReferenceCount.current = referenceCount;
  }, [referenceCount]);

  // -- Wheel zoom and space-to-pan ---------------------------------------------------------

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      setView(zoomAt(viewRef.current, event.clientX - rect.left, event.clientY - rect.top, Math.exp(-step * 0.0015)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    // Space pans only while the pointer is over the board, so it never presses a focused button there.
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target) || !overBoardRef.current) return;
      event.preventDefault();
      if (event.repeat) return;
      spaceRef.current = true;
      setPanReady(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceRef.current) return;
      event.preventDefault();
      spaceRef.current = false;
      setPanReady(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // -- Resolved drawing: curves, mirror copies and filled areas ---------------------------------

  const resolved = useMemo(() => (sketch && drawing ? resolveSketch(sketch, drawing.mirror, drawing.curveSteps) : null), [sketch, drawing]);
  const linePaths = useMemo(() => {
    const map = new Map<string, P[]>();
    resolved?.paths.forEach((path) => {
      if (path.lineId) map.set(path.lineId, path.points);
    });
    return map;
  }, [resolved]);
  const linePathsRef = useRef(linePaths);
  linePathsRef.current = linePaths;

  const ghostPaths = useMemo(() => {
    if (!resolved) return [];
    if (revolveAxis === 'horizontal') return resolved.paths.map((path) => path.points.map(([x, y]) => [x, -y] as P));
    return resolved.paths.filter((path) => path.lineId === null).map((path) => path.points);
  }, [resolved, revolveAxis]);

  const regions = useMemo(() => {
    if (!sketch || !drawing || drawing.revolveAxis) return [];
    const forFill = drawing.fillMirror === drawing.mirror && resolved ? resolved : resolveSketch(sketch, drawing.fillMirror, drawing.curveSteps);
    return findRegions(forFill).map((region) => [region.outer, ...region.holes].map((loop) => loop.map((id) => forFill.points.get(id)!)));
  }, [sketch, drawing, resolved]);

  /** Lines showing where the body's other views reach, to keep the three views in proportion. */
  const guides = useMemo(() => {
    if (!object || object.source.type !== 'body' || !drawing?.view) return [];
    const extents = bodyExtents(object.source.views, object.source.body);
    const out: { axis: 'x' | 'y'; value: number; label: string }[] = [];
    const add = (axis: 'x' | 'y', range: [number, number] | undefined, label: string, map: (v: number) => number) => {
      if (!range) return;
      out.push({ axis, value: map(range[0]), label }, { axis, value: map(range[1]), label });
    };
    if (drawing.view === 'side') {
      add('x', extents.top?.z, 'Top view length', (z) => -z);
    } else if (drawing.view === 'top') {
      add('y', extents.side?.z, 'Side view length', (z) => -z);
    } else {
      add('x', extents.top?.x, 'Top view width', (x) => x);
      add('y', extents.side?.y, 'Side view height', (y) => y);
    }
    return out;
  }, [object, drawing]);

  const bodyStatus = useMemo(() => (object?.source.type === 'body' ? generateBody(object.source.views, object.source.body) : null), [object]);

  // -- Hit testing and snapping ----------------------------------------------------------------

  /** Finds what is under a board position and where a new dot would go. */
  const locate = (sx: number, sy: number, shift: boolean, skip?: ReadonlySet<string>): Hover => {
    const v = viewRef.current;
    const state = boardStore.getState();
    const active = actions.activeDrawing();
    const current = active?.sketch ?? null;
    const empty = { sx, sy, dot: null, line: null, guideX: null, guideY: null };

    if (current) {
      const dot = dotAt(v, current, sx, sy, 11, skip);
      if (dot) {
        const p = current.points[dot];
        return { ...empty, x: p.x, y: p.y, dot };
      }
      if (!skip && (isPenTool(state.tool) || state.tool === 'select')) {
        const hit = pathAt(v, linePathsRef.current, sx, sy);
        if (hit && current.lines[hit.lineId]) return { ...empty, x: hit.point[0], y: hit.point[1], line: hit.lineId };
      }
    }

    const [rx, ry] = toPlane(v, sx, sy);
    const chain = isPenTool(state.tool) && state.chainFrom && current?.points[state.chainFrom];
    const angleFrom: P | null = shift && chain ? [chain.x, chain.y] : null;
    let [x, y] = snapPoint(v, rx, ry, {
      gridSize: state.snapSize,
      snapToGrid: state.snap,
      snapToAxis: !!active && (active.mirror || active.revolveAxis === 'vertical'),
      angleFrom,
    });
    if (active?.revolveAxis === 'horizontal' && Math.abs(y) * v.scale < 10) y = 0;
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (current && !angleFrom) {
      let bestX = GUIDE_PX;
      let bestY = GUIDE_PX;
      for (const p of Object.values(current.points)) {
        if (skip?.has(p.id)) continue;
        const [px, py] = toScreen(v, p.x, p.y);
        if (Math.abs(px - sx) < bestX) {
          bestX = Math.abs(px - sx);
          guideX = p.x;
        }
        if (Math.abs(py - sy) < bestY) {
          bestY = Math.abs(py - sy);
          guideY = p.y;
        }
      }
      if (guideX !== null) x = guideX;
      if (guideY !== null) y = guideY;
    }
    return { ...empty, x, y, guideX, guideY };
  };

  const pointerPosition = (event: { clientX: number; clientY: number }): P => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  // -- Edits -------------------------------------------------------------------------------------

  /** Adopts a blueprint the board itself just created, so the view does not jump. */
  const adopt = (id: string) => {
    adoptedRef.current = `${id}:`;
    needsFitRef.current = false;
  };

  const commit = (active: ActiveDrawing, next: Sketch, label: string) => actions.editDrawing(active.object.id, active.view, next, label);

  const drawClick = (h: Hover) => {
    const state = boardStore.getState();
    const smooth = state.tool === 'curve';
    const active = actions.activeDrawing();
    if (!active) {
      const added = addPoint(createSketch(state.newPlane), h.x, h.y, smooth);
      const id = actions.createBlueprint(added.sketch);
      if (id) {
        adopt(id);
        boardStore.set({ chainFrom: added.pointId, selectedPoints: [], selectedLines: [] });
      }
      return;
    }
    const current = active.sketch;
    const from = state.chainFrom && current.points[state.chainFrom] ? state.chainFrom : null;

    if (h.dot) {
      if (!from) {
        boardStore.set({ chainFrom: h.dot });
        return;
      }
      if (from === h.dot) {
        boardStore.set({ chainFrom: null });
        return;
      }
      const joinsDrawing = pointDegree(current, h.dot) > 0;
      const joined = addLine(current, from, h.dot);
      if (joined.created) commit(active, joined.sketch, `Connect ${from} to ${h.dot}`);
      // Reaching a dot that is already part of the drawing closes the shape: stop there.
      boardStore.set({ chainFrom: joinsDrawing ? null : h.dot });
      return;
    }

    if (h.line) {
      const split = splitLine(current, h.line, h.x, h.y);
      const next = from ? addLine(split.sketch, from, split.pointId).sketch : split.sketch;
      commit(active, next, from ? 'Connect to a line' : 'Add a dot on a line');
      boardStore.set({ chainFrom: from ? null : split.pointId });
      return;
    }

    const added = addPoint(current, h.x, h.y, smooth);
    const next = from ? addLine(added.sketch, from, added.pointId).sketch : added.sketch;
    commit(active, next, from ? (smooth ? 'Draw a curve' : 'Draw a line') : 'Place a dot');
    boardStore.set({ chainFrom: added.pointId });
  };

  const addShape = (points: P[], label: string, smooth = false) => {
    const state = boardStore.getState();
    const active = actions.activeDrawing();
    if (!active) {
      const id = actions.createBlueprint(addPolyline(createSketch(state.newPlane), points, true, smooth).sketch, label);
      if (id) adopt(id);
      return;
    }
    commit(active, addPolyline(active.sketch, points, true, smooth).sketch, label);
  };

  // -- Pointer gestures ------------------------------------------------------------------------

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const [sx, sy] = pointerPosition(event);
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const state = boardStore.getState();
    if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceRef.current)) {
      gestureRef.current = { kind: 'pan', sx0: sx, sy0: sy, view0: viewRef.current, moved: false, button: event.button };
      return;
    }
    if (event.button !== 0) return;

    if (state.adjustingReference) {
      const reference = actions.store.getState().references.find((r) => r.id === state.adjustingReference);
      if (reference) {
        const [px, py] = toPlane(viewRef.current, sx, sy);
        gestureRef.current = { kind: 'reference', id: reference.id, px0: px, py0: py, x0: reference.x, y0: reference.y };
        return;
      }
    }

    const h = locate(sx, sy, event.shiftKey);
    const active = actions.activeDrawing();

    if (isPenTool(state.tool)) {
      gestureRef.current = h.dot && active ? dragDots(active, [h.dot], sx, sy, h) : { kind: 'press', sx0: sx, sy0: sy, click: h };
      return;
    }

    if (state.tool === 'select') {
      if (active && (h.dot || h.line)) {
        let points = [...state.selectedPoints];
        let lines = [...state.selectedLines];
        if (h.dot) {
          if (event.shiftKey) points = points.includes(h.dot) ? points.filter((id) => id !== h.dot) : [...points, h.dot];
          else if (!points.includes(h.dot)) [points, lines] = [[h.dot], []];
        } else if (h.line) {
          if (event.shiftKey) lines = lines.includes(h.line) ? lines.filter((id) => id !== h.line) : [...lines, h.line];
          else if (!lines.includes(h.line)) [points, lines] = [[], [h.line]];
        }
        boardStore.set({ selectedPoints: points, selectedLines: lines });
        const picked = h.dot ? points.includes(h.dot) : lines.includes(h.line!);
        if (picked) {
          const ids = new Set(points);
          for (const id of lines) {
            const line = active.sketch.lines[id];
            if (line) ids.add(line.a).add(line.b);
          }
          const anchorId = h.dot ?? active.sketch.lines[h.line!].a;
          gestureRef.current = dragDots(active, [...ids], sx, sy, null, anchorId);
        }
        return;
      }
      gestureRef.current = { kind: 'marquee', sx0: sx, sy0: sy, additive: event.shiftKey };
      return;
    }

    if (state.tool === 'rectangle') {
      gestureRef.current = { kind: 'rect', x0: h.x, y0: h.y };
      return;
    }
    gestureRef.current = { kind: 'circle', cx: h.x, cy: h.y };
  };

  function dragDots(active: ActiveDrawing, ids: string[], sx: number, sy: number, click: Hover | null, anchorId = ids[0]): Gesture {
    const anchorPoint = active.sketch.points[anchorId];
    const [rx, ry] = toPlane(viewRef.current, sx, sy);
    return {
      kind: 'dots',
      objectId: active.object.id,
      view: active.view,
      ids,
      anchor: [anchorPoint.x, anchorPoint.y],
      grab: [anchorPoint.x - rx, anchorPoint.y - ry],
      before: active.object.source,
      base: active.sketch,
      sx0: sx,
      sy0: sy,
      moved: false,
      click,
      current: null,
      mergeInto: null,
    };
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const [sx, sy] = pointerPosition(event);
    const gesture = gestureRef.current;
    if (!gesture) {
      setHover(locate(sx, sy, event.shiftKey));
      return;
    }
    const v = viewRef.current;
    switch (gesture.kind) {
      case 'pan': {
        if (!gesture.moved && Math.hypot(sx - gesture.sx0, sy - gesture.sy0) < CLICK_SLOP) return;
        if (!gesture.moved) setPanning(true);
        gesture.moved = true;
        setView({ ...gesture.view0, ox: gesture.view0.ox + sx - gesture.sx0, oy: gesture.view0.oy + sy - gesture.sy0 });
        return;
      }
      case 'press': {
        // Dragging empty board with a pen pans instead of placing a dot.
        if (Math.hypot(sx - gesture.sx0, sy - gesture.sy0) < CLICK_SLOP) return;
        gestureRef.current = { kind: 'pan', sx0: gesture.sx0, sy0: gesture.sy0, view0: v, moved: true, button: 0 };
        setPanning(true);
        setHover(null);
        setView({ ...v, ox: v.ox + sx - gesture.sx0, oy: v.oy + sy - gesture.sy0 });
        return;
      }
      case 'reference': {
        const [px, py] = toPlane(v, sx, sy);
        actions.updateReference(gesture.id, { x: gesture.x0 + px - gesture.px0, y: gesture.y0 + py - gesture.py0 });
        return;
      }
      case 'dots': {
        if (!gesture.moved && Math.hypot(sx - gesture.sx0, sy - gesture.sy0) < CLICK_SLOP) return;
        gesture.moved = true;
        const [rx, ry] = toPlane(v, sx, sy);
        const [tx, ty] = toScreen(v, rx + gesture.grab[0], ry + gesture.grab[1]);
        const target = locate(tx, ty, false, new Set(gesture.ids));
        const next = translatePoints(gesture.base, gesture.ids, target.x - gesture.anchor[0], target.y - gesture.anchor[1]);
        gesture.current = next;
        gesture.mergeInto = gesture.ids.length === 1 && target.dot ? target.dot : null;
        actions.previewDrawing(gesture.objectId, gesture.view, next, gesture.before);
        setHover({ ...target, sx: tx, sy: ty });
        return;
      }
      case 'marquee':
        setPreview({
          kind: 'marquee',
          x: Math.min(sx, gesture.sx0),
          y: Math.min(sy, gesture.sy0),
          width: Math.abs(sx - gesture.sx0),
          height: Math.abs(sy - gesture.sy0),
        });
        return;
      case 'rect': {
        const h = locate(sx, sy, false);
        let { x, y } = h;
        if (event.shiftKey) {
          const side = Math.max(Math.abs(x - gesture.x0), Math.abs(y - gesture.y0));
          x = gesture.x0 + Math.sign(x - gesture.x0 || 1) * side;
          y = gesture.y0 + Math.sign(y - gesture.y0 || 1) * side;
        }
        setHover({ ...h, x, y });
        setPreview({ kind: 'shape', points: rectanglePoints(gesture.x0, gesture.y0, x, y) });
        return;
      }
      case 'circle': {
        const h = locate(sx, sy, false);
        setHover(h);
        const radius = Math.hypot(h.x - gesture.cx, h.y - gesture.cy);
        setPreview(radius > 0 ? { kind: 'shape', points: polygonPoints(gesture.cx, gesture.cy, radius, boardStore.getState().circleSides) } : null);
        return;
      }
    }
  };

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPanning(false);
    setPreview(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (!gesture) return;
    const [sx, sy] = pointerPosition(event);
    if (cancelled) {
      if (gesture.kind === 'dots' && gesture.moved) actions.store.previewSource(gesture.objectId, gesture.before);
      return;
    }
    switch (gesture.kind) {
      case 'pan':
        // A right-click without dragging finishes the line chain.
        if (!gesture.moved && gesture.button === 2) boardStore.set({ chainFrom: null });
        break;
      case 'press':
        drawClick(gesture.click);
        break;
      case 'reference':
        break;
      case 'dots': {
        if (!gesture.moved) {
          if (gesture.click) drawClick(gesture.click);
          break;
        }
        let next = gesture.current;
        if (!next) break;
        let label = gesture.ids.length === 1 ? `Move dot ${gesture.ids[0]}` : `Move ${plural(gesture.ids.length, 'dot')}`;
        if (gesture.mergeInto) {
          next = mergePoints(next, gesture.ids[0], gesture.mergeInto);
          label = `Join ${gesture.ids[0]} to ${gesture.mergeInto}`;
          const state = boardStore.getState();
          if (state.chainFrom === gesture.ids[0]) boardStore.set({ chainFrom: gesture.mergeInto });
          if (state.selectedPoints.includes(gesture.ids[0])) boardStore.set({ selectedPoints: [gesture.mergeInto] });
        }
        actions.editDrawing(gesture.objectId, gesture.view, next, label, gesture.before);
        break;
      }
      case 'marquee': {
        const active = actions.activeDrawing();
        const state = boardStore.getState();
        const width = Math.abs(sx - gesture.sx0);
        const height = Math.abs(sy - gesture.sy0);
        if (!active || (width < CLICK_SLOP && height < CLICK_SLOP)) {
          if (!gesture.additive) boardStore.set({ selectedPoints: [], selectedLines: [] });
          break;
        }
        const left = Math.min(sx, gesture.sx0);
        const top = Math.min(sy, gesture.sy0);
        const inside = Object.values(active.sketch.points)
          .filter((p) => {
            const [px, py] = toScreen(viewRef.current, p.x, p.y);
            return px >= left && px <= left + width && py >= top && py <= top + height;
          })
          .map((p) => p.id);
        const points = gesture.additive ? [...new Set([...state.selectedPoints, ...inside])] : inside;
        const lines = linesBetween(active.sketch, new Set(points));
        boardStore.set({ selectedPoints: points, selectedLines: gesture.additive ? [...new Set([...state.selectedLines, ...lines])] : lines });
        break;
      }
      case 'rect': {
        const h = hover ?? locate(sx, sy, false);
        if (Math.abs(h.x - gesture.x0) > 1e-4 && Math.abs(h.y - gesture.y0) > 1e-4) {
          addShape(rectanglePoints(gesture.x0, gesture.y0, h.x, h.y), 'Draw a rectangle');
        }
        break;
      }
      case 'circle': {
        const h = locate(sx, sy, false);
        const radius = Math.hypot(h.x - gesture.cx, h.y - gesture.cy);
        if (radius > 1e-4) {
          const sides = boardStore.getState().circleSides;
          addShape(polygonPoints(gesture.cx, gesture.cy, radius, sides), `Draw a circle (${sides} sides)`);
        }
        break;
      }
    }
    setHover(locate(sx, sy, event.shiftKey));
  };

  // -- Derived drawing data ---------------------------------------------------------------------

  const { width, height } = size;
  const grid = useMemo(() => {
    if (!width || !height) return null;
    const [x0, y1] = toPlane(view, 0, 0);
    const [x1, y0] = toPlane(view, width, height);
    let minor = board.snapSize;
    while (minor * view.scale < 10) minor *= 2;
    let major = 1;
    while (major * view.scale < 56) major *= 5;
    while (major * view.scale > 400 && major > minor * 4) major /= 5;
    const lines = (step: number, skipMajor: boolean) => {
      let d = '';
      for (let i = Math.ceil(x0 / step); i * step <= x1; i++) {
        const x = i * step;
        if (skipMajor && Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
        d += `M${(view.ox + x * view.scale).toFixed(1)} 0V${height}`;
      }
      for (let i = Math.ceil(y0 / step); i * step <= y1; i++) {
        const y = i * step;
        if (skipMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
        d += `M0 ${(view.oy - y * view.scale).toFixed(1)}H${width}`;
      }
      return d;
    };
    const labelsX: { x: number; text: string }[] = [];
    for (let i = Math.ceil(x0 / major); i * major <= x1; i++) labelsX.push({ x: view.ox + i * major * view.scale, text: metres(i * major) });
    const labelsY: { y: number; text: string }[] = [];
    for (let i = Math.ceil(y0 / major); i * major <= y1; i++) labelsY.push({ y: view.oy - i * major * view.scale, text: metres(i * major) });
    return { minor: minor < major ? lines(minor, true) : '', major: lines(major, false), labelsX, labelsY };
  }, [view, width, height, board.snapSize]);

  const pen = isPenTool(board.tool);
  const chainPoint = pen && board.chainFrom && sketch ? sketch.points[board.chainFrom] ?? null : null;
  const selectedPoints = new Set(board.selectedPoints);
  const selectedLines = new Set(board.selectedLines);
  const showCursor = hover && !panning && !panReady && !board.adjustingReference && (board.tool !== 'select' || gestureRef.current?.kind === 'dots');
  const drawingLength = chainPoint && hover && pen ? Math.hypot(hover.x - chainPoint.x, hover.y - chainPoint.y) : null;
  const fill = object?.material.color ?? '#62cbff';
  const s = (x: number, y: number) => toScreen(view, x, y);
  const planeReferences = references.filter((r) => r.plane === plane && r.visible);
  const hasPicks = board.selectedPoints.length > 0 || board.selectedLines.length > 0;
  const emptyView = !!sketch && Object.keys(sketch.points).length === 0;

  const hint = (() => {
    if (board.adjustingReference) return 'Drag to move the picture. Set its width in the Pictures panel. Press Done when it lines up.';
    if (board.tool === 'rectangle') return 'Drag to draw a rectangle. Hold Shift for a square.';
    if (board.tool === 'circle') return `Drag from the centre to draw a circle with ${board.circleSides} sides.`;
    if (board.tool === 'select') return 'Click or drag a box to pick dots. Drag to move them. S makes them smooth or sharp. Delete removes. Shift adds to the pick.';
    if (!drawing) return 'Click anywhere to place the first dot of a new blueprint.';
    if (chainPoint) return 'Click to add the next dot. Click the first dot to close the shape. Esc, Enter or right-click stops. Backspace steps back.';
    if (isBody && drawing.view) return VIEW_HELP[drawing.view];
    if (revolveAxis === 'vertical') return 'Draw the right half of a profile: it spins around the orange axis.';
    if (revolveAxis === 'horizontal') return 'Draw the profile above the orange line: it spins around it, like a wheel on its axle.';
    return board.tool === 'curve'
      ? 'Curve pen: every dot is smooth, so lines bend through them. Click a dot to continue from it.'
      : 'Click to place a dot. Click a dot to continue from it, or a line to add a dot on it. Drag a dot to move it.';
  })();

  const counts = sketch ? `${plural(Object.keys(sketch.points).length, 'dot')} · ${plural(Object.keys(sketch.lines).length, 'line')}` : '';

  const pickerValue = object?.id ?? '';
  const onPick = (value: string) => {
    if (value === '__blueprint') actions.startNewBlueprint();
    else if (value === '__body') actions.createBody();
    else if (value) actions.select(value);
    else actions.startNewBlueprint();
  };

  return (
    <section className="board" aria-label="Blueprint board">
      <header className="board-header">
        <label className="board-picker" title="The drawing shown on the board">
          <Icon name={isBody ? 'car' : 'blueprint'} size={15} />
          <span className="visually-hidden">Drawing</span>
          <select value={pickerValue} onChange={(event) => onPick(event.target.value)}>
            {!object && <option value="">New blueprint</option>}
            <option value="__blueprint">+ New blueprint</option>
            <option value="__body">+ New body (side, top, front)</option>
            {drawn.length > 0 && <option disabled>──────────</option>}
            {drawn.map((item) => (
              <option key={item.id} value={item.id}>
                {labelOf(item, scene.objects)}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="radiogroup" aria-label={isBody ? 'Body view' : 'Drawing plane'}>
          {isBody && object?.source.type === 'body'
            ? BODY_VIEWS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={board.bodyView === item}
                  className={board.bodyView === item ? 'is-active' : ''}
                  title={VIEW_HELP[item]}
                  onClick={() => boardStore.set({ bodyView: item })}
                >
                  <span className={`view-dot ${bodyStatus?.closed[item] ? 'is-done' : ''}`} aria-hidden="true" />
                  {PLANE_INFO[item].label}
                </button>
              ))
            : SKETCH_PLANES.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={plane === item}
                  className={plane === item ? 'is-active' : ''}
                  title={PLANE_INFO[item].title}
                  onClick={() => (object ? actions.setBlueprintPlane(object.id, item) : boardStore.set({ newPlane: item }))}
                >
                  {PLANE_INFO[item].label}
                </button>
              ))}
        </div>
        <span className="board-spacer" />
        <button
          type="button"
          className={`text-button is-quiet ${board.referencesOpen ? 'is-on' : ''}`}
          onClick={() => boardStore.set({ referencesOpen: !board.referencesOpen, adjustingReference: null })}
          aria-pressed={board.referencesOpen}
          title="Pictures to trace over, such as car blueprints"
        >
          <Icon name="image" size={14} />
          Pictures
          {references.filter((r) => r.plane === plane).length > 0 && <span className="badge">{references.filter((r) => r.plane === plane).length}</span>}
        </button>
        <div className="snap-control" title="Snap dots to the board grid">
          <button
            type="button"
            className={`icon-button ${board.snap ? 'is-active' : ''}`}
            aria-pressed={board.snap}
            onClick={() => boardStore.set({ snap: !board.snap })}
            title={board.snap ? 'Snapping on' : 'Snapping off'}
          >
            <Icon name="magnet" />
          </button>
          <label className="compact-select">
            <span className="visually-hidden">Board grid</span>
            <select value={board.snapSize} onChange={(event) => boardStore.set({ snapSize: Number(event.target.value) })}>
              {BOARD_SNAP_SIZES.map((option) => (
                <option key={option.size} value={option.size}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="icon-button" onClick={fit} title="Fit the drawing">
          <Icon name="fit" />
        </button>
      </header>

      <div className="board-body">
        <div className="tool-rail" role="toolbar" aria-orientation="vertical" aria-label="Board tools">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              className={`rail-button ${board.tool === item.tool ? 'is-active' : ''}`}
              aria-pressed={board.tool === item.tool}
              onClick={() => boardStore.setTool(item.tool)}
              title={`${item.label} (${item.key})`}
            >
              <Icon name={item.icon} size={18} />
            </button>
          ))}
          <span className="rail-separator" />
          <button type="button" className="rail-button" onClick={() => actions.toggleSmoothPicked()} disabled={!hasPicks} title="Make picked dots smooth or sharp (S)">
            <Icon name="smooth" size={18} />
          </button>
          <button
            type="button"
            className={`rail-button ${drawing?.mirror && !revolveAxis ? 'is-active' : ''}`}
            aria-pressed={!!drawing?.mirror}
            onClick={actions.toggleMirror}
            disabled={!drawing || (isBody && drawing.view === 'side')}
            title={isBody ? 'Symmetric: draw the right half of the top and front views (M)' : 'Mirror: draw one half, get both (M)'}
          >
            <Icon name="mirror" size={18} />
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => actions.deleteBoardSelection()}
            disabled={!hasPicks}
            title="Delete picked dots and lines (Delete)"
          >
            <Icon name="trash" size={18} />
          </button>
          <span className="rail-separator" />
          <button type="button" className="rail-button" onClick={() => actions.startNewBlueprint()} title="New blueprint">
            <Icon name="plus" size={18} />
          </button>
          <button type="button" className="rail-button" onClick={actions.createBody} title="New body from side, top and front views (car bodies, hulls)">
            <Icon name="car" size={18} />
          </button>
        </div>

        <div
          ref={hostRef}
          className={`board-canvas tool-${board.tool} ${panning ? 'is-panning' : ''} ${panReady ? 'is-pan-ready' : ''} ${board.adjustingReference ? 'is-adjusting' : ''}`}
        >
          <svg
            ref={svgRef}
            className="board-svg"
            width={width}
            height={height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishGesture(event, false)}
            onPointerCancel={(event) => finishGesture(event, true)}
            onPointerEnter={() => {
              overBoardRef.current = true;
            }}
            onPointerLeave={() => {
              overBoardRef.current = false;
              if (!gestureRef.current) setHover(null);
            }}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={() => boardStore.set({ chainFrom: null })}
          >
            {planeReferences.map((reference) => {
              const h = reference.width * reference.aspect;
              const [left, top] = s(reference.x - reference.width / 2, reference.y + h / 2);
              const w = reference.width * view.scale;
              const hh = h * view.scale;
              return (
                <image
                  key={reference.id}
                  className={`board-reference ${board.adjustingReference === reference.id ? 'is-adjusting' : ''}`}
                  href={reference.src}
                  x={left}
                  y={top}
                  width={w}
                  height={hh}
                  opacity={reference.opacity}
                  preserveAspectRatio="none"
                  transform={reference.flip ? `translate(${2 * left + w} 0) scale(-1 1)` : undefined}
                />
              );
            })}
            {grid && (
              <g className="board-grid">
                <path className="grid-minor" d={grid.minor} />
                <path className="grid-major" d={grid.major} />
              </g>
            )}
            {width > 0 && (
              <g className="board-axes">
                <line className={`axis-ground ${revolveAxis === 'horizontal' ? 'is-revolve' : ''}`} x1={0} x2={width} y1={view.oy} y2={view.oy} />
                <line
                  className={`axis-vertical ${revolveAxis === 'vertical' ? 'is-revolve' : showVerticalAxis ? 'is-mirror' : ''}`}
                  x1={view.ox}
                  x2={view.ox}
                  y1={0}
                  y2={height}
                />
              </g>
            )}
            {grid && (
              <g className="board-rulers" aria-hidden="true">
                {grid.labelsX.map((label) => (
                  <text key={`x${label.text}`} x={label.x + 3} y={height - 6}>
                    {label.text}
                  </text>
                ))}
                {grid.labelsY.map((label) => (
                  <text key={`y${label.text}`} x={4} y={label.y - 4}>
                    {label.text}
                  </text>
                ))}
              </g>
            )}

            {guides.map((guide, i) =>
              guide.axis === 'x' ? (
                <g key={i} className="board-view-guide">
                  <line x1={s(guide.value, 0)[0]} x2={s(guide.value, 0)[0]} y1={0} y2={height} />
                  {i % 2 === 0 && (
                    <text x={s(guide.value, 0)[0] + 4} y={height - 22}>
                      {guide.label}
                    </text>
                  )}
                </g>
              ) : (
                <g key={i} className="board-view-guide">
                  <line y1={s(0, guide.value)[1]} y2={s(0, guide.value)[1]} x1={0} x2={width} />
                  {i % 2 === 0 && (
                    <text x={width - 8} y={s(0, guide.value)[1] - 4} textAnchor="end">
                      {guide.label}
                    </text>
                  )}
                </g>
              ),
            )}

            {regions.map((loops, i) => (
              <path
                key={i}
                className="board-region"
                fillRule="evenodd"
                style={{ fill }}
                d={loops.map((loop) => pathOf(loop.map(([x, y]) => s(x, y)), true)).join(' ')}
              />
            ))}

            {ghostPaths.map((points, i) => (
              <path key={i} className="board-ghost" d={pathOf(points.map(([x, y]) => s(x, y)), false)} />
            ))}

            {sketch &&
              Object.values(sketch.lines).map((line) => {
                const points = linePaths.get(line.id);
                if (!points) return null;
                const classes = ['board-line', selectedLines.has(line.id) ? 'is-selected' : '', hover?.line === line.id ? 'is-hover' : ''];
                return <path key={line.id} className={classes.join(' ')} d={pathOf(points.map(([x, y]) => s(x, y)), false)} />;
              })}

            {preview?.kind === 'shape' && <path className="board-preview" d={pathOf(preview.points.map(([x, y]) => s(x, y)), true)} />}

            {chainPoint && hover && showCursor && (
              <line
                className="board-rubber"
                x1={s(chainPoint.x, chainPoint.y)[0]}
                y1={s(chainPoint.x, chainPoint.y)[1]}
                x2={s(hover.x, hover.y)[0]}
                y2={s(hover.x, hover.y)[1]}
              />
            )}

            {hover && showCursor && hover.guideX !== null && (
              <line className="board-guide" x1={s(hover.guideX, 0)[0]} x2={s(hover.guideX, 0)[0]} y1={0} y2={height} />
            )}
            {hover && showCursor && hover.guideY !== null && (
              <line className="board-guide" y1={s(0, hover.guideY)[1]} y2={s(0, hover.guideY)[1]} x1={0} x2={width} />
            )}

            {sketch &&
              Object.values(sketch.points).map((p) => {
                const [cx, cy] = s(p.x, p.y);
                const r = hover?.dot === p.id ? 6 : 4.5;
                const classes = [
                  'board-dot',
                  p.smooth ? 'is-smooth' : '',
                  selectedPoints.has(p.id) ? 'is-selected' : '',
                  board.chainFrom === p.id && pen ? 'is-chain' : '',
                  hover?.dot === p.id ? 'is-hover' : '',
                  showVerticalAxis && Math.abs(p.x) <= AXIS_EPSILON ? 'is-on-axis' : '',
                ].join(' ');
                // Sharp dots are squares, smooth dots are circles, as in vector drawing apps.
                return p.smooth ? (
                  <circle key={p.id} className={classes} cx={cx} cy={cy} r={r} />
                ) : (
                  <rect key={p.id} className={classes} x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1.5} />
                );
              })}

            {hover && showCursor && !hover.dot && (
              <g className="board-cursor" transform={`translate(${s(hover.x, hover.y)[0]} ${s(hover.x, hover.y)[1]})`}>
                {board.tool === 'curve' ? <circle r={4} /> : <rect x={-3.5} y={-3.5} width={7} height={7} />}
                <path d="M-11 0h-4 M11 0h4 M0 -11v-4 M0 11v4" />
              </g>
            )}

            {drawingLength !== null && hover && showCursor && drawingLength > 0 && (
              <text className="board-length" x={s(hover.x, hover.y)[0] + 14} y={s(hover.x, hover.y)[1] - 12}>
                {metres(drawingLength)} m
              </text>
            )}

            {preview?.kind === 'marquee' && (
              <rect className="board-marquee" x={preview.x} y={preview.y} width={preview.width} height={preview.height} />
            )}
          </svg>

          <div className="board-caption">
            {isBody && drawing?.view ? `${object?.name} · ` : ''}
            {PLANE_INFO[plane].caption}
          </div>

          {board.tool === 'circle' && (
            <label className="board-option">
              Sides
              <input
                type="number"
                min={3}
                max={96}
                value={board.circleSides}
                onChange={(event) => {
                  const value = Math.round(Number(event.target.value));
                  if (value >= 3 && value <= 96) boardStore.set({ circleSides: value });
                }}
              />
            </label>
          )}

          {board.referencesOpen && <ReferencePanel plane={plane} />}

          {!drawing && (
            <div className="board-empty">
              <Icon name="blueprint" size={34} />
              <p className="board-empty-title">Click to place your first dot</p>
              <p>Keep clicking to join dots with lines. Close the outline and it turns into a 3D object on the right.</p>
              <p>For a car body, use the car button on the left: draw it from the side, the top and the front.</p>
            </div>
          )}
          {drawing && isBody && emptyView && drawing.view && (
            <div className="board-empty is-soft">
              <Icon name="car" size={30} />
              <p className="board-empty-title">Draw the {drawing.view} view</p>
              <p>{VIEW_HELP[drawing.view]}</p>
            </div>
          )}
        </div>
      </div>

      <footer className="board-footer">
        <span className="board-coords">{hover ? `x ${metres(hover.x)}  y ${metres(hover.y)} m` : counts}</span>
        {drawingLength !== null && drawingLength > 0 && (
          <span className="board-measure">
            Line {metres(drawingLength)} m · {metres(Math.round(metersToStuds(drawingLength) * 10) / 10)} studs
          </span>
        )}
        <span className="board-hint">{hint}</span>
      </footer>
    </section>
  );
}
