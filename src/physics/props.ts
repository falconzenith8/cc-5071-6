import type RAPIER from '@dimforge/rapier3d-compat';
import { Q4, V3, qIdentity } from './math3';

export interface PropPart {
  shape: 'cuboid' | 'ball';
  /** Cuboid: full extents. Ball: [diameter, 0, 0]. */
  size: [number, number, number];
  offset: V3;
  density: number;
  color: number;
}

export interface PropSpec {
  name: string;
  label: string;
  parts: PropPart[];
  spawn: { pos: V3; quat?: Q4 };
}

const cuboid = (
  size: [number, number, number],
  offset: V3,
  density: number,
  color: number,
): PropPart => ({ shape: 'cuboid', size, offset, density, color });

export const PROP_SPECS: PropSpec[] = [
  {
    name: 'bar',
    label: '长杆 (2m, 2kg)',
    parts: [cuboid([2.0, 0.08, 0.08], { x: 0, y: 0, z: 0 }, 156.25, 0xcf8a4b)],
    spawn: { pos: { x: -2.2, y: 0.06, z: 1.6 } },
  },
  {
    name: 'box',
    label: '木箱 (0.45m, 8kg)',
    parts: [cuboid([0.45, 0.45, 0.45], { x: 0, y: 0, z: 0 }, 87.8, 0x8a9a5b)],
    spawn: { pos: { x: -0.6, y: 0.24, z: 2.1 } },
  },
  {
    name: 'hammer',
    label: '偏心锤 (质心偏移, 4.4kg)',
    parts: [
      cuboid([0.8, 0.05, 0.05], { x: 0, y: 0, z: 0 }, 228.6, 0xb0a090),
      cuboid([0.22, 0.22, 0.22], { x: 0.51, y: 0, z: 0 }, 375.6, 0x555c66),
    ],
    spawn: { pos: { x: 1.1, y: 0.12, z: 1.7 } },
  },
  {
    name: 'ball',
    label: '皮球 (1kg)',
    parts: [{ shape: 'ball', size: [0.3, 0, 0], offset: { x: 0, y: 0, z: 0 }, density: 70.7, color: 0x4b7fcf }],
    spawn: { pos: { x: 0.35, y: 0.16, z: 1.1 } },
  },
  {
    name: 'crate',
    label: '重箱 (0.6m, 30kg)',
    parts: [cuboid([0.6, 0.6, 0.6], { x: 0, y: 0, z: 0 }, 138.9, 0x7a5c3e)],
    spawn: { pos: { x: 3.0, y: 1.22, z: 2.0 } },
  },
];

export interface PropHandle {
  spec: PropSpec;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
}

export function spawnProp(R: typeof RAPIER, world: RAPIER.World, spec: PropSpec): PropHandle {
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(spec.spawn.pos.x, spec.spawn.pos.y, spec.spawn.pos.z)
    .setRotation(spec.spawn.quat ?? qIdentity())
    .setCcdEnabled(true)
    .setLinearDamping(0.02)
    .setAngularDamping(0.05);
  const body = world.createRigidBody(desc);
  const colliders: RAPIER.Collider[] = [];
  for (const part of spec.parts) {
    let cdesc: RAPIER.ColliderDesc;
    if (part.shape === 'cuboid') {
      cdesc = R.ColliderDesc.cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2);
    } else {
      cdesc = R.ColliderDesc.ball(part.size[0] / 2);
    }
    cdesc
      .setTranslation(part.offset.x, part.offset.y, part.offset.z)
      .setDensity(part.density)
      .setFriction(0.7)
      .setRestitution(0.0);
    colliders.push(world.createCollider(cdesc, body));
  }
  return { spec, body, colliders };
}

export function propMass(spec: PropSpec): number {
  let m = 0;
  for (const p of spec.parts) {
    const v =
      p.shape === 'cuboid'
        ? p.size[0] * p.size[1] * p.size[2]
        : (4 / 3) * Math.PI * Math.pow(p.size[0] / 2, 3);
    m += v * p.density;
  }
  return m;
}
