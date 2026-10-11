import * as THREE from 'three';
import type { ConstructionGraph } from '../core/geometry/constructionGraph';
import { buildMeshData } from '../core/geometry/meshData';
import type { PrimitiveKind } from '../core/scene/types';

/** Shared geometry for parametric primitives (1 m across, centred on the origin). */
export class PrimitiveGeometryCache {
  private readonly cache = new Map<PrimitiveKind, THREE.BufferGeometry>();

  get(kind: PrimitiveKind): THREE.BufferGeometry {
    let geometry = this.cache.get(kind);
    if (!geometry) {
      geometry = kind === 'sphere' ? new THREE.SphereGeometry(0.5, 48, 32) : new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
      this.cache.set(kind, geometry);
    }
    return geometry;
  }

  dispose(): void {
    this.cache.forEach((geometry) => geometry.dispose());
    this.cache.clear();
  }
}

export interface ConstructionBuffers {
  faces: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  points: THREE.BufferGeometry;
  vertexIds: string[];
  triangleCount: number;
}

/** Rebuilds the renderable buffers for a point-built object from its construction graph. */
export function buildConstructionBuffers(graph: ConstructionGraph): ConstructionBuffers {
  const data = buildMeshData(graph);
  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  faces.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  faces.computeBoundingBox();
  faces.computeBoundingSphere();

  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.BufferAttribute(data.edgePositions, 3));
  edges.computeBoundingSphere();

  const points = new THREE.BufferGeometry();
  points.setAttribute('position', new THREE.BufferAttribute(data.pointPositions, 3));
  points.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.vertexIds.length * 3), 3));
  points.computeBoundingSphere();

  return { faces, edges, points, vertexIds: data.vertexIds, triangleCount: data.triangleCount };
}

/** A ground grid: fine lines every cell, stronger lines every 4 cells, and coloured X and Z axes. */
export function buildGrid(cell: number, cellsPerSide = 40): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grid';
  const half = cell * cellsPerSide;
  const minor: number[] = [];
  const major: number[] = [];
  for (let i = -cellsPerSide; i <= cellsPerSide; i++) {
    if (i === 0) continue;
    const p = i * cell;
    const target = i % 4 === 0 ? major : minor;
    target.push(-half, 0, p, half, 0, p, p, 0, -half, p, 0, half);
  }
  const lines = (positions: number[], color: number, opacity: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    return new THREE.LineSegments(geometry, material);
  };
  group.add(lines(minor, 0x1f2b3a, 0.7));
  group.add(lines(major, 0x2b3c51, 0.95));
  group.add(lines([-half, 0, 0, half, 0, 0], 0xd9505f, 0.9));
  group.add(lines([0, 0, -half, 0, 0, half], 0x3f86e0, 0.9));
  group.position.y = -0.0005;
  group.renderOrder = -1;
  return group;
}

export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const withGeometry = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    withGeometry.geometry?.dispose();
    const material = withGeometry.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
