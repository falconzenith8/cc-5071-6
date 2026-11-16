/**
 * Re-runnable evidence harness for the constraint-residue fix.
 *
 * Run:  npx vitest run test/grabEvidence.test.ts
 *
 * Prints a METRICS table tying constraint count and prop velocity to the
 * executed lifecycle, then asserts the two guarantees of the fix:
 *   1. after release, no constraint force survives the physics boundary
 *      (zero-gravity velocity is constant apart from the body's damping);
 *   2. a held body destroyed between ticks ends the hold without trapping.
 * The same harness on the pre-fix code reports deltaV ≈ 15.5 m/s and leaves
 * the constraint referencing a dead body (wasm unreachable on the next tick).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initRapier } from '../src/physics/rapierInit';
import { buildStaticScene } from '../src/physics/staticScene';
import { PROP_SPECS, PropHandle, spawnProp } from '../src/physics/props';
import { Player } from '../src/player';
import { GrabSystem } from '../src/grabSystem';

const TICK = 1 / 60;
const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('constraint residue evidence (re-runnable)', () => {
  it('constraint count and velocity across release and destruction', async () => {
    const R = await initRapier();
    const world = new R.World({ x: 0, y: 0, z: 0 });
    world.timestep = TICK;
    buildStaticScene(R, world);
    const props: PropHandle[] = PROP_SPECS.map((s) => spawnProp(R, world, s));
    const player = new Player(R, world, new THREE.Vector3(0, 0.95, -2.5));
    const grab = new GrabSystem(R, world, props);
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) grab.tick(TICK, player.eyePos(), player.viewQuat());
    };
    const log = (line: string) => console.log(`METRICS ${line}`);

    const box = props.find((p) => p.spec.name === 'box')!;
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    tick(5);
    const cam = new THREE.PerspectiveCamera();
    cam.position.copy(player.eyePos());
    const bp = box.body.translation();
    cam.lookAt(bp.x, bp.y, bp.z);
    cam.updateMatrixWorld(true);

    log(`idle      constraintCount=${grab.constraintCount} speed=${speed(box.body.linvel()).toFixed(4)}`);
    grab.tryGrab(cam);
    log(`grabbed   constraintCount=${grab.constraintCount} speed=${speed(box.body.linvel()).toFixed(4)}`);
    tick(30);
    grab.handDistance += 0.8; // load the spring
    tick(6);
    const f = grab.diag!.appliedForce;
    log(`loaded    constraintCount=${grab.constraintCount} speed=${speed(box.body.linvel()).toFixed(4)} forceMag=${Math.hypot(f.x, f.y, f.z).toFixed(2)}`);
    const vAtRelease = { ...box.body.linvel() };
    grab.release();
    log(`released  constraintCount=${grab.constraintCount} speed=${speed(box.body.linvel()).toFixed(4)}`);
    tick(30);
    const vAfter = box.body.linvel();
    const dv = Math.hypot(vAfter.x - vAtRelease.x, vAfter.y - vAtRelease.y, vAfter.z - vAtRelease.z);
    log(`30-tick   constraintCount=${grab.constraintCount} speed=${speed(vAfter).toFixed(4)} deltaV=${dv.toFixed(4)} (no gravity; damping-only envelope)`);
    // Pre-fix: 15.51 m/s. Post-fix the 0.02 linear damping allows ~1%.
    expect(dv).toBeLessThan(0.05);

    // Destruction boundary.
    box.body.setTranslation({ x: 0, y: 1.4, z: -1.1 }, true);
    tick(5);
    grab.tryGrab(cam);
    tick(10);
    log(`re-grabbed constraintCount=${grab.constraintCount}`);
    world.removeRigidBody(box.body);
    let threw = false;
    try {
      tick(5);
    } catch {
      threw = true;
    }
    log(`destroyed constraintCount=${grab.constraintCount} threw=${threw}`);
    expect(threw).toBe(false);
    expect(grab.constraintCount).toBe(0);
    expect(grab.isHolding).toBe(false);
    world.free();
  });
});
