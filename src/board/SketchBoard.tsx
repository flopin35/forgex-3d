import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { BOARD_SNAP_SIZES, boardStore, type BoardTool } from '../app/boardState';
import { useActions, useEditor } from '../app/EditorContext';
import type { EditorState } from '../core/editor/editorStore';
import { isSketchMesh, type MeshObject, type MeshSource } from '../core/scene/types';
import { findRegions, resolveSketch } from '../core/sketch/regions';
import {
  addLine,
  addPoint,
  addPolyline,
  AXIS_EPSILON,
  closestOnLine,
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
import { dotAt, fitView, lineAt, metres, snapPoint, toPlane, toScreen, zoomAt, type BoardView } from './boardMath';

type Blueprint = MeshObject & { source: Extract<MeshSource, { type: 'sketch' }> };

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
      ids: string[];
      anchor: [number, number];
      grab: [number, number];
      before: MeshSource;
      sx0: number;
      sy0: number;
      moved: boolean;
      click: Hover | null;
      current: Sketch | null;
      mergeInto: string | null;
    }
  | { kind: 'marquee'; sx0: number; sy0: number; additive: boolean }
  | { kind: 'rect'; x0: number; y0: number }
  | { kind: 'circle'; cx: number; cy: number };

type Preview =
  | { kind: 'marquee'; x: number; y: number; width: number; height: number }
  | { kind: 'shape'; points: [number, number][] };

const TOOLS: { tool: BoardTool; label: string; key: string; icon: IconName }[] = [
  { tool: 'draw', label: 'Draw dots and lines', key: 'D', icon: 'pen' },
  { tool: 'select', label: 'Pick and move dots', key: 'V', icon: 'select' },
  { tool: 'rectangle', label: 'Rectangle', key: 'B', icon: 'rectangle' },
  { tool: 'circle', label: 'Circle', key: 'O', icon: 'circle' },
];

const PLANE_INFO: Record<SketchPlane, { label: string; caption: string; title: string }> = {
  front: { label: 'Front', caption: 'Front view · X right · Y up', title: 'Draw what you see from the front. Thickness goes front to back.' },
  side: { label: 'Side', caption: 'Right side view · back is right · Y up', title: 'Draw what you see from the right side. Thickness goes left to right.' },
  top: { label: 'Top', caption: 'Top view · X right · back is up', title: 'Draw a plan seen from above. Thickness grows upwards from the ground.' },
};

const CLICK_SLOP = 4;
const GUIDE_PX = 7;

