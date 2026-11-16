import type { GrabSystem } from './grabSystem';
import type { PropHandle } from './physics/props';

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
  log?: boolean;
}

export class UI {
  onToggleGhost: (visible: boolean) => void = () => {};
  onDeleteHeld: () => void = () => {};

  private readonly panel: HTMLElement;
  private readonly help: HTMLElement;
  private readonly toastBox: HTMLElement;
  private readonly lockHint: HTMLElement;
  private readonly crosshair: HTMLElement;
  private constraintCountEl!: HTMLElement;
  private deleteBtn!: HTMLButtonElement;
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly sliders: Array<{ spec: SliderSpec; input: HTMLInputElement; out: HTMLOutputElement }> = [];
  private errorBar!: HTMLElement;

  constructor(private readonly grab: GrabSystem) {
    this.panel = document.getElementById('panel')!;
    this.help = document.getElementById('help')!;
    this.toastBox = document.getElementById('toast')!;
    this.lockHint = document.getElementById('lock-hint')!;
    this.crosshair = document.getElementById('crosshair')!;
    this.buildPanel();
    this.buildHelp();
  }

  toast(msg: string, warn = false): void {
    const el = document.createElement('div');
    el.className = warn ? 'toast-msg warn' : 'toast-msg';
    el.textContent = msg;
    this.toastBox.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  setLocked(locked: boolean): void {
    this.lockHint.classList.toggle('hidden', locked);
  }

  setHover(hover: boolean): void {
    this.crosshair.classList.toggle('hover', hover);
  }

  /** Reflects the active soft-grab constraint count (0 or 1) in the panel. */
  setConstraintCount(count: number): void {
    if (!this.constraintCountEl) return;
    this.constraintCountEl.textContent = `活动约束：${count}`;
    this.constraintCountEl.dataset.active = String(count);
    if (this.deleteBtn) this.deleteBtn.disabled = count === 0;
  }

  private slider(spec: SliderSpec): HTMLElement {
    const row = document.createElement('div');
    row.className = 'slider-row';
    const label = document.createElement('label');
    label.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const out = document.createElement('output');
    const toSlider = (v: number) => (spec.log ? Math.log10(v) : v);
    const fromSlider = (v: number) => (spec.log ? Math.pow(10, v) : v);
    input.value = String(toSlider(spec.get()));
    out.textContent = spec.format(spec.get());
    input.addEventListener('input', () => {
      spec.set(fromSlider(Number(input.value)));
      out.textContent = spec.format(spec.get());
    });
    this.sliders.push({ spec, input, out });
    row.append(label, input, out);
    return row;
  }

  /** Re-reads bound values into the slider widgets (after external changes). */
  refresh(): void {
    for (const { spec, input, out } of this.sliders) {
      const v = spec.get();
      input.value = String(spec.log ? Math.log10(v) : v);
      out.textContent = spec.format(v);
    }
  }

  private toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    row.append(input, document.createTextNode(label));
    return row;
  }

  private buildPanel(): void {
    const p = this.panel;
    const g = this.grab;
    const h3 = (t: string) => {
      const el = document.createElement('h3');
      el.textContent = t;
      return el;
    };

    p.appendChild(h3('约束参数'));
    p.appendChild(
      this.slider({
        label: '位置刚度', min: 0.5, max: 12, step: 0.1,
        get: () => g.params.posStiffnessHz, set: (v) => (g.params.posStiffnessHz = v),
        format: (v) => `${v.toFixed(1)} Hz`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '位置阻尼', min: 0.1, max: 1.5, step: 0.05,
        get: () => g.params.posDamping, set: (v) => (g.params.posDamping = v),
        format: (v) => `ζ ${v.toFixed(2)}`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '旋转刚度', min: 0.5, max: 12, step: 0.1,
        get: () => g.params.rotStiffnessHz, set: (v) => (g.params.rotStiffnessHz = v),
        format: (v) => `${v.toFixed(1)} Hz`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '旋转阻尼', min: 0.1, max: 2, step: 0.05,
        get: () => g.params.rotDamping, set: (v) => (g.params.rotDamping = v),
        format: (v) => `ζ ${v.toFixed(2)}`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '最大力', min: 1, max: 3, step: 0.01, log: true,
        get: () => g.params.maxForce, set: (v) => (g.params.maxForce = v),
        format: (v) => `${v.toFixed(0)} N`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '最大力矩', min: 0, max: 2.3, step: 0.01, log: true,
        get: () => g.params.maxTorque, set: (v) => (g.params.maxTorque = v),
        format: (v) => `${v.toFixed(1)} N·m`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '持握距离', min: 0.6, max: 2.4, step: 0.05,
        get: () => g.handDistance, set: (v) => (g.handDistance = v),
        format: (v) => `${v.toFixed(2)} m`,
      }),
    );
    p.appendChild(
      this.slider({
        label: '释放距离', min: 0, max: 5, step: 0.1,
        get: () => g.breakDistance, set: (v) => (g.breakDistance = v),
        format: (v) => (v === 0 ? '关闭' : `${v.toFixed(1)} m`),
      }),
    );
    p.appendChild(this.toggle('显示幽灵手（期望目标）', () => true, (v) => this.onToggleGhost(v)));

    const lifecycle = document.createElement('div');
    lifecycle.className = 'lifecycle-row';
    this.constraintCountEl = document.createElement('span');
    this.constraintCountEl.className = 'constraint-count';
    this.deleteBtn = document.createElement('button');
    this.deleteBtn.id = 'delete-held-btn';
    this.deleteBtn.type = 'button';
    this.deleteBtn.textContent = '销毁持握道具 (X)';
    this.deleteBtn.disabled = true;
    this.deleteBtn.addEventListener('click', () => this.onDeleteHeld());
    lifecycle.append(this.constraintCountEl, this.deleteBtn);
    p.appendChild(lifecycle);
    this.setConstraintCount(0);

    p.appendChild(h3('持握状态'));
    const kv = document.createElement('div');
    kv.className = 'kv';
    const addKv = (key: string, label: string) => {
      const k = document.createElement('div');
      k.className = 'k';
      k.textContent = label;
      const v = document.createElement('div');
      v.className = 'v';
      v.id = `kv-${key}`;
      v.textContent = '—';
      kv.append(k, v);
      this.readouts.set(key, v);
    };
    addKv('prop', '道具');
    addKv('mass', '质量');
    addKv('com', '质心偏移');
    addKv('anchor', '局部锚点');
    addKv('desired', '期望位置');
    addKv('actual', '实际位置');
    addKv('posErr', '位置误差');
    addKv('rotErr', '姿态误差');
    addKv('force', '施加力');
    addKv('torque', '施加力矩');
    addKv('substeps', '稳定子步');
    addKv('contact', '最小接触距');
    p.appendChild(kv);
    const track = document.createElement('div');
    track.id = 'error-bar-track';
    this.errorBar = document.createElement('div');
    this.errorBar.id = 'error-bar';
    track.appendChild(this.errorBar);
    kv.appendChild(track);
  }

