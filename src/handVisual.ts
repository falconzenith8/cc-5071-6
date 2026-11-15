import * as THREE from 'three';

function buildHandMesh(material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.15), material);
  palm.position.set(0, 0, 0.01);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.075), material);
    finger.position.set(-0.03 + i * 0.02, 0.004, -0.095);
    g.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.06), material);
  thumb.position.set(0.052, 0.0, -0.02);
  thumb.rotation.y = -0.5;
  g.add(thumb);
  return g;
}

/**
 * Visualizes the grip relationship:
 * - ghost hand: where the grip SHOULD be (the constraint target)
 * - solid hand: where the grip actually is (riding the prop's surface point)
 * - tether: error vector between them, colored by magnitude
 */
export class HandVisual {
  readonly ghost: THREE.Group;
  readonly solid: THREE.Group;
  private readonly tether: THREE.Line;
  private readonly tetherGeom: THREE.BufferGeometry;
  private readonly marker: THREE.Mesh;
  private readonly ghostMat: THREE.MeshStandardMaterial;
  private readonly solidMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x59c2e8,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.solidMat = new THREE.MeshStandardMaterial({
      color: 0xe8935a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.ghost = buildHandMesh(this.ghostMat);
    this.solid = buildHandMesh(this.solidMat);
    this.solid.visible = false;
    scene.add(this.ghost, this.solid);

    this.tetherGeom = new THREE.BufferGeometry();
    this.tetherGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tether = new THREE.Line(
      this.tetherGeom,
      new THREE.LineBasicMaterial({ color: 0x6fce6f, transparent: true, opacity: 0.9 }),
    );
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    scene.add(this.tether);

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    this.marker.visible = false;
    scene.add(this.marker);
  }

  setGhostPose(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.ghost.position.copy(pos);
    this.ghost.quaternion.copy(quat);
  }

  setGhostVisible(v: boolean): void {
    this.ghost.visible = v;
  }

  setGrip(
    actualPos: THREE.Vector3 | null,
    actualQuat: THREE.Quaternion | null,
    targetPos: THREE.Vector3,
    error: number,
  ): void {
    if (!actualPos || !actualQuat) {
      this.solid.visible = false;
      this.tether.visible = false;
      this.marker.visible = false;
      return;
    }
    this.solid.visible = true;
    this.solid.position.copy(actualPos);
    this.solid.quaternion.copy(actualQuat);
    this.marker.visible = true;
    this.marker.position.copy(actualPos);

    this.tether.visible = true;
    const attr = this.tetherGeom.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, targetPos.x, targetPos.y, targetPos.z);
    attr.setXYZ(1, actualPos.x, actualPos.y, actualPos.z);
    attr.needsUpdate = true;
    const t = Math.min(1, error / 0.6);
    const c = new THREE.Color(0x6fce6f).lerp(new THREE.Color(0xff5f45), t);
    (this.tether.material as THREE.LineBasicMaterial).color.copy(c);
  }
}
