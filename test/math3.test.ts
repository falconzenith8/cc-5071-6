import { describe, expect, it } from 'vitest';
import {
  m3FromDiag,
  m3FromQuat,
  m3Invert,
  m3Mul,
  m3MulVec,
  m3Skew,
  qFromAxisAngle,
  qMul,
  qNorm,
  qRotate,
  qToAxisAngle,
  vCross,
} from '../src/physics/math3';

const closeTo = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('math3', () => {
  it('quaternion rotation matches axis-angle definition', () => {
    const q = qFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const v = qRotate(q, { x: 1, y: 0, z: 0 });
    expect(closeTo(v.x, 0, 1e-9)).toBe(true);
    expect(closeTo(v.z, -1, 1e-9)).toBe(true);
  });

  it('qMul applies right operand first', () => {
    const yaw90 = qFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const pitch90 = qFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    const both = qMul(yaw90, pitch90);
    const v = qRotate(both, { x: 1, y: 0, z: 0 });
    const seq = qRotate(yaw90, qRotate(pitch90, { x: 1, y: 0, z: 0 }));
    expect(closeTo(v.x, seq.x, 1e-9)).toBe(true);
    expect(closeTo(v.y, seq.y, 1e-9)).toBe(true);
    expect(closeTo(v.z, seq.z, 1e-9)).toBe(true);
  });

  it('qToAxisAngle recovers the shortest rotation', () => {
    const axis = { x: 0.3, y: 0.5, z: 0.8 };
    const q = qFromAxisAngle(axis, 1.1);
    const { axis: a2, angle } = qToAxisAngle(q);
    expect(angle).toBeCloseTo(1.1, 6);
    const n = Math.hypot(axis.x, axis.y, axis.z);
    expect(a2.x).toBeCloseTo(axis.x / n, 6);
    expect(a2.y).toBeCloseTo(axis.y / n, 6);
    expect(a2.z).toBeCloseTo(axis.z / n, 6);
  });

  it('rotation matrix matches quaternion rotation', () => {
    const q = qNorm(qFromAxisAngle({ x: 1, y: 2, z: 3 }, 0.7));
    const m = m3FromQuat(q);
    const v = { x: 0.4, y: -0.2, z: 0.9 };
    const a = m3MulVec(m, v);
    const b = qRotate(q, v);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
  });

  it('matrix inverse round-trips', () => {
    const m = m3FromDiag(2, 3, 4);
    const rot = m3FromQuat(qFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.5));
    const sym = m3Mul(m3Mul(rot, m), m3FromDiag(1, 1, 1));
    const general = m3Mul(rot, m);
    for (const cand of [m, sym, general]) {
      const inv = m3Invert(cand);
      expect(inv).not.toBeNull();
      const id = m3Mul(cand, inv!);
      for (let i = 0; i < 9; i++) {
        const expect_ = i % 4 === 0 ? 1 : 0;
        expect(Math.abs(id[i] - expect_)).toBeLessThan(1e-9);
      }
    }
  });

  it('skew matrix computes cross products', () => {
    const r = { x: 1, y: 2, z: 3 };
    const v = { x: -2, y: 0.5, z: 4 };
    const s = m3Skew(r);
    const a = m3MulVec(s, v);
    const b = vCross(r, v);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
    expect(a.z).toBeCloseTo(b.z, 12);
  });
});
