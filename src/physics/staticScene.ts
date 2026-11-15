import type RAPIER from '@dimforge/rapier3d-compat';
import { V3 } from './math3';

export interface StaticBox {
  name: string;
  center: V3;
  halfExtents: V3;
  color: number;
}

/**
 * Static level geometry, shared by the app (rendering + colliders) and the
 * headless tests (colliders + analytic penetration checks).
 */
export const STATIC_BOXES: StaticBox[] = [
  { name: 'floor', center: { x: 0, y: -0.1, z: 0 }, halfExtents: { x: 12, y: 0.1, z: 12 }, color: 0x3d434d },
  { name: 'wallN', center: { x: 0, y: 1.5, z: 12 }, halfExtents: { x: 12, y: 1.5, z: 0.2 }, color: 0x4a5160 },
  { name: 'wallS', center: { x: 0, y: 1.5, z: -12 }, halfExtents: { x: 12, y: 1.5, z: 0.2 }, color: 0x4a5160 },
  { name: 'wallE', center: { x: 12, y: 1.5, z: 0 }, halfExtents: { x: 0.2, y: 1.5, z: 12 }, color: 0x4a5160 },
  { name: 'wallW', center: { x: -12, y: 1.5, z: 0 }, halfExtents: { x: 0.2, y: 1.5, z: 12 }, color: 0x4a5160 },
  // Free-standing wall for push/slide tests.
  { name: 'slideWall', center: { x: 0, y: 1.5, z: 5 }, halfExtents: { x: 4, y: 1.5, z: 0.2 }, color: 0x6b5f4a },
  // Doorway: two pillars + lintel, gap ~1.8m wide, 2.2m high.
  { name: 'pillarL', center: { x: -1.9, y: 1.5, z: -4 }, halfExtents: { x: 0.9, y: 1.5, z: 0.2 }, color: 0x4a5160 },
  { name: 'pillarR', center: { x: 1.9, y: 1.5, z: -4 }, halfExtents: { x: 0.9, y: 1.5, z: 0.2 }, color: 0x4a5160 },
  { name: 'lintel', center: { x: 0, y: 2.65, z: -4 }, halfExtents: { x: 1.0, y: 0.35, z: 0.2 }, color: 0x4a5160 },
  // Low beam to catch long props carried upright. Bottom at 1.94m: the player
  // capsule (1.8m + 0.05 controller offset) walks under it; a 2m bar held
  // upright at hand height (top ~2.4m) does not.
  { name: 'beam', center: { x: 0, y: 2.0, z: -0.5 }, halfExtents: { x: 3, y: 0.06, z: 0.15 }, color: 0x715a3a },
  // Solid table block the heavy crate sits on.
  { name: 'table', center: { x: 3.0, y: 0.45, z: 2.0 }, halfExtents: { x: 1.0, y: 0.45, z: 0.6 }, color: 0x54503f },
];

export function buildStaticScene(R: typeof RAPIER, world: RAPIER.World): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  for (const box of STATIC_BOXES) {
    const desc = R.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
      .setTranslation(box.center.x, box.center.y, box.center.z)
      .setFriction(0.7)
      .setRestitution(0.0);
    colliders.push(world.createCollider(desc));
  }
  return colliders;
}

export function staticBoxByName(name: string): StaticBox {
  const box = STATIC_BOXES.find((b) => b.name === name);
  if (!box) throw new Error(`unknown static box: ${name}`);
  return box;
}
