import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initRapier } from '../src/physics/rapierInit';
import { buildStaticScene } from '../src/physics/staticScene';
import { PROP_SPECS, PropHandle, spawnProp } from '../src/physics/props';
import { Player } from '../src/player';
import { GrabSystem } from '../src/grabSystem';

const TICK = 1 / 60;

interface Rig {
  R: typeof import('@dimforge/rapier3d-compat').default;
  world: import('@dimforge/rapier3d-compat').World;
  props: PropHandle[];
  player: Player;
  grab: GrabSystem;
}

async function makeRig(gravity = 0): Promise<Rig> {
  const R = await initRapier();
  const world = new R.World({ x: 0, y: gravity, z: 0 });
  world.timestep = TICK;
  buildStaticScene(R, world);
  const props = PROP_SPECS.map((s) => spawnProp(R, world, s));
  const player = new Player(R, world, new THREE.Vector3(0, 0.95, -2.5));
  const grab = new GrabSystem(R, world, props);
  return { R, world, props, player, grab };
}

function runTicks(rig: Rig, n: number): void {
  for (let i = 0; i < n; i++) {
    rig.grab.tick(TICK, rig.player.eyePos(), rig.player.viewQuat());
  }
}

function aimAt(rig: Rig, prop: PropHandle): THREE.PerspectiveCamera {
  const p = prop.body.translation();
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(rig.player.eyePos());
  camera.lookAt(p.x, p.y, p.z);
  camera.updateMatrixWorld(true);
  return camera;
}

const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('minimal repro: constraint residue after grab cancellation', () => {
  it('releasing a grab removes the constraint and stops every constraint force', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);

    expect(rig.grab.tryGrab(aimAt(rig, box))).toBe(true);
    expect(rig.grab.constraintCount).toBe(1);
    runTicks(rig, 30); // settle at the hand target in zero gravity

    // Yank the hand target away so the PD spring is provably under load.
    rig.grab.handDistance += 0.8;
    runTicks(rig, 6);
    const f = rig.grab.diag!.appliedForce;
    const fMag = Math.hypot(f.x, f.y, f.z);
    expect(fMag).toBeGreaterThan(20);
    const v0 = { ...box.body.linvel() };
    expect(speed(v0)).toBeGreaterThan(0.05); // prop is being dragged

    rig.grab.release();
    expect(rig.grab.isHolding).toBe(false);
    expect(rig.grab.constraintCount).toBe(0);

    runTicks(rig, 30);
    const v1 = box.body.linvel();
    const dv = Math.hypot(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
    // No gravity in this rig: any velocity change is residual constraint work.
    expect(dv).toBeLessThan(0.05);
    rig.world.free();
  });

  it('auto-release through the reach limit uses the same clean boundary', async () => {
    const rig = await makeRig(0);
    const ball = rig.props.find((p) => p.spec.name === 'ball')!;
    ball.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);

    expect(rig.grab.tryGrab(aimAt(rig, ball))).toBe(true);
    runTicks(rig, 20);
    rig.grab.breakDistance = 0.05;
    rig.grab.handDistance = 2.4; // target jumps well beyond the reach limit
    runTicks(rig, 30);

    expect(rig.grab.isHolding).toBe(false);
    expect(rig.grab.constraintCount).toBe(0);
    const v0 = { ...ball.body.linvel() };
    runTicks(rig, 30);
    const v1 = ball.body.linvel();
    expect(Math.hypot(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z)).toBeLessThan(0.05);
    rig.world.free();
  });
});

