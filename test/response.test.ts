import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics/softGrab';
import { qRotate } from '../src/physics/math3';
import { addStatic, makeWorld, runGrabScenario, scriptAt, spawn } from './helpers';

const G = 9.81;

function freeSpacePlacement(body: { setTranslation: (p: never, w: boolean) => void }, pos: never) {
  body.setTranslation(pos, true);
}

describe('explainable mass and anchor response', () => {
  it('gravity sag matches g/omega^2', async () => {
    const hz = 6;
    const { world } = await makeWorld();
    addStatic(world);
    const box = spawn(world, 'box');
    freeSpacePlacement(box.body, { x: 0, y: 1.5, z: 0 } as never);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const grab = { x: 0, y: 1.725, z: 0 };
    const params = { ...DEFAULT_PARAMS, posStiffnessHz: hz, maxForce: 500 };
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      params,
      tickDt: 1 / 60,
      duration: 2.5,
      targetAt: scriptAt([{ t: 0, pos: grab }, { t: 2.5, pos: grab }]),
    });
    const omega = 2 * Math.PI * hz;
    const sag = G / (omega * omega);
    expect(m.finalPosError).toBeGreaterThan(sag * 0.6);
    expect(m.finalPosError).toBeLessThan(sag * 1.6);
    world.free();
  }, 30000);

  it('respects the force cap: too-weak grip cannot hold the weight', async () => {
    const { world } = await makeWorld();
    addStatic(world);
    const box = spawn(world, 'box');
    freeSpacePlacement(box.body, { x: 0, y: 1.5, z: 0 } as never);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const grab = { x: 0, y: 1.725, z: 0 };
    const weight = 8 * G; // ~78.5 N
    const params = { ...DEFAULT_PARAMS, maxForce: weight * 0.4 };
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      params,
      tickDt: 1 / 60,
      duration: 1.5,
      targetAt: scriptAt([{ t: 0, pos: grab }, { t: 1.5, pos: grab }]),
    });
    expect(m.maxForceMag).toBeLessThanOrEqual(params.maxForce * 1.001);
    // The box sank to the floor because 0.4 * weight cannot hold it.
    expect(box.body.translation().y).toBeLessThan(0.5);
    world.free();
  }, 30000);

  it('heavier props lag more under the same force cap', async () => {
    const runOne = async (name: string, y: number) => {
      const { world } = await makeWorld();
      addStatic(world);
      const prop = spawn(world, name);
      prop.body.setTranslation({ x: 0, y, z: 0 }, true);
      prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const half = name === 'crate' ? 0.3 : 0.225;
      const grab = { x: 0, y: y + half, z: 0 };
      const params = { ...DEFAULT_PARAMS, posStiffnessHz: 6, maxForce: 120 };
      const m = runGrabScenario({
        world,
        prop,
        grabPoint: grab,
        params,
        tickDt: 1 / 60,
        duration: 1.6,
        targetAt: scriptAt([
          { t: 0, pos: grab },
          { t: 0.3, pos: grab },
          { t: 0.55, pos: { x: 0.8, y: grab.y, z: 0 } },
          { t: 1.6, pos: { x: 0.8, y: grab.y, z: 0 } },
        ]),
      });
      const out = { m, world };
      return out;
    };
    const light = await runOne('box', 1.5);
    const heavy = await runOne('crate', 1.5);
    // Acceleration cap is F/m: the 30kg crate must lag the 8kg box clearly.
    expect(heavy.m.maxPosError).toBeGreaterThan(light.m.maxPosError * 1.3);
    light.world.free();
    heavy.world.free();
  }, 60000);

  it('eccentric grip droops by the predictable pendulum angle', async () => {
    // Hammer held horizontally by the handle tip; gravity torque vs the
    // orientation spring gives equilibrium at I*w^2*theta = m*g*d*cos(theta).
    const rotHz = 1.5;
    const { world } = await makeWorld();
    addStatic(world);
    const hammer = spawn(world, 'hammer');
    hammer.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
    hammer.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    hammer.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const grab = { x: -0.4, y: 1.5, z: 0 }; // handle tip, local (-0.4, 0, 0)
    const params = {
      ...DEFAULT_PARAMS,
      posStiffnessHz: 6,
      rotStiffnessHz: rotHz,
      rotDamping: 1.0,
      maxForce: 400,
      maxTorque: 100,
    };
    runGrabScenario({
      world,
      prop: hammer,
      grabPoint: grab,
      grabNormal: { x: -1, y: 0, z: 0 },
      params,
      tickDt: 1 / 60,
      duration: 5,
      targetAt: scriptAt([{ t: 0, pos: grab }, { t: 5, pos: grab }]),
    });
    const q = hammer.body.rotation();
    const xAxis = qRotate(q, { x: 1, y: 0, z: 0 });
    const droop = Math.acos(Math.min(1, Math.max(-1, xAxis.x)));

    // Predicted equilibrium from the physical parameters.
    const mass = hammer.body.mass();
    const comLocal = hammer.body.localCom();
    const d = Math.abs(comLocal.x - -0.4); // COM to anchor, horizontal
    const inertia = hammer.body.effectiveAngularInertia();
    const iCom = inertia.m33; // rotation about z
    const w = 2 * Math.PI * rotHz;
    // Solve I w^2 theta = m g d cos(theta) by bisection.
    const rhs = (mass * G * d) / (iCom * w * w);
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (mid / Math.cos(mid) < rhs) lo = mid;
      else hi = mid;
    }
    const predicted = (lo + hi) / 2;
    expect(droop).toBeGreaterThan(predicted * 0.75);
    expect(droop).toBeLessThan(predicted * 1.25 + 0.02);
    expect(droop).toBeGreaterThan(0.1); // visibly drooped
    world.free();
  }, 30000);

  it('a bar grabbed by its end hangs down when torque is limited', async () => {
    const { world } = await makeWorld();
    addStatic(world);
    const bar = spawn(world, 'bar');
    bar.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
    bar.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bar.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const grab = { x: 1.0, y: 1.5, z: 0 }; // bar end
    const params = {
      ...DEFAULT_PARAMS,
      posStiffnessHz: 6,
      rotDamping: 2.0,
      maxForce: 200,
      maxTorque: 2,
    };
    const verticality: number[] = [];
    runGrabScenario({
      world,
      prop: bar,
      grabPoint: grab,
      grabNormal: { x: 1, y: 0, z: 0 },
      params,
      tickDt: 1 / 60,
      duration: 8,
      targetAt: scriptAt([{ t: 0, pos: grab }, { t: 8, pos: grab }]),
      onStep: (t, body) => {
        if (t > 6) {
          const xAxis = qRotate(body.rotation(), { x: 1, y: 0, z: 0 });
          verticality.push(Math.abs(xAxis.y));
        }
      },
    });
    // With the orientation spring capped at 2 N·m it cannot hold the bar
    // horizontal against a ~19.6 N·m pendulum torque, so the bar swings
    // down and stays mostly vertical on average.
    const mean = verticality.reduce((a, b) => a + b, 0) / verticality.length;
    expect(mean).toBeGreaterThan(0.7);
    world.free();
  }, 30000);
});
