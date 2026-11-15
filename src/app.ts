import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { initRapier } from './physics/rapierInit';
import { STATIC_BOXES, buildStaticScene } from './physics/staticScene';
import { PROP_SPECS, PropHandle, spawnProp } from './physics/props';
import { Player, quatFromYawPitch } from './player';
import { GrabSystem, computeHandTarget } from './grabSystem';
import { HandVisual } from './handVisual';
import { UI } from './ui';

const TICK_DT = 1 / 60;

interface PropVisual {
  handle: PropHandle;
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  prevPos: THREE.Vector3;
  curPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  curQuat: THREE.Quaternion;
}

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly player: Player;
  private readonly grab: GrabSystem;
  private readonly hand = new HandVisual(this.scene);
  private readonly ui: UI;
  private readonly propVisuals: PropVisual[] = [];
  private readonly keys = new Set<string>();
  private acc = 0;
  private lastTime = 0;
  private hovered: PropHandle | null = null;

  private constructor(
    container: HTMLElement,
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
    this.scene.background = new THREE.Color(0x1a1e26);
    this.scene.fog = new THREE.Fog(0x1a1e26, 18, 55);

    this.buildLights();
    this.buildStaticMeshes();

    const props = PROP_SPECS.map((spec) => spawnProp(this.R, this.world, spec));
    for (const handle of props) this.addPropVisual(handle);

    this.player = new Player(this.R, this.world, new THREE.Vector3(0, 0.95, -2.5));
    this.grab = new GrabSystem(this.R, this.world, props);
    this.ui = new UI(this.grab);
    this.grab.onEvent = (msg, warn) => this.ui.toast(msg, warn);
    this.ui.onToggleGhost = (v) => this.hand.setGhostVisible(v);

    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
  }

  static async create(container: HTMLElement): Promise<App> {
    const R = await initRapier();
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = TICK_DT;
    buildStaticScene(R, world);
    return new App(container, R, world);
  }

  start(): void {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0x8fb4d8, 0x3a3630, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.8);
    sun.position.set(6, 11, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private buildStaticMeshes(): void {
    for (const box of STATIC_BOXES) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2),
        new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.92 }),
      );
      mesh.position.set(box.center.x, box.center.y, box.center.z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    const grid = new THREE.GridHelper(24, 24, 0x2c3440, 0x232a34);
    grid.position.y = 0.002;
    this.scene.add(grid);
  }

  private addPropVisual(handle: PropHandle): void {
    const group = new THREE.Group();
    const materials: THREE.MeshStandardMaterial[] = [];
    for (const part of handle.spec.parts) {
      const mat = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.75 });
      materials.push(mat);
      const mesh =
        part.shape === 'cuboid'
          ? new THREE.Mesh(new THREE.BoxGeometry(...part.size), mat)
          : new THREE.Mesh(new THREE.SphereGeometry(part.size[0] / 2, 24, 16), mat);
      mesh.position.set(part.offset.x, part.offset.y, part.offset.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const p = handle.body.translation();
    const q = handle.body.rotation();
    group.position.set(p.x, p.y, p.z);
    group.quaternion.set(q.x, q.y, q.z, q.w);
    this.scene.add(group);
    this.propVisuals.push({
      handle,
      group,
      materials,
      prevPos: group.position.clone(),
      curPos: group.position.clone(),
      prevQuat: group.quaternion.clone(),
      curQuat: group.quaternion.clone(),
    });
  }

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
      }
      if (this.grab.isHolding) this.grab.release();
      else this.grab.tryGrab(this.camera);
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      this.ui.setLocked(locked);
      if (!locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (this.grab.isHolding && this.keys.has('KeyR')) {
        this.grab.rotateHeld(e.movementX, e.movementY);
      } else {
        this.player.look(e.movementX, e.movementY);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') {
        this.ui.toggleHelp();
        return;
      }
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener(
      'wheel',
      (e) => {
        if (document.pointerLockElement !== canvas) return;
        this.grab.handDistance = Math.min(2.4, Math.max(0.6, this.grab.handDistance + Math.sign(e.deltaY) * 0.1));
        this.ui.refresh();
      },
      { passive: true },
    );
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.tick(TICK_DT);
      this.acc -= TICK_DT;
    }
    this.render(this.acc / TICK_DT);
  }

  private tick(dt: number): void {
    for (const pv of this.propVisuals) {
      pv.prevPos.copy(pv.curPos);
      pv.prevQuat.copy(pv.curQuat);
    }
    this.player.snapshot();
    this.player.keys.clear();
    for (const k of this.keys) this.player.keys.add(k);
    this.player.update(dt);

    if (this.keys.has('KeyQ')) this.grab.rollHeld(1, dt);
    if (this.keys.has('KeyE')) this.grab.rollHeld(-1, dt);

    this.grab.tick(dt, this.player.eyePos(), this.player.viewQuat());

    for (const pv of this.propVisuals) {
      const p = pv.handle.body.translation();
      const q = pv.handle.body.rotation();
      pv.curPos.set(p.x, p.y, p.z);
      pv.curQuat.set(q.x, q.y, q.z, q.w);
    }
  }

  private render(alpha: number): void {
    const pose = this.player.renderPose(alpha);
    this.camera.position.copy(pose.eye);
    this.camera.quaternion.copy(quatFromYawPitch(pose.yaw, pose.pitch));

    for (const pv of this.propVisuals) {
      pv.group.position.lerpVectors(pv.prevPos, pv.curPos, alpha);
      pv.group.quaternion.slerpQuaternions(pv.prevQuat, pv.curQuat, alpha);
    }

    // Hover highlight (only when it would change).
    this.hovered = this.grab.isHolding ? null : this.grab.hoveredProp(this.camera);
    for (const pv of this.propVisuals) {
      const isHeld = this.grab.held?.prop === pv.handle;
      const isHover = this.hovered === pv.handle;
      const emissive = isHeld ? 0x2a3d1e : isHover ? 0x1e3242 : 0x000000;
      for (const m of pv.materials) m.emissive.setHex(emissive);
    }
    this.ui.setHover(this.hovered !== null);

    // Hand visuals.
    const target = computeHandTarget(pose.eye, this.camera.quaternion, this.grab.handDistance);
    this.hand.setGhostPose(target.pos, target.quat);
    if (this.grab.held) {
      const pv = this.propVisuals.find((v) => v.handle === this.grab.held!.prop)!;
      const c = this.grab.held.constraint;
      const anchor = new THREE.Vector3(c.localAnchor.x, c.localAnchor.y, c.localAnchor.z)
        .applyQuaternion(pv.group.quaternion)
        .add(pv.group.position);
      const handQuat = pv.group.quaternion
        .clone()
        .multiply(new THREE.Quaternion(c.handLocal.x, c.handLocal.y, c.handLocal.z, c.handLocal.w));
      this.hand.setGrip(anchor, handQuat, target.pos, this.grab.diag?.posError ?? 0);
    } else {
      this.hand.setGrip(null, null, target.pos, 0);
    }

    this.ui.update(this.grab.held?.prop ?? null);
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
