import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initRapier } from '../src/physics/rapierInit';
import { buildStaticScene, staticBoxByName } from '../src/physics/staticScene';
import { PROP_SPECS, spawnProp } from '../src/physics/props';
import { Player, collisionGroups } from '../src/player';
import { GrabSystem } from '../src/grabSystem';

const TICK = 1 / 60;

async function makeApp() {
  const R = await initRapier();
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = TICK;
  buildStaticScene(R, world);
  const props = PROP_SPECS.map((s) => spawnProp(R, world, s));
  const player = new Player(R, world, new THREE.Vector3(0, 0.95, -2.5));
  const grab = new GrabSystem(R, world, props);
  return { R, world, props, player, grab };
}

function runTicks(app: Awaited<ReturnType<typeof makeApp>>, n: number) {
  for (let i = 0; i < n; i++) {
    app.player.snapshot();
    app.player.update(TICK);
    app.grab.tick(TICK, app.player.eyePos(), app.player.viewQuat());
  }
}

describe('app integration', () => {
  it('player capsule lands on the floor and walks', async () => {
    const app = await makeApp();
    runTicks(app, 90);
    const eyeY = app.player.eyePos().y;
    expect(eyeY).toBeGreaterThan(1.4);
    expect(eyeY).toBeLessThan(1.8);
    const z0 = app.player.eyePos().z;
    app.player.keys.add('KeyW');
    runTicks(app, 180);
    // Default yaw faces +z. 3s of walking must carry the player well past the
    // low beam at z=-0.5 (the capsule must fit under it).
    expect(app.player.eyePos().z).toBeGreaterThan(z0 + 4.0);
    app.world.free();
  });

  it('player is blocked by walls', async () => {
    const app = await makeApp();
    const wall = staticBoxByName('slideWall');
    app.player.body.setTranslation({ x: 0, y: 0.95, z: wall.center.z - 1.2 }, true);
    runTicks(app, 30);
    app.player.keys.add('KeyW'); // walks +z into the wall
    runTicks(app, 180);
    const z = app.player.eyePos().z;
    // Capsule radius 0.35: eye z must stay below the wall face minus radius.
    expect(z).toBeLessThan(wall.center.z - wall.halfExtents.z - 0.2);
    app.world.free();
  });

  it('grabs a prop under the crosshair, follows the hand, releases cleanly', async () => {
    const app = await makeApp();
    runTicks(app, 30);
    const box = app.props.find((p) => p.spec.name === 'box')!;
    // Place the box right where the hand target is (player faces +z).
    box.body.setTranslation({ x: -0.2, y: 1.4, z: -1.1 }, true);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    runTicks(app, 5);
    const bp = box.body.translation();

    // Aim a camera at the box from the player's eye.
    const eye = app.player.eyePos();
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(eye);
    camera.lookAt(bp.x, bp.y, bp.z);
    camera.updateMatrixWorld(true);

    expect(app.grab.hoveredProp(camera)).toBe(box);
    expect(app.grab.tryGrab(camera)).toBe(true);
    expect(app.grab.isHolding).toBe(true);
    // Held prop must not collide with the player group.
    expect(box.colliders[0].collisionGroups()).toBe(collisionGroups(0x2, 0x3));

    // Walk forward: the box should be carried along.
    const z0 = box.body.translation().z;
    app.player.keys.add('KeyW');
    runTicks(app, 90);
    const dz = box.body.translation().z - z0;
    expect(dz).toBeGreaterThan(1.0);
    expect(app.grab.diag).not.toBeNull();

    app.grab.release();
    expect(app.grab.isHolding).toBe(false);
    expect(box.colliders[0].collisionGroups()).toBe(collisionGroups(0x2, 0x7));
    app.world.free();
  });

  it('rotating the held prop changes its orientation offset', async () => {
    const app = await makeApp();
    runTicks(app, 30);
    const hammer = app.props.find((p) => p.spec.name === 'hammer')!;
    const hp = hammer.body.translation();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(hp.x, hp.y + 0.2, hp.z - 1.4);
    camera.lookAt(hp.x, hp.y, hp.z);
    camera.updateMatrixWorld(true);
    expect(app.grab.tryGrab(camera)).toBe(true);
    const before = { ...app.grab.held!.constraint.rotOffset };
    app.grab.rotateHeld(150, 0);
    const after = app.grab.held!.constraint.rotOffset;
    const dot = before.x * after.x + before.y * after.y + before.z * after.z + before.w * after.w;
    expect(Math.abs(dot)).toBeLessThan(0.999); // actually rotated
    runTicks(app, 120);
    // Still holding and simulating without NaN.
    const p = hammer.body.translation();
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    app.world.free();
  });
});
