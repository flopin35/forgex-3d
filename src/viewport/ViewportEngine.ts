import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { boardStore } from '../app/boardState';
import type { ViewportApi } from '../app/editorActions';
import { perfStats } from '../app/perfStats';
import type { ToolImage, ViewPreset } from '../core/automation/toolTypes';
import { SetGraphCommand, SetTransformCommand } from '../core/commands/sceneCommands';
import type { EditorState, EditorStore } from '../core/editor/editorStore';
import { moveVertex, type ConstructionGraph } from '../core/geometry/constructionGraph';
import {
  cleanTransform,
  cloneTransform,
  DEG_TO_RAD,
  RAD_TO_DEG,
  transformsEqual,
  type Transform,
} from '../core/math/transform';
import { cleanVec3, equals, type Vec3 } from '../core/math/vec3';
import type { CameraState, ProjectSettings } from '../core/project/projectFile';
import { meshGraphOf, SMOOTH_SHADING_ANGLE, sourceGraphOf, type Scene, type SceneObject } from '../core/scene/types';
import { buildConstructionBuffers, buildGrid, buildPointBuffers, disposeObjectTree, PrimitiveGeometryCache } from './geometryFactory';

const ACCENT = 0x38b2ff;
const EDGE_COLOR = 0x08111d;
const VERTEX_COLOR = new THREE.Color(0xdfe8f3);
const CAGE_COLOR = 0xffb02e;
const VERTEX_SELECTED_COLOR = new THREE.Color(0xffb02e);
const DEFAULT_CAMERA: CameraState = { position: [2.7, 2.1, 3.6], target: [0, 0.75, 0] };
const TURNTABLE_SPEED = 1.6;
const VIEW_HELPER_SIZE = 128;
const CLICK_TOLERANCE_PX = 4;
const VERTEX_PICK_RADIUS_PX = 12;

interface ObjectNode {
  id: string;
  /** 'group', 'construction' (point-built or blueprint) or 'primitive:<kind>': a change means the node is rebuilt. */
  sourceKey: string;
  object: THREE.Object3D;
  mesh: THREE.Mesh | null;
  material: THREE.MeshStandardMaterial | null;
  /** The editable (source) graph: what points mode picks and moves. */
  graph: ConstructionGraph | null;
  /** The graph shown, after modifiers. */
  shownGraph: ConstructionGraph | null;
  smooth: boolean;
  edges: THREE.LineSegments | null;
  points: THREE.Points | null;
  /** The editable cage drawn in points mode when modifiers reshape the mesh (box modelling). */
  cage: THREE.LineSegments | null;
  vertexIds: string[];
  outline: THREE.Mesh | null;
  triangles: number;
}

type DragState =
  | { kind: 'object'; id: string; before: Transform; label: string }
  | { kind: 'vertex'; id: string; vertexId: string; graphBefore: ConstructionGraph; inverseWorld: THREE.Matrix4 };

function sourceKeyOf(object: SceneObject): string {
  if (object.kind === 'group') return 'group';
  return object.source.type === 'primitive' ? `primitive:${object.source.primitive}` : 'construction';
}

function readTransform(object: THREE.Object3D): Transform {
  const { position: p, rotation: r, scale: s } = object;
  return {
    position: [p.x, p.y, p.z],
    rotation: [r.x * RAD_TO_DEG, r.y * RAD_TO_DEG, r.z * RAD_TO_DEG],
    scale: [s.x, s.y, s.z],
  };
}

/**
 * Renders the editor state with Three.js and turns pointer input into editor actions.
 * The store stays the source of truth: the engine reads from it and writes through
 * commands, never the other way round.
 */
