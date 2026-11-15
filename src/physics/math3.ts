// Minimal 3D math for the grab-constraint core. Self-contained so the physics
// core runs identically in the browser app and in headless tests.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Q4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const vClone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const vAdd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vLen = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const vDist = (a: V3, b: V3): number => vLen(vSub(a, b));
export const vNorm = (a: V3): V3 => {
  const l = vLen(a);
  return l > 1e-12 ? vScale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
export const vLerp = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const vClampLen = (a: V3, max: number): V3 => {
  const l = vLen(a);
  return l > max && l > 1e-12 ? vScale(a, max / l) : a;
};

export const qIdentity = (): Q4 => ({ x: 0, y: 0, z: 0, w: 1 });

export const qNorm = (q: Q4): Q4 => {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return l > 1e-12
    ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
    : qIdentity();
};

// Hamilton product: qMul(a, b) applies b first, then a.
export const qMul = (a: Q4, b: Q4): Q4 => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

export const qConj = (q: Q4): Q4 => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export const qRotate = (q: Q4, v: V3): V3 => {
  const u = { x: q.x, y: q.y, z: q.z };
  const uv = vCross(u, v);
  const uuv = vCross(u, uv);
  return vAdd(v, vAdd(vScale(uv, 2 * q.w), vScale(uuv, 2)));
};

export const qFromAxisAngle = (axis: V3, angle: number): Q4 => {
  const n = vNorm(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(h) };
};

// Shortest-arc decomposition: angle in [0, PI].
export const qToAxisAngle = (qIn: Q4): { axis: V3; angle: number } => {
  let q = qNorm(qIn);
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const sinHalf = Math.hypot(q.x, q.y, q.z);
  if (sinHalf < 1e-9) return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
  const angle = 2 * Math.atan2(sinHalf, q.w);
  return {
    axis: { x: q.x / sinHalf, y: q.y / sinHalf, z: q.z / sinHalf },
    angle: Math.min(angle, Math.PI),
  };
};

export const qNlerp = (a: Q4, b: Q4, t: number): Q4 => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  return qNorm({
    x: a.x + (b.x * s - a.x) * t,
    y: a.y + (b.y * s - a.y) * t,
    z: a.z + (b.z * s - a.z) * t,
    w: a.w + (b.w * s - a.w) * t,
  });
};

// Row-major 3x3.
export type Mat3 = Float64Array; // length 9, m[row * 3 + col]

export const m3Zero = (): Mat3 => new Float64Array(9);

export const m3FromQuat = (qIn: Q4): Mat3 => {
  const q = qNorm(qIn);
  const { x, y, z, w } = q;
  const m = m3Zero();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y - z * w);
  m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w);
  m[4] = 1 - 2 * (x * x + z * z);
  m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w);
  m[7] = 2 * (y * z + x * w);
  m[8] = 1 - 2 * (x * x + y * y);
  return m;
};

export const m3MulVec = (m: Mat3, v: V3): V3 => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
});

export const m3Mul = (a: Mat3, b: Mat3): Mat3 => {
  const m = m3Zero();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return m;
};

export const m3Add = (a: Mat3, b: Mat3): Mat3 => {
  const m = m3Zero();
  for (let i = 0; i < 9; i++) m[i] = a[i] + b[i];
  return m;
};

export const m3Scale = (a: Mat3, s: number): Mat3 => {
  const m = m3Zero();
  for (let i = 0; i < 9; i++) m[i] = a[i] * s;
  return m;
};

export const m3Transpose = (a: Mat3): Mat3 => {
  const m = m3Zero();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = a[c * 3 + r];
  return m;
};

// skew(r) such that skew(r) * v = r x v.
export const m3Skew = (r: V3): Mat3 => {
  const m = m3Zero();
  m[1] = -r.z;
  m[2] = r.y;
  m[3] = r.z;
  m[5] = -r.x;
  m[6] = -r.y;
  m[7] = r.x;
  return m;
};

export const m3FromDiag = (x: number, y: number, z: number): Mat3 => {
  const m = m3Zero();
  m[0] = x;
  m[4] = y;
  m[8] = z;
  return m;
};

export const m3Invert = (m: Mat3): Mat3 | null => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const inv = m3Zero();
  const s = 1 / det;
  inv[0] = A * s;
  inv[1] = -(b * i - c * h) * s;
  inv[2] = (b * f - c * e) * s;
  inv[3] = B * s;
  inv[4] = (a * i - c * g) * s;
  inv[5] = -(a * f - c * d) * s;
  inv[6] = C * s;
  inv[7] = -(a * h - b * g) * s;
  inv[8] = (a * e - b * d) * s;
  return inv;
};
