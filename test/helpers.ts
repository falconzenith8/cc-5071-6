import RAPIER from '@dimforge/rapier3d-compat';
import { initRapier } from '../src/physics/rapierInit';
import { buildStaticScene } from '../src/physics/staticScene';
import { PROP_SPECS, PropHandle, spawnProp } from '../src/physics/props';
import {
  GrabTarget,
  SoftGrabConstraint,
  SoftGrabParams,
  TargetInterpolator,
  substepsFor,
} from '../src/physics/softGrab';
import { Q4, V3, qNlerp, vLerp } from '../src/physics/math3';

export async function makeWorld(gravity = -9.81): Promise<{ R: typeof RAPIER; world: RAPIER.World }> {
  const R = await initRapier();
  const world = new R.World({ x: 0, y: gravity, z: 0 });
  world.timestep = 1 / 60;
  return { R, world };
}

export function addStatic(world: RAPIER.World): RAPIER.Collider[] {
  return buildStaticScene(RAPIER, world);
}

export function spawn(world: RAPIER.World, name: string): PropHandle {
  const spec = PROP_SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`no prop ${name}`);
  return spawnProp(RAPIER, world, spec);
}

export interface TargetSample {
  pos: V3;
  quat: Q4;
}

/** Piecewise-linear waypoint script for the hand target. */
export function scriptAt(
  keys: Array<{ t: number; pos: V3; quat?: Q4 }>,
): (t: number) => TargetSample {
  const ident: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  return (t: number) => {
    if (t <= keys[0].t) return { pos: keys[0].pos, quat: keys[0].quat ?? ident };
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const alpha = (t - a.t) / Math.max(b.t - a.t, 1e-9);
        return {
          pos: vLerp(a.pos, b.pos, alpha),
          quat: qNlerp(a.quat ?? ident, b.quat ?? ident, alpha),
        };
      }
    }
    const last = keys[keys.length - 1];
    return { pos: last.pos, quat: last.quat ?? ident };
  };
}

export interface ScenarioMetrics {
  maxPosError: number;
  finalPosError: number;
  maxRotErrorDeg: number;
  finalRotErrorDeg: number;
  maxForceMag: number;
  maxTorqueMag: number;
  maxSpeed: number;
  minContactDist: number;
  wentNaN: boolean;
  steps: number;
  posErrorSeries: number[];
  anchorTrail: V3[];
}

export interface ScenarioOptions {
  world: RAPIER.World;
  prop: PropHandle;
  grabPoint: V3;
  grabNormal?: V3;
  params: SoftGrabParams;
  tickDt: number;
  duration: number;
  targetAt: (t: number) => TargetSample;
  /** Extra colliders to include in the penetration scan (defaults to all contacts of the prop). */
  onStep?: (t: number, body: RAPIER.RigidBody) => void;
}

export function runGrabScenario(opts: ScenarioOptions): ScenarioMetrics {
  const { world, prop } = opts;
  const body = prop.body;
  const constraint = new SoftGrabConstraint(
    body,
    opts.grabPoint,
    opts.grabNormal ?? { x: 0, y: 1, z: 0 },
    opts.targetAt(0).quat,
  );
  const interp = new TargetInterpolator();
  const n = substepsFor(opts.params, opts.tickDt);
  const dtSub = opts.tickDt / n;
  world.timestep = dtSub;

  const m: ScenarioMetrics = {
    maxPosError: 0,
    finalPosError: 0,
    maxRotErrorDeg: 0,
    finalRotErrorDeg: 0,
    maxForceMag: 0,
    maxTorqueMag: 0,
    maxSpeed: 0,
    minContactDist: Infinity,
    wentNaN: false,
    steps: 0,
    posErrorSeries: [],
    anchorTrail: [],
  };

  const ticks = Math.round(opts.duration / opts.tickDt);
  let t = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const sample = opts.targetAt(t + opts.tickDt);
    interp.beginTick(sample.pos, sample.quat, opts.tickDt);
    for (let s = 1; s <= n; s++) {
      const target: GrabTarget = interp.at(s / n);
      const diag = constraint.step(body, target, opts.params, dtSub);
      world.step();
      m.steps++;
      m.maxPosError = Math.max(m.maxPosError, diag.posError);
      m.maxRotErrorDeg = Math.max(m.maxRotErrorDeg, diag.rotErrorDeg);
      m.maxForceMag = Math.max(m.maxForceMag, Math.hypot(diag.appliedForce.x, diag.appliedForce.y, diag.appliedForce.z));
      m.maxTorqueMag = Math.max(
        m.maxTorqueMag,
        Math.hypot(diag.appliedTorque.x, diag.appliedTorque.y, diag.appliedTorque.z),
      );
      m.finalPosError = diag.posError;
      m.finalRotErrorDeg = diag.rotErrorDeg;
      const lv = body.linvel();
      m.maxSpeed = Math.max(m.maxSpeed, Math.hypot(lv.x, lv.y, lv.z));
      const tr = body.translation();
      if (!Number.isFinite(tr.x + tr.y + tr.z)) {
        m.wentNaN = true;
        return m;
      }
      for (const col of prop.colliders) {
        world.contactPairsWith(col, (other) => {
          world.contactPair(col, other, (manifold) => {
            for (let i = 0; i < manifold.numContacts(); i++) {
              m.minContactDist = Math.min(m.minContactDist, manifold.contactDist(i));
            }
          });
        });
      }
    }
    m.posErrorSeries.push(m.finalPosError);
    m.anchorTrail.push(constraint.worldAnchor(body));
    opts.onStep?.(t, body);
    t += opts.tickDt;
  }
  return m;
}
