import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Mat3,
  Q4,
  V3,
  m3Add,
  m3FromDiag,
  m3FromQuat,
  m3Invert,
  m3Mul,
  m3MulVec,
  m3Scale,
  m3Skew,
  m3Transpose,
  qConj,
  qMul,
  qNorm,
  qRotate,
  qToAxisAngle,
  vAdd,
  vClampLen,
  vCross,
  vLen,
  vScale,
  vSub,
} from './math3';

export interface SoftGrabParams {
  /** Position channel natural frequency, Hz. */
  posStiffnessHz: number;
  /** Position channel damping ratio (1 = critically damped). */
  posDamping: number;
  /** Orientation channel natural frequency, Hz. */
  rotStiffnessHz: number;
  /** Orientation channel damping ratio. */
  rotDamping: number;
  /** Hard cap on applied force, Newtons. */
  maxForce: number;
  /** Hard cap on applied torque, N·m. */
  maxTorque: number;
}

export const DEFAULT_PARAMS: SoftGrabParams = {
  posStiffnessHz: 6,
  posDamping: 0.9,
  rotStiffnessHz: 7,
  rotDamping: 1.0,
  maxForce: 250,
  maxTorque: 30,
};

export interface GrabTarget {
  /** Desired world position of the grabbed surface point. */
  position: V3;
  /** Desired world orientation of the hand. */
  quaternion: Q4;
  /** World velocity of the target, m/s. */
  linVel: V3;
  /** Angular velocity of the target, rad/s. */
  angVel: V3;
}

export interface GrabDiagnostics {
  anchorWorld: V3;
  posError: number;
  rotErrorDeg: number;
  appliedForce: V3;
  appliedTorque: V3;
}

/**
 * Stability limit for the normalized spring: the closed loop is a unit-mass
 * oscillator integrated with symplectic Euler, stable for omega*dt < 2.
 * We keep a wide margin to absorb coupling between the linear and angular
 * channels on eccentric anchors.
 */
export const SAFE_OMEGA_DT = 0.35;
export const MAX_SUBSTEPS = 16;

/**
 * Number of physics substeps needed so that omega*dt_sub <= SAFE_OMEGA_DT
 * for the stiffest channel. Stiffness is specified in physical units (Hz),
 * and substepping keeps the response independent of the outer tick rate.
 */
export function substepsFor(params: SoftGrabParams, dt: number): number {
  const omegaMax = 2 * Math.PI * Math.max(params.posStiffnessHz, params.rotStiffnessHz);
  const n = Math.ceil((omegaMax * dt) / SAFE_OMEGA_DT);
  return Math.min(Math.max(n, 1), MAX_SUBSTEPS);
}

interface SdpLike {
  m11: number;
  m12: number;
  m13: number;
  m21: number;
  m22: number;
  m23: number;
  m31: number;
  m32: number;
  m33: number;
}

function sdpToMat3(m: SdpLike): Mat3 {
  const out = new Float64Array(9);
  out[0] = m.m11;
  out[1] = m.m12;
  out[2] = m.m13;
  out[3] = m.m21;
  out[4] = m.m22;
  out[5] = m.m23;
  out[6] = m.m31;
  out[7] = m.m32;
  out[8] = m.m33;
  return out;
}

/**
 * Effective mass matrix at an anchor point: maps a desired acceleration of
 * that point to the force that produces it, accounting for linear inertia
 * and the rotational inertia coupled through the lever arm r = anchor -
 * centerOfMass. The linear channel is shaped by this so that directions in
 * which rotation helps the point move feel appropriately soft; an isotropic
 * m*I spring would be far too stiff there and would fight the orientation
 * channel on eccentric anchors.
 */
function effectiveMassMatrix(mass: number, invInertiaWorld: Mat3, rWorld: V3): Mat3 | null {
  if (!(mass > 0)) return null;
  const S = m3Skew(rWorld);
  // K = (1/m) I - S * IwInv * S   (since S^T = -S)
  const K = m3Add(
    m3FromDiag(1 / mass, 1 / mass, 1 / mass),
    m3Scale(m3Mul(m3Mul(S, invInertiaWorld), S), -1),
  );
  return m3Invert(K);
}

export class SoftGrabConstraint {
  /** Anchor point in body-local space; rides the prop forever after grab. */
  readonly localAnchor: V3;
  /** Surface normal at grab time, body-local. */
  readonly localNormal: V3;
  /** q_hand^-1 * q_body at grab time: desired body orientation = q_hand * rotOffset. */
  rotOffset: Q4;
  /** q_body^-1 * q_hand at grab time: where the gripping hand sits on the prop. */
  readonly handLocal: Q4;
  /** localAnchor - localCom: lever arm in body-local space, constant. */
  readonly localLever: V3;

  constructor(
    body: RAPIER.RigidBody,
    worldAnchor: V3,
    worldNormal: V3,
    handQuat: Q4,
  ) {
    const p = body.translation();
    const q = qNorm(body.rotation());
    const qInv = qConj(q);
    this.localAnchor = qRotate(qInv, vSub(worldAnchor, p));
    this.localNormal = qRotate(qInv, worldNormal);
    this.rotOffset = qMul(qConj(qNorm(handQuat)), q);
    this.handLocal = qMul(qInv, qNorm(handQuat));
    this.localLever = vSub(this.localAnchor, body.localCom());
  }

  worldAnchor(body: RAPIER.RigidBody): V3 {
    return vAdd(body.translation(), qRotate(qNorm(body.rotation()), this.localAnchor));
  }