describe('minimal repro: constraint residue after target destruction', () => {
  it('survives external destruction of the held body at the physics boundary', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);

    expect(rig.grab.tryGrab(aimAt(rig, box))).toBe(true);
    runTicks(rig, 20);

    // Another subsystem destroys the body between two physics ticks.
    rig.world.removeRigidBody(box.body);
    expect(() => runTicks(rig, 5)).not.toThrow();
    expect(rig.grab.isHolding).toBe(false);
    expect(rig.grab.constraintCount).toBe(0);
    rig.world.free();
  });

  it('removeProp releases the hold before freeing the body and clears identity maps', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);

    expect(rig.grab.tryGrab(aimAt(rig, box))).toBe(true);
    runTicks(rig, 10);
    expect(rig.grab.constraintCount).toBe(1);

    expect(rig.grab.removeProp(box)).toBe(true);
    expect(rig.grab.constraintCount).toBe(0);
    expect(rig.grab.isHolding).toBe(false);
    // Liveness is queried by numeric handle: the freed JS wrapper object stays
    // cached in the compat layer, but handle lookup correctly reports null.
    expect(rig.world.getRigidBody(box.body.handle)).toBeNull();
    // Stale collider handles must not resolve back to the destroyed prop:
    // a ray toward another, still-living prop must not return the dead one.
    const ball = rig.props.find((p) => p.spec.name === 'ball')!;
    ball.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 3); // refresh the query pipeline after removal
    expect(rig.grab.hoveredProp(aimAt(rig, ball))).toBe(ball);
    expect(() => runTicks(rig, 5)).not.toThrow();
    // Repeated removal is a reported failure, not a crash.
    expect(rig.grab.removeProp(box)).toBe(false);
    rig.world.free();
  });

  it('a body spawned after removal is never mistaken for the destroyed held prop', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);
    expect(rig.grab.removeProp(box)).toBe(true);

    const fresh = spawnProp(rig.R, rig.world, PROP_SPECS.find((s) => s.name === 'ball')!);
    expect(() => runTicks(rig, 10)).not.toThrow();
    expect(rig.grab.isHolding).toBe(false);
    expect(rig.grab.constraintCount).toBe(0);
    const p = fresh.body.translation();
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    rig.world.free();
  });
});

describe('grab lifecycle boundary regressions', () => {
  it('release / re-grab cycles rebuild and tear down the constraint every time', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);

    for (let cycle = 0; cycle < 2; cycle++) {
      expect(rig.grab.tryGrab(aimAt(rig, box))).toBe(true);
      expect(rig.grab.constraintCount).toBe(1);
      rig.grab.handDistance = 1.4 + cycle * 0.4;
      runTicks(rig, 15);
      const v0 = { ...box.body.linvel() };
      rig.grab.release();
      expect(rig.grab.constraintCount).toBe(0);
      runTicks(rig, 15);
      const v1 = box.body.linvel();
      expect(Math.hypot(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z)).toBeLessThan(0.05);
    }
    rig.world.free();
  });

  it('continuous contact limits still hold while the constraint is active', async () => {
    const rig = await makeRig(-9.81);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    // Grab point just above the floor, then drive the hand target into it.
    box.body.setTranslation({ x: 0, y: 0.3, z: 0 }, true);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    runTicks(rig, 5);

    expect(rig.grab.tryGrab(aimAt(rig, box))).toBe(true);
    rig.grab.handDistance = 0.6;
    runTicks(rig, 60);

    expect(rig.grab.minContactDist).toBeGreaterThan(-0.004);
    const p = box.body.translation();
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    expect(p.y).toBeGreaterThan(0.15); // never pushed through the floor
    rig.grab.release();
    rig.world.free();
  });

  it('release under gravity leaves only gravity: no spring force survives the boundary', async () => {
    const rig = await makeRig(-9.81);
    const ball = rig.props.find((p) => p.spec.name === 'ball')!;
    // High, clear air inside the 3.2 m grab range; 30 post-release ticks
    // (0.5 s, ~1.2 m of fall) cannot reach the floor.
    ball.body.setTranslation({ x: 0, y: 3.4, z: -1.6 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    runTicks(rig, 5);
    expect(rig.grab.tryGrab(aimAt(rig, ball))).toBe(true);
    runTicks(rig, 90); // settle: the spring holds it against gravity, then goes quiet
    expect(rig.grab.constraintCount).toBe(1);
    const vHold = ball.body.linvel();
    expect(Math.hypot(vHold.x, vHold.y, vHold.z)).toBeLessThan(0.05);

    rig.grab.release();
    expect(rig.grab.constraintCount).toBe(0);
    const v0 = { ...ball.body.linvel() };
    const OBSERVE = 12; // 0.2 s: ~0.2 m fall, nowhere near the floor from y~1.4
    runTicks(rig, OBSERVE);
    const v1 = ball.body.linvel();
    // Horizontal channels feel no gravity: a surviving spring would push the
    // ball sideways (the pre-fix residue test measured 15 m/s). They must
    // stay at rest apart from the body's 0.02 damping.
    expect(Math.hypot(v1.x, v1.z)).toBeLessThan(0.02);
    // Vertical channel matches gravity integration under the same damping.
    const decay = Math.exp(-0.02 * OBSERVE * TICK);
    const expectedVy = v0.y * decay - 9.81 * (OBSERVE * TICK);
    expect(Math.abs(v1.y - expectedVy)).toBeLessThan(9.81 * (OBSERVE * TICK) * 0.03);
    expect(ball.body.translation().y).toBeGreaterThan(1.0); // never reached the floor
    rig.world.free();
  });
});

