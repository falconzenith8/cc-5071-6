import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PropHandle } from './physics/props';
import {
  DEFAULT_PARAMS,
  GrabDiagnostics,
  SoftGrabConstraint,
  SoftGrabParams,
  TargetInterpolator,
  substepsFor,
} from './physics/softGrab';
import { qFromAxisAngle, qMul } from './physics/math3';
import { GROUP_PLAYER, collisionGroups } from './player';

export interface HandTarget {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

const HAND_RIGHT = 0.22;
const HAND_DOWN = 0.18;
const GRAB_RANGE = 3.2;

export function computeHandTarget(
  eye: THREE.Vector3,
  viewQuat: THREE.Quaternion,
  distance: number,
): HandTarget {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(viewQuat);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(viewQuat);
  const down = new THREE.Vector3(0, -1, 0);
  const pos = eye
    .clone()
    .addScaledVector(fwd, distance)
    .addScaledVector(right, HAND_RIGHT)
    .addScaledVector(down, HAND_DOWN);
  return { pos, quat: viewQuat.clone() };
}

export class GrabSystem {
  params: SoftGrabParams = { ...DEFAULT_PARAMS };
  handDistance = 1.4;
  /** 0 = never auto-release. */
  breakDistance = 0;

  held: { prop: PropHandle; constraint: SoftGrabConstraint } | null = null;
  diag: GrabDiagnostics | null = null;
  minContactDist = 0;
  substepCount = 1;
  lastTarget: HandTarget | null = null;

  onEvent: (msg: string, warn?: boolean) => void = () => {};
  /** Fired whenever a constraint is created or torn down, with the new count. */
  onConstraintCountChange: (count: number) => void = () => {};

  private readonly propByCollider = new Map<number, PropHandle>();
  private readonly interpolator = new TargetInterpolator();

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    props: PropHandle[],
  ) {
    for (const p of props) {
      for (const c of p.colliders) this.propByCollider.set(c.handle, p);
    }
  }

