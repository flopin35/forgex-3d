import type { MeshObject, MeshSource, SceneObject } from '../core/scene/types';
import type { BodyView } from '../core/sketch/body';
import type { RevolveAxis, Sketch } from '../core/sketch/sketch';

/** An object drawn on the board: a blueprint (one drawing) or a body (side, top and front drawings). */
export type DrawnSource = Extract<MeshSource, { type: 'sketch' }> | Extract<MeshSource, { type: 'body' }>;
export type DrawnObject = MeshObject & { source: DrawnSource };

export function isDrawn(object: SceneObject | null | undefined): object is DrawnObject {
  return !!object && object.kind === 'mesh' && (object.source.type === 'sketch' || object.source.type === 'body');
}

/** The drawing the board is editing right now, and how to show it. */
export interface ActiveDrawing {
  object: DrawnObject;
  /** The body view being drawn, or null for a blueprint. */
  view: BodyView | null;
  sketch: Sketch;
  /** Show and use a mirrored copy across x = 0. */
  mirror: boolean;
  /** Filled areas count the mirrored copy too (not for revolves). */
  fillMirror: boolean;
  /** The lathe axis for a blueprint in revolve mode, otherwise null. */
  revolveAxis: RevolveAxis | null;
  curveSteps: number;
}

export function drawingOf(object: SceneObject | null | undefined, bodyView: BodyView): ActiveDrawing | null {
  if (!isDrawn(object)) return null;
  const source = object.source;
  if (source.type === 'body') {
    const mirror = bodyView !== 'side' && source.body.symmetric;
    return { object, view: bodyView, sketch: source.views[bodyView], mirror, fillMirror: mirror, revolveAxis: null, curveSteps: source.body.curveSteps };
  }
  const revolve = source.shape.mode === 'revolve';
  return {
    object,
    view: null,
    sketch: source.sketch,
    mirror: source.shape.mirror || (revolve && source.shape.axis === 'vertical'),
    fillMirror: source.shape.mirror && !revolve,
    revolveAxis: revolve ? source.shape.axis : null,
    curveSteps: source.shape.curveSteps,
  };
}

/** The same source with one drawing replaced. */
export function withDrawing(source: DrawnSource, view: BodyView | null, sketch: Sketch): DrawnSource {
  if (source.type === 'body') return { ...source, views: { ...source.views, [view ?? 'side']: sketch } };
  return { ...source, sketch };
}

export function drawingIn(source: DrawnSource, view: BodyView | null): Sketch {
  return source.type === 'body' ? source.views[view ?? 'side'] : source.sketch;
}
