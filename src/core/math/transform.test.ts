import { describe, expect, it } from 'vitest';
import {
  composeMatrix,
  decomposeMatrix,
  identityMatrix,
  invertAffine,
  multiplyMatrices,
  transformPoint,
  type Transform,
} from './transform';
import { snapScalar } from './vec3';
import { metersToStuds, studsToMeters, yUpToZUp, zUpToYUp } from '../units';

function expectVecClose(actual: number[], expected: number[], digits = 6) {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
}

describe('transform matrices', () => {
  const sample: Transform = { position: [1, -2, 3.5], rotation: [30, -45, 60], scale: [2, 0.5, 1.5] };

  it('composes and decomposes back to the same transform', () => {
    const back = decomposeMatrix(composeMatrix(sample));
    expectVecClose(back.position, sample.position);
    expectVecClose(back.rotation, sample.rotation);
    expectVecClose(back.scale, sample.scale);
  });

  it('rotates in XYZ order like Three.js', () => {
    const m = composeMatrix({ position: [0, 0, 0], rotation: [0, 0, 90], scale: [1, 1, 1] });
    expectVecClose(transformPoint(m, [1, 0, 0]), [0, 1, 0]);
  });

  it('inverts an affine matrix', () => {
    const m = composeMatrix(sample);
    const inverse = invertAffine(m)!;
    expectVecClose(multiplyMatrices(m, inverse), identityMatrix());
  });

  it('returns null for a zero scale', () => {
    expect(invertAffine(composeMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] }))).toBeNull();
  });

  it('snaps values to the grid', () => {
    expect(snapScalar(0.37, 0.25)).toBe(0.25);
    expect(snapScalar(0.38, 0.25)).toBe(0.5);
    expect(snapScalar(0.37, 0)).toBe(0.37);
  });
});

describe('unit conventions', () => {
  it('converts metres to Roblox studs at 0.28 m per stud', () => {
    expect(metersToStuds(2.8)).toBeCloseTo(10);
    expect(studsToMeters(10)).toBeCloseTo(2.8);
  });

  it('maps +Y up to Blender +Z up the way the glTF importer does', () => {
    expect(yUpToZUp([0, 1, 0])).toEqual([0, 0, 1]);
    expect(yUpToZUp([0, 0, 1])).toEqual([0, -1, 0]);
    expect(zUpToYUp(yUpToZUp([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});