  desiredBodyQuat(handQuat: Q4): Q4 {
    return qMul(qNorm(handQuat), this.rotOffset);
  }

  /** World orientation of the gripping hand visual, riding the prop. */
  handWorldQuat(body: RAPIER.RigidBody): Q4 {
    return qMul(qNorm(body.rotation()), this.handLocal);
  }

  /**
   * Computes and applies the constraint forces for one substep.
   * Forces are reset first so callers may step the world repeatedly.
   */
  step(
    body: RAPIER.RigidBody,
    target: GrabTarget,
    params: SoftGrabParams,
    _dt: number,
  ): GrabDiagnostics {
    body.resetForces(true);
    body.resetTorques(true);

    const p = body.translation();
    const q = qNorm(body.rotation());
    const com = body.worldCom();
    const anchorW = vAdd(p, qRotate(q, this.localAnchor));
    const r = vSub(anchorW, com);

    const linVel = body.linvel();
    const angVel = body.angvel();
    const anchorVel = vAdd(linVel, vCross(angVel, r));

    // Two normalized PD channels: a point-effective-mass shaped spring-
    // damper on the anchor point, and a spring-damper on orientation.
    // The shaping matrices (effective mass, inertia) are evaluated at the
    // DESIRED orientation, so for a static target they are constant and
    // the shaped spring is conservative. Evaluating them at the actual
    // orientation lets the spring rectify energy into a tumbling limit
    // cycle on eccentric anchors.
    const omega = 2 * Math.PI * params.posStiffnessHz;
    const e = vSub(target.position, anchorW);
    const ev = vSub(target.linVel, anchorVel);

    const qDes = qMul(qNorm(target.quaternion), this.rotOffset);
    const qErr = qMul(qDes, qConj(q));
    const { axis, angle } = qToAxisAngle(qErr);
    const omegaR = 2 * Math.PI * params.rotStiffnessHz;
    const wErr = vSub(target.angVel, angVel);

    // A rotates actual-frame tensors into the desired frame.
    const A = m3Mul(m3FromQuat(qDes), m3Transpose(m3FromQuat(q)));
    const AT = m3Transpose(A);
    const invInertiaDes = m3Mul(m3Mul(A, sdpToMat3(body.effectiveWorldInvInertia())), AT);
    const inertiaDes = m3Mul(m3Mul(A, sdpToMat3(body.effectiveAngularInertia())), AT);
    const rDes = qRotate(qDes, this.localLever);

    const mEff = effectiveMassMatrix(body.mass(), invInertiaDes, rDes);
    let force: V3 = { x: 0, y: 0, z: 0 };
    if (mEff) {
      const aDes = vAdd(vScale(e, omega * omega), vScale(ev, 2 * params.posDamping * omega));
      force = vClampLen(m3MulVec(mEff, aDes), params.maxForce);
      body.addForceAtPoint(force, anchorW, true);
    }
    const aAng = vAdd(
      vScale(axis, omegaR * omegaR * angle),
      vScale(wErr, 2 * params.rotDamping * omegaR),
    );
    const torque = vClampLen(m3MulVec(inertiaDes, aAng), params.maxTorque);
    body.addTorque(torque, true);

    return {
      anchorWorld: anchorW,
      posError: vLen(e),
      rotErrorDeg: (angle * 180) / Math.PI,
      appliedForce: force,
      appliedTorque: torque,
    };
  }
}

/**
 * Splits one outer tick into substep targets. Positions are interpolated
 * linearly, orientations with nlerp; velocities are finite-differenced once
 * per tick and shared by the substeps.
 */
export class TargetInterpolator {
  private prevPos: V3 = { x: 0, y: 0, z: 0 };
  private prevQuat: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  private curPos: V3 = { x: 0, y: 0, z: 0 };
  private curQuat: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  private linVel: V3 = { x: 0, y: 0, z: 0 };
  private angVel: V3 = { x: 0, y: 0, z: 0 };
  private initialized = false;

  beginTick(pos: V3, quat: Q4, dtTick: number): void {
    if (!this.initialized) {
      this.prevPos = pos;
      this.prevQuat = qNorm(quat);
      this.curPos = pos;
      this.curQuat = qNorm(quat);
      this.linVel = { x: 0, y: 0, z: 0 };
      this.angVel = { x: 0, y: 0, z: 0 };
      this.initialized = true;
      return;
    }
    this.prevPos = this.curPos;
    this.prevQuat = this.curQuat;
    this.curPos = pos;
    this.curQuat = qNorm(quat);
    const dt = Math.max(dtTick, 1e-6);
    this.linVel = vScale(vSub(this.curPos, this.prevPos), 1 / dt);
    const dq = qMul(this.curQuat, qConj(this.prevQuat));
    const { axis, angle } = qToAxisAngle(dq);
    this.angVel = vScale(axis, angle / dt);
  }

  at(alpha: number): GrabTarget {
    return {
      position: vAdd(this.prevPos, vScale(vSub(this.curPos, this.prevPos), alpha)),
      quaternion: qNlerpLocal(this.prevQuat, this.curQuat, alpha),
      linVel: this.linVel,
      angVel: this.angVel,
    };
  }
}

function qNlerpLocal(a: Q4, b: Q4, t: number): Q4 {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  return qNorm({
    x: a.x + (b.x * s - a.x) * t,
    y: a.y + (b.y * s - a.y) * t,
    z: a.z + (b.z * s - a.z) * t,
    w: a.w + (b.w * s - a.w) * t,
  });
}