function selectBlueprint(state: EditorState): Blueprint | null {
  const object = state.selectedId ? state.scene.objects[state.selectedId] : undefined;
  return isSketchMesh(object) ? object : null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function pathOf(points: readonly [number, number][], close: boolean): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The blueprint board: click to place dots, each joined to the last by a line. Closed
 * outlines fill in, and the selected blueprint updates live in the 3D view.
 */
export function SketchBoard() {
  const actions = useActions();
  const board = useSyncExternalStore(boardStore.subscribe, boardStore.getState);
  const blueprint = useEditor(selectBlueprint);
  const scene = useEditor((s) => s.scene);
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
  // The blueprint the board has adopted (fitted the view to, cleared picks for).
  const adoptedRef = useRef<string | null | undefined>(undefined);
  const needsFitRef = useRef(true);

  const sketch = blueprint?.source.sketch ?? null;
  const shape = blueprint?.source.shape ?? null;
  const plane = sketch?.plane ?? board.newPlane;
  const revolve = shape?.mode === 'revolve';
  const showAxis = !!shape && (shape.mirror || revolve);

  const setView = (next: BoardView) => {
    viewRef.current = next;
    setViewState(next);
  };

  const blueprints = useMemo(
    () => Object.values(scene.objects).filter((object): object is Blueprint => isSketchMesh(object)),
    [scene],
  );

  // -- Sizing, fitting and adopting the selected blueprint ------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  }, []);

  const blueprintId = blueprint?.id ?? null;
  useEffect(() => {
    if (adoptedRef.current === blueprintId) return;
    adoptedRef.current = blueprintId;
    needsFitRef.current = true;
    boardStore.set({ chainFrom: null, selectedPoints: [], selectedLines: [] });
  }, [blueprintId]);

  useEffect(() => {
    if (!needsFitRef.current || size.width === 0 || size.height === 0) return;
    needsFitRef.current = false;
    // Only refit when a different blueprint is adopted or the board first gets a size.
    setView(fitView(sketch, size.width, size.height, showAxis));
  }, [blueprintId, size.width, size.height]);

  const fit = () => {
    if (size.width && size.height) setView(fitView(sketch, size.width, size.height, showAxis));
  };

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

  // -- Hit testing and snapping ----------------------------------------------------------------

  /** Finds what is under a board position and where a new dot would go. */
  const locate = (sx: number, sy: number, shift: boolean, skip?: ReadonlySet<string>): Hover => {
    const v = viewRef.current;
    const state = boardStore.getState();
    const active = actions.activeBlueprint();
    const current = active?.source.sketch ?? null;
    const axisSnap = !!active && (active.source.shape.mirror || active.source.shape.mode === 'revolve');
    const empty = { sx, sy, dot: null, line: null, guideX: null, guideY: null };

    if (current) {
      const dot = dotAt(v, current, sx, sy, 11, skip);
      if (dot) {
        const p = current.points[dot];
        return { ...empty, x: p.x, y: p.y, dot };
      }
      if (!skip && (state.tool === 'draw' || state.tool === 'select')) {
        const line = lineAt(v, current, sx, sy);
        if (line) {
          const [rx, ry] = toPlane(v, sx, sy);
          const [x, y] = closestOnLine(current, line, rx, ry);
          return { ...empty, x, y, line };
        }
      }
    }

    const [rx, ry] = toPlane(v, sx, sy);
    const chain = state.tool === 'draw' && state.chainFrom && current?.points[state.chainFrom];
    const angleFrom: [number, number] | null = shift && chain ? [chain.x, chain.y] : null;
    let [x, y] = snapPoint(v, rx, ry, { gridSize: state.snapSize, snapToGrid: state.snap, snapToAxis: axisSnap, angleFrom });
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

  const pointerPosition = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  // -- Edits -------------------------------------------------------------------------------------

  /** Adopts a blueprint the board itself just created, so the view does not jump. */
  const adopt = (id: string) => {
    adoptedRef.current = id;
    needsFitRef.current = false;
  };

  const drawClick = (h: Hover) => {
    const state = boardStore.getState();
    const active = actions.activeBlueprint();
    if (!active) {
      const added = addPoint(createSketch(state.newPlane), h.x, h.y);
      const id = actions.createBlueprint(added.sketch);
      if (id) {
        adopt(id);
        boardStore.set({ chainFrom: added.pointId, selectedPoints: [], selectedLines: [] });
      }
      return;
    }
    const current = active.source.sketch;
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
      if (joined.created) actions.editBlueprint(active.id, joined.sketch, `Connect ${from} to ${h.dot}`);
      // Reaching a dot that is already part of the drawing closes the shape: stop there.
      boardStore.set({ chainFrom: joinsDrawing ? null : h.dot });
      return;
    }

    if (h.line) {
      const split = splitLine(current, h.line, h.x, h.y);
      const next = from ? addLine(split.sketch, from, split.pointId).sketch : split.sketch;
      actions.editBlueprint(active.id, next, from ? 'Connect to a line' : 'Add a dot on a line');
      boardStore.set({ chainFrom: from ? null : split.pointId });
      return;
    }

    const added = addPoint(current, h.x, h.y);
    const next = from ? addLine(added.sketch, from, added.pointId).sketch : added.sketch;
    actions.editBlueprint(active.id, next, from ? 'Draw a line' : 'Place a dot');
    boardStore.set({ chainFrom: added.pointId });
  };

  const addShape = (points: [number, number][], label: string) => {
    const state = boardStore.getState();
    const active = actions.activeBlueprint();
    if (!active) {
      const id = actions.createBlueprint(addPolyline(createSketch(state.newPlane), points, true).sketch, label);
      if (id) adopt(id);
      return;
    }
    actions.editBlueprint(active.id, addPolyline(active.source.sketch, points, true).sketch, label);
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
    const h = locate(sx, sy, event.shiftKey);
    const active = actions.activeBlueprint();

    if (state.tool === 'draw') {
      gestureRef.current =
        h.dot && active
          ? dragDots(active, [h.dot], sx, sy, h)
          : { kind: 'press', sx0: sx, sy0: sy, click: h };
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
            const line = active.source.sketch.lines[id];
            if (line) ids.add(line.a).add(line.b);
          }
          const anchorId = h.dot ?? active.source.sketch.lines[h.line!].a;
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

  function dragDots(
    active: Blueprint,
    ids: string[],
    sx: number,
    sy: number,
    click: Hover | null,
    anchorId = ids[0],
  ): Gesture {
    const anchorPoint = active.source.sketch.points[anchorId];
    const [rx, ry] = toPlane(viewRef.current, sx, sy);
    return {
      kind: 'dots',
      objectId: active.id,
      ids,
      anchor: [anchorPoint.x, anchorPoint.y],
      grab: [anchorPoint.x - rx, anchorPoint.y - ry],
      before: active.source,
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
        // Dragging empty board with the draw tool pans instead of placing a dot.
        if (Math.hypot(sx - gesture.sx0, sy - gesture.sy0) < CLICK_SLOP) return;
        gestureRef.current = { kind: 'pan', sx0: gesture.sx0, sy0: gesture.sy0, view0: v, moved: true, button: 0 };
        setPanning(true);
        setHover(null);
        setView({ ...v, ox: v.ox + sx - gesture.sx0, oy: v.oy + sy - gesture.sy0 });
        return;
      }
      case 'dots': {
        if (!gesture.moved && Math.hypot(sx - gesture.sx0, sy - gesture.sy0) < CLICK_SLOP) return;
        gesture.moved = true;
        if (gesture.before.type !== 'sketch') return;
        const [rx, ry] = toPlane(v, sx, sy);
        const [tx, ty] = toScreen(v, rx + gesture.grab[0], ry + gesture.grab[1]);
        const target = locate(tx, ty, false, new Set(gesture.ids));
        const next = translatePoints(gesture.before.sketch, gesture.ids, target.x - gesture.anchor[0], target.y - gesture.anchor[1]);
        gesture.current = next;
        gesture.mergeInto = gesture.ids.length === 1 && target.dot ? target.dot : null;
        actions.store.previewSource(gesture.objectId, { ...gesture.before, sketch: next });
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
        actions.editBlueprint(gesture.objectId, next, label, gesture.before);
        break;
      }
      case 'marquee': {
        const active = actions.activeBlueprint();
        const state = boardStore.getState();
        const width = Math.abs(sx - gesture.sx0);
        const height = Math.abs(sy - gesture.sy0);
        if (!active || (width < CLICK_SLOP && height < CLICK_SLOP)) {
          if (!gesture.additive) boardStore.set({ selectedPoints: [], selectedLines: [] });
          break;
        }
        const left = Math.min(sx, gesture.sx0);
        const top = Math.min(sy, gesture.sy0);
        const inside = Object.values(active.source.sketch.points)
          .filter((p) => {
            const [px, py] = toScreen(viewRef.current, p.x, p.y);
            return px >= left && px <= left + width && py >= top && py <= top + height;
          })
          .map((p) => p.id);
        const points = gesture.additive ? [...new Set([...state.selectedPoints, ...inside])] : inside;
        const lines = linesBetween(active.source.sketch, new Set(points));
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

  const regions = useMemo(() => {
    if (!sketch || !shape || shape.mode === 'revolve') return [];
    const resolved = resolveSketch(sketch, shape.mirror);
    return findRegions(resolved).map((region) =>
      [region.outer, ...region.holes].map((loop) => loop.map((id) => resolved.points.get(id)!)),
    );
  }, [sketch, shape]);

  const ghostSegments = useMemo(() => {
    if (!sketch || !showAxis) return [];
    const resolved = resolveSketch(sketch, true);
    return resolved.segments
      .filter(([a, b]) => a.endsWith('~m') || b.endsWith('~m'))
      .map(([a, b]) => [resolved.points.get(a)!, resolved.points.get(b)!] as const);
  }, [sketch, showAxis]);

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
        const sx = view.ox + x * view.scale;
        d += `M${sx.toFixed(1)} 0V${height}`;
      }
      for (let i = Math.ceil(y0 / step); i * step <= y1; i++) {
        const y = i * step;
        if (skipMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
        const sy = view.oy - y * view.scale;
        d += `M0 ${sy.toFixed(1)}H${width}`;
      }
      return d;
    };
    const labelsX: { x: number; text: string }[] = [];
    for (let i = Math.ceil(x0 / major); i * major <= x1; i++) labelsX.push({ x: view.ox + i * major * view.scale, text: metres(i * major) });
    const labelsY: { y: number; text: string }[] = [];
    for (let i = Math.ceil(y0 / major); i * major <= y1; i++) labelsY.push({ y: view.oy - i * major * view.scale, text: metres(i * major) });
    return { minor: minor < major ? lines(minor, true) : '', major: lines(major, false), labelsX, labelsY };
  }, [view, width, height, board.snapSize]);

  const chainPoint = board.tool === 'draw' && board.chainFrom && sketch ? sketch.points[board.chainFrom] ?? null : null;
  const selectedPoints = new Set(board.selectedPoints);
  const selectedLines = new Set(board.selectedLines);
  const showCursor = hover && !panning && !panReady && (board.tool !== 'select' || gestureRef.current?.kind === 'dots');
  const drawingLength = chainPoint && hover && board.tool === 'draw' ? Math.hypot(hover.x - chainPoint.x, hover.y - chainPoint.y) : null;
  const fill = blueprint?.material.color ?? '#62cbff';
  const s = (x: number, y: number) => toScreen(view, x, y);

  const hint = (() => {
    if (board.tool === 'rectangle') return 'Drag to draw a rectangle. Hold Shift for a square.';
    if (board.tool === 'circle') return `Drag from the centre to draw a circle with ${board.circleSides} sides.`;
    if (board.tool === 'select') return 'Click or drag a box to pick dots. Drag to move them. Delete removes. Shift adds to the pick.';
    if (!blueprint) return 'Click anywhere to place the first dot of a new blueprint.';
    if (chainPoint) return 'Click to add the next dot. Click the first dot to close the shape. Esc, Enter or right-click stops.';
    if (revolve) return 'Draw the right half of a profile: it spins around the orange axis. Click a dot to continue from it.';
    return 'Click to place a dot. Click a dot to continue from it, or a line to add a dot on it. Drag a dot to move it.';
  })();

  const counts = sketch ? `${plural(Object.keys(sketch.points).length, 'dot')} · ${plural(Object.keys(sketch.lines).length, 'line')}` : '';

  return (
    <section className="board" aria-label="Blueprint board">
      <header className="board-header">
        <label className="board-picker" title="Blueprint shown on the board">
          <Icon name="blueprint" size={15} />
          <span className="visually-hidden">Blueprint</span>
          <select
            value={blueprint?.id ?? ''}
            onChange={(event) => (event.target.value ? actions.select(event.target.value) : actions.startNewBlueprint())}
          >
            <option value="">{blueprint ? '+ New blueprint' : 'New blueprint'}</option>
            {blueprints.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="radiogroup" aria-label="Drawing plane">
          {SKETCH_PLANES.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={plane === item}
              className={plane === item ? 'is-active' : ''}
              title={PLANE_INFO[item].title}
              onClick={() => (blueprint ? actions.setBlueprintPlane(blueprint.id, item) : boardStore.set({ newPlane: item }))}
            >
              {PLANE_INFO[item].label}
            </button>
          ))}
        </div>
        <span className="board-spacer" />
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
          <button
            type="button"
            className={`rail-button ${shape?.mirror ? 'is-active' : ''}`}
            aria-pressed={!!shape?.mirror}
            onClick={actions.toggleMirror}
            disabled={!blueprint}
            title="Mirror: draw one half, get both (M)"
          >
            <Icon name="mirror" size={18} />
          </button>
          <button type="button" className="rail-button" onClick={() => actions.startNewBlueprint()} title="New blueprint">
            <Icon name="plus" size={18} />
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => actions.deleteBoardSelection()}
            disabled={board.selectedPoints.length === 0 && board.selectedLines.length === 0}
            title="Delete picked dots and lines (Delete)"
          >
            <Icon name="trash" size={18} />
          </button>
        </div>

        <div
          ref={hostRef}
          className={`board-canvas tool-${board.tool} ${panning ? 'is-panning' : ''} ${panReady ? 'is-pan-ready' : ''}`}
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
            {grid && (
              <g className="board-grid">
                <path className="grid-minor" d={grid.minor} />
                <path className="grid-major" d={grid.major} />
              </g>
            )}
            {width > 0 && (
              <g className="board-axes">
                <line className="axis-ground" x1={0} x2={width} y1={view.oy} y2={view.oy} />
                <line
                  className={`axis-vertical ${revolve ? 'is-revolve' : showAxis ? 'is-mirror' : ''}`}
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

            {regions.map((loops, i) => (
              <path
                key={i}
                className="board-region"
                fillRule="evenodd"
                style={{ fill }}
                d={loops.map((loop) => pathOf(loop.map(([x, y]) => s(x, y)), true)).join(' ')}
              />
            ))}

            {ghostSegments.map(([a, b], i) => {
              const [ax, ay] = s(a[0], a[1]);
              const [bx, by] = s(b[0], b[1]);
              return <line key={i} className="board-ghost" x1={ax} y1={ay} x2={bx} y2={by} />;
            })}

            {sketch &&
              Object.values(sketch.lines).map((line) => {
                const a = sketch.points[line.a];
                const b = sketch.points[line.b];
                if (!a || !b) return null;
                const [ax, ay] = s(a.x, a.y);
                const [bx, by] = s(b.x, b.y);
                const classes = ['board-line', selectedLines.has(line.id) ? 'is-selected' : '', hover?.line === line.id ? 'is-hover' : ''];
                return <line key={line.id} className={classes.join(' ')} x1={ax} y1={ay} x2={bx} y2={by} />;
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
                const classes = [
                  'board-dot',
                  selectedPoints.has(p.id) ? 'is-selected' : '',
                  board.chainFrom === p.id && board.tool === 'draw' ? 'is-chain' : '',
                  hover?.dot === p.id ? 'is-hover' : '',
                  showAxis && Math.abs(p.x) <= AXIS_EPSILON ? 'is-on-axis' : '',
                ];
                return <circle key={p.id} className={classes.join(' ')} cx={cx} cy={cy} r={hover?.dot === p.id ? 6 : 4.5} />;
              })}

            {hover && showCursor && !hover.dot && (
              <g className="board-cursor" transform={`translate(${s(hover.x, hover.y)[0]} ${s(hover.x, hover.y)[1]})`}>
                <circle r={4} />
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

          <div className="board-caption">{PLANE_INFO[plane].caption}</div>

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

          {!blueprint && (
            <div className="board-empty">
              <Icon name="blueprint" size={34} />
              <p className="board-empty-title">Click to place your first dot</p>
              <p>Keep clicking to join dots with lines. Close the outline and it turns into a 3D object on the right.</p>
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
