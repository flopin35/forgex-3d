import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { analyzeGraph } from '../core/geometry/analysis';
import { DEG_TO_RAD } from '../core/math/transform';
import { meshGraphOf, SMOOTH_SHADING_ANGLE, type Scene, type SceneObject } from '../core/scene/types';
import { buildConstructionBuffers, PrimitiveGeometryCache } from './geometryFactory';

export interface GlbExport {
  bytes: Uint8Array<ArrayBuffer>;
  /** Meshes written (hidden objects are left out). */
  meshes: number;
  triangles: number;
}

/**
 * Writes the visible scene as a binary glTF (.glb): metres, +Y up, the hierarchy and
 * object names kept. Blender converts +Y up to its +Z up on import; Roblox Studio's
 * 3D Importer reads .glb directly.
 */
export async function exportSceneToGlb(scene: Scene, name: string): Promise<GlbExport> {
  const primitives = new PrimitiveGeometryCache();
  const owned: { dispose(): void }[] = [];
  const root = new THREE.Group();
  root.name = name;
  let meshes = 0;
  let triangles = 0;

  const build = (object: SceneObject): THREE.Object3D | null => {
    if (!object.visible) return null;
    let node: THREE.Object3D = new THREE.Group();
    if (object.kind === 'mesh') {
      let geometry: THREE.BufferGeometry | null = null;
      let doubleSided = false;
      if (object.source.type === 'primitive') {
        geometry = primitives.get(object.source.primitive);
        triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      } else {
        const graph = meshGraphOf(object);
        if (graph) {
          const buffers = buildConstructionBuffers(graph, { smoothAngle: object.material.smooth ? SMOOTH_SHADING_ANGLE : 0 });
          buffers.edges.dispose();
          buffers.points.dispose();
          owned.push(buffers.faces);
          // A drawing with lines but no faces yet has nothing to export as a surface.
          if (buffers.triangleCount > 0) {
            geometry = buffers.faces;
            triangles += buffers.triangleCount;
            doubleSided = !analyzeGraph(graph).closed;
          }
        }
      }
      if (geometry) {
        const material = new THREE.MeshStandardMaterial({
          name: object.name,
          color: object.material.color,
          roughness: 0.55,
          metalness: 0.05,
          side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        owned.push(material);
        node = new THREE.Mesh(geometry, material);
        meshes++;
      }
    }
    const { position, rotation, scale } = object.transform;
    node.name = object.name;
    node.position.set(position[0], position[1], position[2]);
    node.rotation.set(rotation[0] * DEG_TO_RAD, rotation[1] * DEG_TO_RAD, rotation[2] * DEG_TO_RAD, 'XYZ');
    node.scale.set(scale[0], scale[1], scale[2]);
    for (const childId of object.childIds) {
      const child = scene.objects[childId];
      const built = child ? build(child) : null;
      if (built) node.add(built);
    }
    return node;
  };

  for (const id of scene.rootIds) {
    const object = scene.objects[id];
    const built = object ? build(object) : null;
    if (built) root.add(built);
  }

  try {
    if (meshes === 0) throw new Error('There is nothing visible with faces to export. Close a shape on the board or show a hidden object first.');
    const result = await new GLTFExporter().parseAsync(root, { binary: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('The glTF exporter did not return binary data.');
    return { bytes: new Uint8Array(result), meshes, triangles };
  } finally {
    primitives.dispose();
    owned.forEach((item) => item.dispose());
  }
}