  hoveredProp(camera: THREE.Camera): PropHandle | null {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      GRAB_RANGE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => this.propByCollider.has(c.handle),
    );
    return hit ? (this.propByCollider.get(hit.collider.handle) ?? null) : null;
  }

  tryGrab(camera: THREE.Camera): boolean {
    if (this.held) return false;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      GRAB_RANGE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => this.propByCollider.has(c.handle),
    );
    if (!hit) return false;
    const prop = this.propByCollider.get(hit.collider.handle);
    if (!prop) return false;
    const point = ray.pointAt(hit.timeOfImpact);
    const handQuat = camera.getWorldQuaternion(new THREE.Quaternion());
    const constraint = new SoftGrabConstraint(prop.body, point, hit.normal, handQuat);
    this.held = { prop, constraint };
    this.onConstraintCountChange(1);
    // The held prop must not collide with the player capsule.
    for (const c of prop.colliders) {
      c.setCollisionGroups(collisionGroups(0x2, 0x7 & ~GROUP_PLAYER));
    }
    this.onEvent(`已抓取：${prop.spec.label}`);
    return true;
  }

  release(silent = false): void {
    const held = this.held;
    if (!held) return;
    this.detachHeld();
    if (!silent) this.onEvent(`已释放：${held.prop.spec.label}`);
  }

  /**
   * Tears down an active hold at the physics boundary. Rapier keeps user
   * forces/torques across world.step() until they are explicitly reset, so
   * detaching without clearing them leaves the last constraint force acting
   * on the prop forever. A body removed by another subsystem can no longer
   * accept calls, hence the liveness check.
   */
  private detachHeld(): void {
    const held = this.held;
    if (!held) return;
    // Liveness must be probed through the numeric handle: the JS wrappers of
    // a removed body and its colliders stay cached in the compat layer and
    // are returned even though the native objects are gone, and touching
    // them traps in wasm. External removal frees the whole object at once, so
    // none of its colliders may be touched either.
    const alive = this.world.getRigidBody(held.prop.body.handle) !== null;
    if (alive) {
      for (const c of held.prop.colliders) {
        c.setCollisionGroups(collisionGroups(0x2, 0x7));
      }
      held.prop.body.resetForces(true);
      held.prop.body.resetTorques(true);
    }
    this.held = null;
    this.diag = null;
    this.onConstraintCountChange(0);
  }

  /**
   * Removes a prop from the simulation. A held prop is released through the
   * normal boundary first so its constraint cannot outlive the body, then the
   * colliders are unregistered from the identity maps before Rapier frees
   * them: stale handles are reused by new colliders and would otherwise
   * resolve to the wrong prop.
   * Returns false when the prop is already gone.
   */
  removeProp(prop: PropHandle): boolean {
    if (this.world.getRigidBody(prop.body.handle) === null) return false;
    if (this.held?.prop === prop) this.detachHeld();
    for (const c of prop.colliders) this.propByCollider.delete(c.handle);
    for (const c of prop.colliders) this.world.removeCollider(c, true);
    this.world.removeRigidBody(prop.body);
    return true;
  }

  get isHolding(): boolean {
    return this.held !== null;
  }

  /** Number of active soft-grab constraints (always 0 or 1). */
  get constraintCount(): number {
    return this.held ? 1 : 0;
  }

  /** R + mouse: rotate the held prop relative to the hand (yaw/pitch). */
  rotateHeld(dx: number, dy: number): void {
    if (!this.held) return;
    const c = this.held.constraint;
    const yaw = qFromAxisAngle({ x: 0, y: 1, z: 0 }, -dx * 0.006);
    const pitch = qFromAxisAngle({ x: 1, y: 0, z: 0 }, -dy * 0.006);
    c.rotOffset = qMul(yaw, qMul(pitch, c.rotOffset));
  }

  /** Q/E: roll the held prop. dir = ±1. */
  rollHeld(dir: number, dt: number): void {
    if (!this.held) return;
    const c = this.held.constraint;
    const roll = qFromAxisAngle({ x: 0, y: 0, z: 1 }, dir * 1.6 * dt);
    c.rotOffset = qMul(roll, c.rotOffset);
  }

  tick(dt: number, eye: THREE.Vector3, viewQuat: THREE.Quaternion): void {
    const target = computeHandTarget(eye, viewQuat, this.handDistance);
    this.lastTarget = target;
    // Control events (release/removal) can land between physics ticks. Verify
    // the held body still exists before touching it: a freed handle must end
    // the hold instead of driving a constraint against a dead body.
    if (this.held && this.world.getRigidBody(this.held.prop.body.handle) === null) {
      const label = this.held.prop.spec.label;
      this.detachHeld();
      this.onEvent(`目标已销毁，约束自动解除：${label}`, true);
    }
    if (!this.held) {
      this.substepCount = 1;
      this.world.timestep = dt;
      this.world.step();
      return;
    }
    const { prop, constraint } = this.held;
    this.interpolator.beginTick(target.pos, target.quat, dt);
    const n = substepsFor(this.params, dt);
    this.substepCount = n;
    this.world.timestep = dt / n;
    for (let i = 1; i <= n; i++) {
      this.diag = constraint.step(prop.body, this.interpolator.at(i / n), this.params, dt / n);
      this.world.step();
    }
    this.minContactDist = this.scanContacts(prop);
    if (this.breakDistance > 0 && this.diag && this.diag.posError > this.breakDistance) {
      const label = prop.spec.label;
      this.release(true);
      this.onEvent(`超出可达距离，已释放：${label}`, true);
    }
  }

  private scanContacts(prop: PropHandle): number {
    let min = Infinity;
    for (const col of prop.colliders) {
      this.world.contactPairsWith(col, (other) => {
        this.world.contactPair(col, other, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++) {
            min = Math.min(min, manifold.contactDist(i));
          }
        });
      });
    }
    return min === Infinity ? 0 : min;
  }
}
