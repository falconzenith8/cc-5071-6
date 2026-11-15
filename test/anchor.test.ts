import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, SoftGrabConstraint, substepsFor } from '../src/physics/softGrab';
import { qFromAxisAngle, qMul, qRotate, vAdd } from '../src/physics/math3';
import { makeWorld, spawn } from './helpers';

describe('grab anchor in local space', () => {
  it('stores the anchor in body-local coordinates', async () => {
    const { world } = await makeWorld();
    const bar = spawn(world, 'bar');
    const q = qFromAxisAngle({ x: 0.2, y: 1, z: 0.3 }, 0.8);
    bar.body.setRotation(q, true);

    // Surface point: center of the +x end face of the 2m bar.
    const localSurface = { x: 1.0, y: 0, z: 0 };
    const p = bar.body.translation();
    const worldPoint = vAdd(p, qRotate(q, localSurface));

    const c = new SoftGrabConstraint(bar.body, worldPoint, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(c.localAnchor.x).toBeCloseTo(localSurface.x, 6);
    expect(c.localAnchor.y).toBeCloseTo(0, 6);
    expect(c.localAnchor.z).toBeCloseTo(0, 6);
    world.free();
  });

  it('tracks the same material point after the prop is rotated and moved', async () => {
    const { world } = await makeWorld();
    const bar = spawn(world, 'bar');
    const q0 = qFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3);
    bar.body.setRotation(q0, true);

    const localSurface = { x: -1.0, y: 0.04, z: 0 }; // end face, top edge
    const p0 = bar.body.translation();
    const worldPoint = vAdd(p0, qRotate(q0, localSurface));
    const c = new SoftGrabConstraint(bar.body, worldPoint, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });

    // Move and rotate the prop arbitrarily.
    const p1 = { x: 3.2, y: 1.4, z: -2.0 };
    const q1 = qFromAxisAngle({ x: 1, y: 0.4, z: -0.2 }, 2.1);
    bar.body.setTranslation(p1, true);
    bar.body.setRotation(q1, true);

    const anchor = c.worldAnchor(bar.body);
    const expected = vAdd(p1, qRotate(q1, localSurface));
    expect(anchor.x).toBeCloseTo(expected.x, 6);
    expect(anchor.y).toBeCloseTo(expected.y, 6);
    expect(anchor.z).toBeCloseTo(expected.z, 6);

    // The anchor is still on the physical surface in local space:
    // |x| equals the half length, y equals the half thickness.
    expect(Math.abs(c.localAnchor.x)).toBeCloseTo(1.0, 6);
    expect(c.localAnchor.y).toBeCloseTo(0.04, 6);
    world.free();
  });

  it('desired body orientation follows hand rotation through the stored offset', async () => {
    const { world } = await makeWorld();
    const box = spawn(world, 'box');
    const handQ0 = qFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.2);
    const p = box.body.translation();
    const c = new SoftGrabConstraint(box.body, { x: p.x, y: p.y + 0.225, z: p.z }, { x: 0, y: 1, z: 0 }, handQ0);

    const handQ1 = qFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.3);
    const desired = c.desiredBodyQuat(handQ1);
    // Rotating the hand by dq must rotate the desired body orientation by dq.
    const dq = { x: 0, y: Math.sin(1.1 / 2), z: 0, w: Math.cos(1.1 / 2) }; // handQ1 * handQ0^-1
    const expected = qMul(dq, box.body.rotation());
    expect(desired.x).toBeCloseTo(expected.x, 6);
    expect(desired.y).toBeCloseTo(expected.y, 6);
    expect(desired.z).toBeCloseTo(expected.z, 6);
    expect(desired.w).toBeCloseTo(expected.w, 6);
    world.free();
  });
});

describe('substep scheduling', () => {
  it('keeps omega*dt within the stability limit across the supported range', () => {
    for (const hz of [1, 6, 15]) {
      for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
        const params = { ...DEFAULT_PARAMS, posStiffnessHz: hz, rotStiffnessHz: hz };
        const n = substepsFor(params, dt);
        const omega = 2 * Math.PI * hz;
        expect(omega * (dt / n)).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(16);
      }
    }
  });

  it('caps substeps for absurd stiffness instead of hanging the loop', () => {
    const params = { ...DEFAULT_PARAMS, posStiffnessHz: 500, rotStiffnessHz: 500 };
    expect(substepsFor(params, 1 / 60)).toBe(16);
  });

  it('uses one substep for soft settings', () => {
    const n = substepsFor({ ...DEFAULT_PARAMS, posStiffnessHz: 1, rotStiffnessHz: 1 }, 1 / 60);
    expect(n).toBe(1);
  });
});