describe('constraint residue boundary hardening', () => {
  it('double release is idempotent and keeps the collider filter restored', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);
    rig.grab.release();
    expect(rig.grab.constraintCount).toBe(0);
    const groups = box.colliders[0].collisionGroups();
    expect(() => rig.grab.release()).not.toThrow(); // already detached
    expect(rig.grab.constraintCount).toBe(0);
    expect(box.colliders[0].collisionGroups()).toBe(groups);
    rig.world.free();
  });

  it('events landing between physics ticks never leave a stale substep timestep', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);
    expect(rig.world.timestep).not.toBe(TICK); // substepping while held

    rig.grab.release(); // control event with no tick in between
    runTicks(rig, 2);
    expect(rig.world.timestep).toBeCloseTo(TICK);

    // And again across the external-destruction path.
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 3);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);
    rig.world.removeRigidBody(box.body);
    runTicks(rig, 2);
    expect(rig.grab.constraintCount).toBe(0);
    expect(rig.world.timestep).toBeCloseTo(TICK);
    rig.world.free();
  });

  it('auto-release at the reach limit clears the spring force, not just the reference', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);
    rig.grab.breakDistance = 0.05;
    rig.grab.handDistance = 2.4;
    runTicks(rig, 30);
    expect(rig.grab.isHolding).toBe(false);
    const v0 = { ...box.body.linvel() };
    runTicks(rig, 30);
    const v1 = box.body.linvel();
    expect(Math.hypot(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z)).toBeLessThan(0.05);
    rig.world.free();
  });

  it('removeProp on a non-held prop leaves the active hold untouched', async () => {
    const rig = await makeRig(0);
    const box = rig.props.find((p) => p.spec.name === 'box')!;
    const ball = rig.props.find((p) => p.spec.name === 'ball')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    ball.body.setTranslation({ x: 2, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, box));
    runTicks(rig, 10);

    expect(rig.grab.removeProp(ball)).toBe(true);
    expect(rig.grab.constraintCount).toBe(1);
    expect(rig.grab.held?.prop).toBe(box);
    expect(rig.world.getRigidBody(ball.body.handle)).toBeNull();
    // The surviving hold still simulates and tracks.
    runTicks(rig, 20);
    expect(rig.grab.isHolding).toBe(true);
    expect(Number.isFinite(box.body.translation().y)).toBe(true);
    rig.grab.release();
    rig.world.free();
  });

  it('deleting a held multi-collider prop cleans every collider identity entry', async () => {
    const rig = await makeRig(0);
    const hammer = rig.props.find((p) => p.spec.name === 'hammer')!;
    expect(hammer.colliders.length).toBe(2);
    hammer.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    runTicks(rig, 5);
    rig.grab.tryGrab(aimAt(rig, hammer));
    runTicks(rig, 10);
    const handles = hammer.colliders.map((c) => c.handle);

    expect(rig.grab.removeProp(hammer)).toBe(true);
    expect(rig.grab.constraintCount).toBe(0);
    for (const h of handles) expect(rig.world.getCollider(h)).toBeNull();
    expect(() => runTicks(rig, 10)).not.toThrow();
    rig.world.free();
  });
});