export class ViewportEngine implements ViewportApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.02, 5000);
  private readonly content = new THREE.Group();
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly viewHelper: ViewHelper;
  private readonly vertexProxy = new THREE.Object3D();
  private readonly selectionBox = new THREE.Box3();
  private readonly selectionBoxHelper: THREE.Box3Helper;
  private readonly primitives = new PrimitiveGeometryCache();
  private readonly outlineMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.BackSide });
  private readonly raycaster = new THREE.Raycaster();
  private readonly nodes = new Map<string, ObjectNode>();
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeBoard: () => void;

  private grid: THREE.Group | null = null;
  private lastState: EditorState | null = null;
  private highlightedId: string | null = null;
  private drag: DragState | null = null;
  private dragCancelled = false;
  private pointerDown: { x: number; y: number; overGizmo: boolean } | null = null;
  private needsRender = true;
  private lastFrameTime = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly store: EditorStore,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.45;
    (room as unknown as { dispose?: () => void }).dispose?.();
    pmrem.dispose();

    const hemisphere = new THREE.HemisphereLight(0xe4eeff, 0x15202c, 0.8);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(6, 10, 7);
    const fill = new THREE.DirectionalLight(0x9cc8ff, 0.5);
    fill.position.set(-8, 4, -6);
    this.scene.add(hemisphere, key, fill, this.content, this.vertexProxy);

    this.selectionBoxHelper = new THREE.Box3Helper(this.selectionBox, ACCENT);
    this.selectionBoxHelper.visible = false;
    this.scene.add(this.selectionBoxHelper);

    // The gizmo is created before the orbit controls so it sees pointer presses first.
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.size = 0.9;
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
    });
    this.gizmo.addEventListener('mouseDown', this.beginDrag);
    this.gizmo.addEventListener('objectChange', this.updateDrag);
    this.gizmo.addEventListener('mouseUp', this.endDrag);
    this.gizmo.addEventListener('change', this.requestRender);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.orbit.addEventListener('change', this.requestRender);
    this.orbit.addEventListener('end', this.saveCameraView);

    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.center = this.orbit.target;

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();

    this.unsubscribe = store.subscribe(this.onStoreChange);
    this.onStoreChange();
    this.unsubscribeBoard = boardStore.subscribe(this.applyTurntable);
    this.applyTurntable();
    this.renderer.setAnimationLoop(this.tick);
  }

  // -- Public API ----------------------------------------------------------------

  frameSelection(): void {
    const state = this.store.getState();
    const node = state.selectedId ? this.nodes.get(state.selectedId) : undefined;
    const sphere = new THREE.Sphere();
    if (node && state.editMode === 'points' && state.selectedVertexId && node.graph?.vertices[state.selectedVertexId]) {
      const p = node.graph.vertices[state.selectedVertexId].position;
      node.object.updateWorldMatrix(true, false);
      sphere.center.set(p[0], p[1], p[2]).applyMatrix4(node.object.matrixWorld);
      sphere.radius = 0.5;
    } else {
      this.boundsOf(node ? node.object : this.content, sphere);
      if (node && sphere.radius === 1 && new THREE.Box3().setFromObject(node.object).isEmpty()) node.object.getWorldPosition(sphere.center);
    }
    this.fitCamera(sphere);
    this.saveCameraView();
    this.requestRender();
  }

  /** Renders the scene to a JPEG for AI tools. The user's camera is put back afterwards. */
  capture(options: { view: ViewPreset; frame: boolean; width: number }): ToolImage {
    const savedPosition = this.camera.position.clone();
    const savedTarget = this.orbit.target.clone();
    const helper = this.gizmo.getHelper();
    const helperVisible = helper.visible;
    try {
      if (options.view !== 'current') this.applyViewDirection(options.view);
      if (options.frame) this.fitCamera(this.boundsOf(this.content, new THREE.Sphere()));
      this.orbit.update();
      helper.visible = false;
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);

      // Copy the frame straight away, while the WebGL drawing buffer is still valid.
      const source = this.renderer.domElement;
      const scale = Math.min(1, options.width / source.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D canvas available for the capture.');
      const glow = context.createRadialGradient(canvas.width / 2, canvas.height * 0.18, 0, canvas.width / 2, canvas.height * 0.18, canvas.width);
      glow.addColorStop(0, '#142237');
      glow.addColorStop(0.48, '#0b131e');
      glow.addColorStop(1, '#06090d');
      context.fillStyle = glow;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.9);
      return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' };
    } finally {
      helper.visible = helperVisible;
      this.camera.position.copy(savedPosition);
      this.orbit.target.copy(savedTarget);
      this.orbit.update();
      this.requestRender();
    }
  }

  /** Bounding sphere of an object's world-space contents (radius 1 around its origin if empty). */
  private boundsOf(object: THREE.Object3D, sphere: THREE.Sphere): THREE.Sphere {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      sphere.center.set(0, 0, 0);
      sphere.radius = 1;
    } else {
      box.getBoundingSphere(sphere);
    }
    return sphere;
  }

  /** Keeps the viewing direction and moves the camera so the sphere fills the view. */
  private fitCamera(sphere: THREE.Sphere): void {
    const radius = Math.max(sphere.radius, 0.25);
    const fovV = (this.camera.fov * DEG_TO_RAD) / 2;
    const fovH = Math.atan(Math.tan(fovV) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(fovV, fovH))) * 1.15;
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.orbit.update();
  }

  private applyViewDirection(view: Exclude<ViewPreset, 'current'>): void {
    const directions: Record<Exclude<ViewPreset, 'current'>, [number, number, number]> = {
      perspective: [1, 0.8, 1.25],
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      // A tiny offset keeps the camera's up direction well defined when looking straight down or up.
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
    };
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const direction = new THREE.Vector3(...directions[view]).normalize();
    this.camera.position.copy(this.orbit.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.orbit.target);
  }

  cancelActiveDrag(): boolean {
    const drag = this.drag;
    if (!drag || !this.gizmo.dragging) return false;
    this.dragCancelled = true;
    if (drag.kind === 'object') this.store.previewTransform(drag.id, drag.before);
    else this.store.previewGraph(drag.id, drag.graphBefore);
    // Ends the gizmo drag; its mouseUp sees the cancel and records nothing.
    (this.gizmo as unknown as { pointerUp(pointer: null): void }).pointerUp(null);
    this.drag = null;
    this.dragCancelled = false;
    this.onStoreChange();
    return true;
  }

  groundFocus(): [number, number] {
    return [this.orbit.target.x, this.orbit.target.z];
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.unsubscribe();
    this.unsubscribeBoard();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.viewHelper.dispose();
    this.nodes.forEach((node) => this.disposeNode(node));
    this.nodes.clear();
    if (this.grid) disposeObjectTree(this.grid);
    this.selectionBoxHelper.dispose();
    this.primitives.dispose();
    this.outlineMaterial.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // -- Store synchronisation -------------------------------------------------------

  private onStoreChange = (): void => {
    const state = this.store.getState();
    const previous = this.lastState;
    this.lastState = state;
    if (!previous || state.scene !== previous.scene) this.syncScene(state.scene);
    if (!previous || state.settings !== previous.settings) this.applySettings(state.settings, previous?.settings);
    if (!previous || state.camera.revision !== previous.camera.revision) this.applyCamera(state.camera.view);
    this.syncSelection(state);
    this.requestRender();
  };

  private syncScene(scene: Scene): void {
    for (const object of Object.values(scene.objects)) {
      let node = this.nodes.get(object.id);
      if (node && node.sourceKey !== sourceKeyOf(object)) {
        this.disposeNode(node);
        node = undefined;
      }
      if (!node) {
        node = this.createNode(object);
        this.nodes.set(object.id, node);
      }
      this.updateNode(node, object);
    }
    for (const [id, node] of this.nodes) {
      if (!scene.objects[id]) {
        this.disposeNode(node);
        this.nodes.delete(id);
        if (this.highlightedId === id) this.highlightedId = null;
      }
    }
    for (const object of Object.values(scene.objects)) {
      const node = this.nodes.get(object.id)!;
      const parent = (object.parentId && this.nodes.get(object.parentId)?.object) || this.content;
      if (node.object.parent !== parent) parent.add(node.object);
    }
    let triangles = 0;
    this.nodes.forEach((node) => (triangles += node.triangles));
    perfStats.report({ triangles });
  }

  private createNode(object: SceneObject): ObjectNode {
    const node: ObjectNode = {
      id: object.id,
      sourceKey: sourceKeyOf(object),
      object: new THREE.Group(),
      mesh: null,
      material: null,
      graph: null,
      shownGraph: null,
      smooth: false,
      edges: null,
      points: null,
      cage: null,
      vertexIds: [],
      outline: null,
      triangles: 0,
    };
    if (object.kind === 'group') {
      const marker = new THREE.AxesHelper(0.35);
      marker.name = 'group-marker';
      node.object.add(marker);
    } else {
      // Point-built and blueprint meshes can be open surfaces, so both sides are drawn.
      const isConstruction = object.source.type !== 'primitive';
      node.material = new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.05,
        side: isConstruction ? THREE.DoubleSide : THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const geometry = object.source.type === 'primitive' ? this.primitives.get(object.source.primitive) : new THREE.BufferGeometry();
      node.mesh = new THREE.Mesh(geometry, node.material);
      node.mesh.userData.objectId = object.id;
      node.object = node.mesh;
      if (object.source.type === 'primitive') {
        node.triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      }
      if (isConstruction) {
        node.edges = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 }),
        );
        node.points = new THREE.Points(
          new THREE.BufferGeometry(),
          new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }),
        );
        node.points.renderOrder = 10;
        node.points.visible = false;
        node.cage = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: CAGE_COLOR, transparent: true, opacity: 0.85, depthTest: false }),
        );
        node.cage.renderOrder = 9;
        node.cage.visible = false;
        node.mesh.add(node.edges, node.points, node.cage);
      }
    }
    node.object.userData.objectId = object.id;
    return node;
  }

  private updateNode(node: ObjectNode, object: SceneObject): void {
    const { position, rotation, scale } = object.transform;
    node.object.name = object.name;
    node.object.visible = object.visible;
    node.object.position.set(position[0], position[1], position[2]);
    node.object.rotation.set(rotation[0] * DEG_TO_RAD, rotation[1] * DEG_TO_RAD, rotation[2] * DEG_TO_RAD, 'XYZ');
    node.object.scale.set(scale[0], scale[1], scale[2]);
    if (object.kind !== 'mesh' || !node.material) return;
    node.material.color.set(object.material.color);
    // Generated graphs are cached, so an unchanged drawing or modifier keeps the same graph object.
    const graph = sourceGraphOf(object);
    const shown = meshGraphOf(object);
    const smooth = !!object.material.smooth;
    if (graph && shown && (graph !== node.graph || shown !== node.shownGraph || smooth !== node.smooth)) {
      this.rebuildConstruction(node, graph, shown, object.source.type !== 'construction', smooth);
    }
  }

  private rebuildConstruction(node: ObjectNode, graph: ConstructionGraph, shown: ConstructionGraph, generated: boolean, smooth: boolean): void {
    const start = performance.now();
    // Generated or modified meshes hide the seams inside flat areas; plain point-built meshes show every edge the user made.
    const buffers = buildConstructionBuffers(shown, {
      featureEdgesOnly: generated || shown !== graph,
      smoothAngle: smooth ? SMOOTH_SHADING_ANGLE : 0,
    });
    node.mesh!.geometry.dispose();
    node.mesh!.geometry = buffers.faces;
    node.edges!.geometry.dispose();
    node.edges!.geometry = buffers.edges;
    // Points mode always works on the editable graph, even when modifiers change what is shown.
    const points = shown === graph ? { points: buffers.points, vertexIds: buffers.vertexIds } : buildPointBuffers(graph);
    if (points.points !== buffers.points) buffers.points.dispose();
    node.points!.geometry.dispose();
    node.points!.geometry = points.points;
    node.cage!.geometry.dispose();
    if (shown === graph) {
      node.cage!.geometry = new THREE.BufferGeometry();
    } else {
      const cage = buildConstructionBuffers(graph);
      cage.faces.dispose();
      cage.points.dispose();
      node.cage!.geometry = cage.edges;
    }
    node.vertexIds = points.vertexIds;
    node.graph = graph;
    node.shownGraph = shown;
    node.smooth = smooth;
    node.triangles = buffers.triangleCount;
    this.colorVertices(node, this.lastState?.selectedVertexId ?? null);
    perfStats.report({ rebuildMs: performance.now() - start });
  }

  private disposeNode(node: ObjectNode): void {
    if (this.gizmo.object === node.object) this.gizmo.detach();
    node.object.removeFromParent();
    node.material?.dispose();
    // Primitive geometry is shared through the cache; only construction geometry belongs to the node.
    if (node.sourceKey === 'construction') node.mesh?.geometry.dispose();
    node.edges?.geometry.dispose();
    (node.edges?.material as THREE.Material | undefined)?.dispose();
    node.points?.geometry.dispose();
    (node.points?.material as THREE.Material | undefined)?.dispose();
    node.cage?.geometry.dispose();
    (node.cage?.material as THREE.Material | undefined)?.dispose();
    node.object.children
      .filter((child) => child.name === 'group-marker')
      .forEach((marker) => disposeObjectTree(marker));
  }

  private applySettings(settings: ProjectSettings, previous: ProjectSettings | undefined): void {
    this.gizmo.setTranslationSnap(settings.snapEnabled ? settings.gridSize : null);
    this.gizmo.setRotationSnap(settings.snapEnabled ? settings.rotationSnapDegrees * DEG_TO_RAD : null);
    this.gizmo.setScaleSnap(settings.snapEnabled ? 0.05 : null);
    if (!previous || previous.gridSize !== settings.gridSize || !this.grid) {
      if (this.grid) {
        this.scene.remove(this.grid);
        disposeObjectTree(this.grid);
      }
      this.grid = buildGrid(settings.gridSize);
      this.scene.add(this.grid);
    }
  }

  private applyCamera(view: CameraState | null): void {
    const { position, target } = view ?? DEFAULT_CAMERA;
    this.camera.position.set(position[0], position[1], position[2]);
    this.orbit.target.set(target[0], target[1], target[2]);
    this.orbit.update();
  }

  private applyTurntable = (): void => {
    const on = boardStore.getState().turntable;
    if (this.orbit.autoRotate === on) return;
    this.orbit.autoRotate = on;
    this.orbit.autoRotateSpeed = TURNTABLE_SPEED;
    if (!on) this.saveCameraView();
    this.requestRender();
  };

  private saveCameraView = (): void => {
    const p = this.camera.position;
    const t = this.orbit.target;
    this.store.setCameraView({ position: cleanVec3([p.x, p.y, p.z], 4), target: cleanVec3([t.x, t.y, t.z], 4) });
  };

  // -- Selection display and gizmo --------------------------------------------------

  private syncSelection(state: EditorState): void {
    if (this.highlightedId && this.highlightedId !== state.selectedId) {
      const old = this.nodes.get(this.highlightedId);
      if (old) this.setHighlight(old, false, false);
    }
    const node = state.selectedId ? this.nodes.get(state.selectedId) : undefined;
    this.highlightedId = node ? node.id : null;
    this.selectionBoxHelper.visible = false;
    if (node) {
      this.setHighlight(node, true, state.editMode === 'points');
      this.colorVertices(node, state.selectedVertexId);
      this.selectionBoxHelper.visible = node.mesh === null;
    }

    if (!node || state.tool === 'select' || !this.isShown(node.object)) {
      if (!this.drag) this.gizmo.detach();
      return;
    }
    if (state.editMode === 'points') {
      const vertex = state.selectedVertexId && node.graph ? node.graph.vertices[state.selectedVertexId] : undefined;
      if (!vertex) {
        this.gizmo.detach();
        return;
      }
      if (!this.drag) {
        node.object.updateWorldMatrix(true, false);
        this.vertexProxy.position.set(vertex.position[0], vertex.position[1], vertex.position[2]).applyMatrix4(node.object.matrixWorld);
      }
      this.gizmo.setMode('translate');
      if (this.gizmo.object !== this.vertexProxy) this.gizmo.attach(this.vertexProxy);
      return;
    }
    const mode: 'translate' | 'rotate' | 'scale' = state.tool;
    this.gizmo.setMode(mode);
    if (this.gizmo.object !== node.object) this.gizmo.attach(node.object);
  }

  private setHighlight(node: ObjectNode, selected: boolean, pointsMode: boolean): void {
    if (node.edges) {
      const material = node.edges.material as THREE.LineBasicMaterial;
      material.color.set(selected ? ACCENT : EDGE_COLOR);
      material.opacity = selected ? 1 : 0.6;
    }
    if (node.points) node.points.visible = selected && pointsMode;
    if (node.cage) node.cage.visible = selected && pointsMode && node.shownGraph !== node.graph;
    if (node.mesh && !node.graph && node.sourceKey !== 'construction') {
      if (selected && !node.outline) {
        node.outline = new THREE.Mesh(node.mesh.geometry, this.outlineMaterial);
        node.outline.scale.setScalar(1.035);
        node.outline.raycast = () => {};
        node.mesh.add(node.outline);
      }
      if (node.outline) node.outline.visible = selected;
    }
  }

  private colorVertices(node: ObjectNode, selectedVertexId: string | null): void {
    if (!node.points) return;
    const colors = node.points.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colors) return;
    node.vertexIds.forEach((id, i) => {
      const color = id === selectedVertexId ? VERTEX_SELECTED_COLOR : VERTEX_COLOR;
      colors.setXYZ(i, color.r, color.g, color.b);
    });
    colors.needsUpdate = true;
  }

  private isShown(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current && current !== this.content; current = current.parent) {
      if (!current.visible) return false;
    }
    return true;
  }

  // -- Gizmo drags --------------------------------------------------------------------

  private beginDrag = (): void => {
    const state = this.store.getState();
    this.dragCancelled = false;
    this.drag = null;
    if (!state.selectedId) return;
    const node = this.nodes.get(state.selectedId);
    const object = state.scene.objects[state.selectedId];
    if (!node || !object) return;
    if (state.editMode === 'points' && state.selectedVertexId && node.graph) {
      node.object.updateWorldMatrix(true, false);
      this.drag = {
        kind: 'vertex',
        id: object.id,
        vertexId: state.selectedVertexId,
        graphBefore: node.graph,
        inverseWorld: node.object.matrixWorld.clone().invert(),
      };
    } else {
      const label = state.tool === 'rotate' ? 'Rotate' : state.tool === 'scale' ? 'Scale' : 'Move';
      this.drag = { kind: 'object', id: object.id, before: cloneTransform(object.transform), label: `${label} ${object.name}` };
    }
  };

  private vertexLocalPosition(drag: Extract<DragState, { kind: 'vertex' }>): Vec3 {
    const local = this.vertexProxy.position.clone().applyMatrix4(drag.inverseWorld);
    return [local.x, local.y, local.z];
  }

  private updateDrag = (): void => {
    const drag = this.drag;
    if (!drag || this.dragCancelled) return;
    if (drag.kind === 'object') {
      const node = this.nodes.get(drag.id);
      if (node) this.store.previewTransform(drag.id, readTransform(node.object));
    } else {
      this.store.previewGraph(drag.id, moveVertex(drag.graphBefore, drag.vertexId, this.vertexLocalPosition(drag)));
    }
  };

  private endDrag = (): void => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || this.dragCancelled) return;
    if (drag.kind === 'object') {
      const node = this.nodes.get(drag.id);
      if (!node) return;
      const after = cleanTransform(readTransform(node.object));
      if (transformsEqual(drag.before, after)) this.store.previewTransform(drag.id, drag.before);
      else this.store.execute(new SetTransformCommand(drag.id, drag.before, after, drag.label));
      return;
    }
    const position = cleanVec3(this.vertexLocalPosition(drag));
    const before = drag.graphBefore.vertices[drag.vertexId].position;
    if (equals(before, position)) {
      this.store.previewGraph(drag.id, drag.graphBefore);
      return;
    }
    const after = moveVertex(drag.graphBefore, drag.vertexId, position);
    this.store.execute(new SetGraphCommand(drag.id, drag.graphBefore, after, `Move vertex ${drag.vertexId}`));
  };

  // -- Picking --------------------------------------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      this.pointerDown = null;
      return;
    }
    this.pointerDown = { x: event.clientX, y: event.clientY, overGizmo: this.gizmo.axis !== null };
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || event.button !== 0 || down.overGizmo || this.gizmo.dragging) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    if (this.viewHelper.handleClick(event)) {
      this.requestRender();
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (event.clientX > rect.right - VIEW_HELPER_SIZE && event.clientY > rect.bottom - VIEW_HELPER_SIZE) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const state = this.store.getState();
    if (state.editMode === 'points' && state.selectedId) {
      this.store.selectVertex(this.pickVertex(state.selectedId, x, y, rect));
      return;
    }
    const pointer = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.nodes.forEach((node) => {
      if (node.mesh && this.isShown(node.mesh)) meshes.push(node.mesh);
    });
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    this.store.select(hit ? (hit.object.userData.objectId as string) : null);
  };

  private pickVertex(objectId: string, x: number, y: number, rect: DOMRect): string | null {
    const node = this.nodes.get(objectId);
    if (!node?.graph) return null;
    node.object.updateWorldMatrix(true, false);
    const point = new THREE.Vector3();
    let best: string | null = null;
    let bestDistance = VERTEX_PICK_RADIUS_PX;
    for (const id of node.vertexIds) {
      const p = node.graph.vertices[id].position;
      point.set(p[0], p[1], p[2]).applyMatrix4(node.object.matrixWorld).project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const sx = ((point.x + 1) / 2) * rect.width;
      const sy = ((1 - point.y) / 2) * rect.height;
      const distance = Math.hypot(sx - x, sy - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  }

  // -- Rendering ------------------------------------------------------------------------

  private requestRender = (): void => {
    this.needsRender = true;
  };

  private resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  private tick = (time: number): void => {
    const delta = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = time;
    if (this.viewHelper.animating) {
      this.viewHelper.update(delta);
      this.needsRender = true;
      if (!this.viewHelper.animating) this.saveCameraView();
    }
    if (this.orbit.update()) this.needsRender = true;
    if (!this.needsRender) return;
    this.needsRender = false;

    if (this.selectionBoxHelper.visible && this.highlightedId) {
      const node = this.nodes.get(this.highlightedId);
      if (node) this.selectionBox.setFromObject(node.object);
    }
    const start = performance.now();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.viewHelper.render(this.renderer);
    perfStats.report({ renderMs: performance.now() - start });
  };
}
