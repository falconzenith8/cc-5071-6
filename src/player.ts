import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export const GROUP_STATIC = 0x1;
export const GROUP_PROP = 0x2;
export const GROUP_PLAYER = 0x4;

export function collisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

const EYE_HEIGHT = 1.6;
const CAPSULE_HALF_HEIGHT = 0.55;
const CAPSULE_RADIUS = 0.35;
const WALK_SPEED = 3.4;
const SPRINT_SPEED = 6.8;
const JUMP_SPEED = 4.6;
const GRAVITY = 9.81;

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  yaw = Math.PI; // face +z at spawn
  pitch = 0;
  private vy = 0;
  private grounded = false;

  private prevEye = new THREE.Vector3();
  private curEye = new THREE.Vector3();
  private prevYaw = this.yaw;
  private prevPitch = 0;
  private curYaw = this.yaw;
  private curPitch = 0;

  readonly keys = new Set<string>();

  constructor(
    R: typeof RAPIER,
    world: RAPIER.World,
    spawn: THREE.Vector3,
  ) {
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS)
        .setCollisionGroups(collisionGroups(GROUP_PLAYER, GROUP_STATIC | GROUP_PROP))
        .setFriction(0.2),
      this.body,
    );
    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.5, 0.25, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.curEye.copy(spawn).y += EYE_HEIGHT - (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);
    this.prevEye.copy(this.curEye);
  }

  look(dx: number, dy: number): void {
    this.curYaw -= dx * 0.0026;
    this.curPitch -= dy * 0.0026;
    const lim = Math.PI / 2 - 0.02;
    this.curPitch = Math.max(-lim, Math.min(lim, this.curPitch));
  }

  snapshot(): void {
    this.prevEye.copy(this.curEye);
    this.prevYaw = this.curYaw;
    this.prevPitch = this.curPitch;
  }

  update(dt: number): void {
    const fwd = new THREE.Vector3(-Math.sin(this.curYaw), 0, -Math.cos(this.curYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(fwd);
    if (this.keys.has('KeyS')) move.sub(fwd);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    if (this.grounded && this.keys.has('Space')) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    this.vy -= GRAVITY * dt;
    this.vy = Math.max(this.vy, -30);

    const pos = this.body.translation();
    const desired = { x: move.x * dt, y: this.vy * dt, z: move.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const mv = this.controller.computedMovement();
    const next = { x: pos.x + mv.x, y: pos.y + mv.y, z: pos.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    if (this.controller.computedGrounded()) {
      this.grounded = true;
      this.vy = Math.min(this.vy, 0);
    } else {
      this.grounded = false;
    }
    this.curEye.set(next.x, next.y + EYE_HEIGHT - (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS), next.z);
  }

  /** Interpolated eye position and view for rendering. */
  renderPose(alpha: number): { eye: THREE.Vector3; yaw: number; pitch: number } {
    return {
      eye: this.prevEye.clone().lerp(this.curEye, alpha),
      yaw: this.prevYaw + (this.curYaw - this.prevYaw) * alpha,
      pitch: this.prevPitch + (this.curPitch - this.prevPitch) * alpha,
    };
  }

  eyePos(): THREE.Vector3 {
    return this.curEye.clone();
  }

  viewQuat(): THREE.Quaternion {
    return quatFromYawPitch(this.curYaw, this.curPitch);
  }
}

export function quatFromYawPitch(yaw: number, pitch: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}
