import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics/softGrab';
import { qFromAxisAngle } from '../src/physics/math3';
import { addStatic, makeWorld, runGrabScenario, scriptAt, spawn } from './helpers';

describe('time-step independence', () => {
  it('produces consistent trajectories across tick rates', async () => {
    const runAt = async (tickDt: number) => {
      const { world } = await makeWorld();
      addStatic(world);
      const box = spawn(world, 'box');
      box.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
      box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const grab = { x: 0, y: 1.725, z: 0 };
      const params = { ...DEFAULT_PARAMS, posStiffnessHz: 10, rotStiffnessHz: 8, maxForce: 500 };
      const m = runGrabScenario({
        world,
        prop: box,
        grabPoint: grab,
        params,
        tickDt,
        duration: 2,
        targetAt: scriptAt([
          { t: 0, pos: grab },
          { t: 0.3, pos: grab },
          { t: 0.7, pos: { x: 0.8, y: grab.y + 0.3, z: 0 } },
          { t: 2.0, pos: { x: 0.8, y: grab.y + 0.3, z: 0 } },
        ]),
      });
      const p = box.body.translation();
      const out = { p, maxErr: m.maxPosError, world };
      return out;
    };
    const a = await runAt(1 / 30);
    const b = await runAt(1 / 60);
    const c = await runAt(1 / 120);
    for (const [r1, r2] of [[a, b], [b, c]] as const) {
      const dp = Math.hypot(r1.p.x - r2.p.x, r1.p.y - r2.p.y, r1.p.z - r2.p.z);
      expect(dp).toBeLessThan(0.03);
      const ratio = r1.maxErr > r2.maxErr ? r1.maxErr / r2.maxErr : r2.maxErr / r1.maxErr;
      expect(ratio).toBeLessThan(1.5);
    }
    a.world.free();
    b.world.free();
    c.world.free();
  }, 60000);
});

describe('orientation tracking', () => {
  it('follows a 90-degree hand rotation', async () => {
    const { world } = await makeWorld();
    addStatic(world);
    const box = spawn(world, 'box');
    box.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const grab = { x: 0, y: 1.725, z: 0 };
    const yaw90 = qFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const params = { ...DEFAULT_PARAMS, maxForce: 400, maxTorque: 60 };
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      params,
      tickDt: 1 / 60,
      duration: 2.5,
      targetAt: scriptAt([
        { t: 0, pos: grab, quat: { x: 0, y: 0, z: 0, w: 1 } },
        { t: 0.5, pos: grab, quat: { x: 0, y: 0, z: 0, w: 1 } },
        { t: 1.0, pos: grab, quat: yaw90 },
        { t: 2.5, pos: grab, quat: yaw90 },
      ]),
    });
    expect(m.wentNaN).toBe(false);
    expect(m.finalRotErrorDeg).toBeLessThan(5);
    world.free();
  }, 30000);
});
