import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics/softGrab';
import { staticBoxByName } from '../src/physics/staticScene';
import { addStatic, makeWorld, runGrabScenario, scriptAt, spawn } from './helpers';

const WALL = staticBoxByName('slideWall'); // center z=5, half thickness 0.2
const WALL_NEAR = WALL.center.z - WALL.halfExtents.z; // 4.8
const WALL_FAR = WALL.center.z + WALL.halfExtents.z; // 5.2
const BOX_HALF = 0.225;

/** Puts the box in front of the slide wall and returns its surface grab point. */
async function boxBeforeWall() {
  const { world } = await makeWorld();
  addStatic(world);
  const box = spawn(world, 'box');
  const start = { x: 0, y: 1.2, z: WALL_NEAR - 1.2 };
  box.body.setTranslation(start, true);
  box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const grab = { x: start.x, y: start.y, z: start.z + BOX_HALF };
  return { world, box, grab };
}

describe('wall interaction', () => {
  it('never pushes the prop through a wall when the target goes through', async () => {
    const { world, box, grab } = await boxBeforeWall();
    const params = { ...DEFAULT_PARAMS, posStiffnessHz: 8, maxForce: 800 };
    const beyond = WALL_FAR + 1.0;
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      grabNormal: { x: 0, y: 0, z: 1 },
      params,
      tickDt: 1 / 60,
      duration: 2.5,
      targetAt: scriptAt([
        { t: 0, pos: grab },
        { t: 0.4, pos: grab },
        { t: 0.9, pos: { x: grab.x, y: grab.y, z: beyond } },
        { t: 2.5, pos: { x: grab.x, y: grab.y, z: beyond } },
      ]),
    });
    expect(m.wentNaN).toBe(false);
    // No tunneling: box center stays on the near side of the wall.
    expect(box.body.translation().z).toBeLessThan(WALL.center.z);
    // No deep penetration (solver allowance is ~1mm).
    expect(m.minContactDist).toBeGreaterThan(-0.004);
    // Follow error is allowed instead of forcing through: the target is
    // more than a meter past the wall, the prop is stuck at the wall face.
    expect(m.finalPosError).toBeGreaterThan(0.8);
    world.free();
  }, 30000);

  it('slides along a wall while pressed against it', async () => {
    const { world, box, grab } = await boxBeforeWall();
    const params = { ...DEFAULT_PARAMS, posStiffnessHz: 6, maxForce: 400 };
    // Target path presses the box against the wall face and drags sideways.
    const pressedZ = WALL_NEAR - BOX_HALF + 0.1;
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      grabNormal: { x: 0, y: 0, z: 1 },
      params,
      tickDt: 1 / 60,
      duration: 3,
      targetAt: scriptAt([
        { t: 0, pos: grab },
        { t: 0.5, pos: { x: grab.x, y: grab.y, z: pressedZ } },
        { t: 2.5, pos: { x: grab.x + 2.0, y: grab.y, z: pressedZ } },
        { t: 3.0, pos: { x: grab.x + 2.0, y: grab.y, z: pressedZ } },
      ]),
    });
    expect(m.wentNaN).toBe(false);
    expect(m.minContactDist).toBeGreaterThan(-0.004);
    const p = box.body.translation();
    // The box slid sideways with the target...
    expect(p.x).toBeGreaterThan(1.2);
    // ...but stayed on the near side of the wall.
    expect(p.z).toBeLessThan(WALL_NEAR);
    world.free();
  }, 30000);

  it('reports growing follow error instead of teleporting to the target', async () => {
    const { world, box, grab } = await boxBeforeWall();
    const params = { ...DEFAULT_PARAMS, posStiffnessHz: 6, maxForce: 300 };
    const beyond = WALL_FAR + 0.6;
    const m = runGrabScenario({
      world,
      prop: box,
      grabPoint: grab,
      grabNormal: { x: 0, y: 0, z: 1 },
      params,
      tickDt: 1 / 60,
      duration: 2,
      targetAt: scriptAt([
        { t: 0, pos: grab },
        { t: 0.3, pos: grab },
        { t: 0.6, pos: { x: grab.x, y: grab.y, z: beyond } },
        { t: 2.0, pos: { x: grab.x, y: grab.y, z: beyond } },
      ]),
    });
    // While blocked, the measured error must be substantial and persistent:
    // this is what the UI surfaces as the desired/actual divergence.
    const tailErrors = m.posErrorSeries.slice(-30);
    const meanTail = tailErrors.reduce((a, b) => a + b, 0) / tailErrors.length;
    expect(meanTail).toBeGreaterThan(0.5);
    world.free();
  }, 30000);
});
