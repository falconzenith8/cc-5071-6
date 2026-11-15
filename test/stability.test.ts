import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, SoftGrabParams } from '../src/physics/softGrab';
import { addStatic, makeWorld, runGrabScenario, scriptAt, spawn } from './helpers';

const GRAVITY = 9.81;

function sagBound(hz: number): number {
  const omega = 2 * Math.PI * hz;
  return (GRAVITY / (omega * omega)) * 1.6 + 0.01;
}

/** Places the box in free space at a known grab pose. */
function boxInFreeSpace(world: Awaited<ReturnType<typeof makeWorld>>['world']) {
  const box = spawn(world, 'box');
  box.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
  box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return box;
}

describe('soft grab stability', () => {
  // duration: the 2 Hz cases need a long window — the grabbed box's pendulum
  // mode inherits the soft channel's damping and takes ~6 s to decay.
  const cases: Array<{ hz: number; zeta: number; duration: number }> = [
    { hz: 2, zeta: 0.3, duration: 9 },
    { hz: 2, zeta: 1.0, duration: 9 },
    { hz: 8, zeta: 0.3, duration: 4 },
    { hz: 8, zeta: 1.0, duration: 4 },
    { hz: 15, zeta: 0.5, duration: 4 },
    { hz: 15, zeta: 1.0, duration: 4 },
  ];

  for (const { hz, zeta, duration } of cases) {
    it(`stays stable and settles at ${hz} Hz, zeta=${zeta}`, async () => {
      const { world } = await makeWorld();
      addStatic(world);
      const box = boxInFreeSpace(world);
      const grab = { x: 0, y: 1.725, z: 0 };
      const params: SoftGrabParams = {
        ...DEFAULT_PARAMS,
        posStiffnessHz: hz,
        posDamping: zeta,
        rotStiffnessHz: Math.min(hz, 10),
        maxForce: 600,
        maxTorque: 60,
      };
      // Fast circular target motion for 2s, then rest.
      const targetAt = (t: number) => {
        const T = 2.0;
        if (t >= T) return { pos: { x: grab.x + 0.4, y: grab.y, z: grab.z }, quat: { x: 0, y: 0, z: 0, w: 1 } };
        const a = 2 * Math.PI * 1.2 * t;
        return {
          pos: { x: grab.x + 0.4 * Math.cos(a), y: grab.y + 0.1 * Math.sin(2 * a), z: grab.z + 0.4 * Math.sin(a) },
          quat: { x: 0, y: 0, z: 0, w: 1 },
        };
      };
      const m = runGrabScenario({
        world,
        prop: box,
        grabPoint: grab,
        grabNormal: { x: 0, y: 1, z: 0 },
        params,
        tickDt: 1 / 60,
        duration,
        targetAt,
      });
      expect(m.wentNaN).toBe(false);
      expect(m.maxSpeed).toBeLessThan(40);
      expect(m.maxForceMag).toBeLessThanOrEqual(params.maxForce * 1.001);
      expect(m.maxTorqueMag).toBeLessThanOrEqual(params.maxTorque * 1.001);
      // After the target rests, the only residual is gravity sag.
      expect(m.finalPosError).toBeLessThan(sagBound(hz));
      expect(m.finalRotErrorDeg).toBeLessThan(5);
      world.free();
    }, 30000);
  }

  it('converges from a large initial offset without exploding', async () => {
    const { world } = await makeWorld();
    addStatic(world);
    const box = boxInFreeSpace(world);
    const grab = { x: 0, y: 1.725, z: 0 };
    const params = { ...DEFAULT_PARAMS, maxForce: 400 };
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      params,
      tickDt: 1 / 60,
      duration: 3,
      targetAt: scriptAt([
        { t: 0, pos: { x: grab.x + 1.5, y: grab.y + 1.0, z: grab.z } },
        { t: 3, pos: { x: grab.x + 1.5, y: grab.y + 1.0, z: grab.z } },
      ]),
    });
    expect(m.wentNaN).toBe(false);
    expect(m.maxSpeed).toBeLessThan(40);
    expect(m.finalPosError).toBeLessThan(sagBound(DEFAULT_PARAMS.posStiffnessHz));
    world.free();
  }, 30000);
});