  private buildHelp(): void {
    this.help.innerHTML = [
      '<b>左键</b> 抓取/释放 · <b>滚轮</b> 持握距离 · <b>R+鼠标</b> 旋转道具 · <b>Q/E</b> 翻滚',
      '<b>WASD</b> 移动 · <b>Shift</b> 疾跑 · <b>空格</b> 跳跃 · <b>H</b> 帮助 · <b>X</b> 销毁持握道具 · <b>Esc</b> 释放鼠标',
      '橙手=实际握持点(贴在道具表面) · 蓝手=期望目标 · 连线颜色=跟随误差',
    ].join('<br>');
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  private set(key: string, text: string, cls?: string): void {
    const el = this.readouts.get(key);
    if (!el) return;
    el.textContent = text;
    el.className = cls ? `v ${cls}` : 'v';
  }

  update(heldProp: PropHandle | null): void {
    const g = this.grab;
    const d = g.diag;
    if (!heldProp || !d) {
      for (const key of this.readouts.keys()) this.set(key, '—');
      this.set('prop', '未持握');
      this.errorBar.style.width = '0%';
      return;
    }
    const body = heldProp.body;
    const com = body.localCom();
    const comOff = Math.hypot(com.x, com.y, com.z);
    const a = heldProp ? g.held!.constraint.localAnchor : { x: 0, y: 0, z: 0 };
    const t = g.lastTarget?.pos;
    const aw = d.anchorWorld;
    const f = d.appliedForce;
    const tq = d.appliedTorque;
    const fMag = Math.hypot(f.x, f.y, f.z);
    const tMag = Math.hypot(tq.x, tq.y, tq.z);
    const fmt = (v: { x: number; y: number; z: number }) =>
      `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

    this.set('prop', heldProp.spec.label);
    this.set('mass', `${body.mass().toFixed(1)} kg`);
    this.set('com', `${comOff.toFixed(3)} m`);
    this.set('anchor', fmt(a));
    this.set('desired', t ? fmt(t) : '—');
    this.set('actual', fmt(aw));
    this.set('posErr', `${(d.posError * 100).toFixed(1)} cm`, d.posError > 0.15 ? 'err-bad' : 'err-ok');
    this.set('rotErr', `${d.rotErrorDeg.toFixed(1)} °`, d.rotErrorDeg > 15 ? 'err-bad' : 'err-ok');
    this.set('force', `${fMag.toFixed(0)} N`);
    this.set('torque', `${tMag.toFixed(1)} N·m`);
    this.set('substeps', `${g.substepCount} ×`);
    const cd = g.minContactDist;
    this.set('contact', cd < 0 ? `${(cd * 1000).toFixed(1)} mm` : '≥ 0', cd < -0.001 ? 'err-bad' : undefined);

    const t2 = Math.min(1, d.posError / 0.6);
    this.errorBar.style.width = `${(t2 * 100).toFixed(1)}%`;
    this.errorBar.style.background = t2 < 0.25 ? '#6fce6f' : t2 < 0.6 ? '#e8c45a' : '#ff5f45';
  }
}
