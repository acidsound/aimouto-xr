/**
 * Typed MotionBricks SOMA 77-joint runtime (mirroring mb_runtime.js & NVlabs/motionbricks).
 * Shared between browser scene execution and pure Node unit tests.
 */

export const MB_FPS = 30;
export const MB_POSES_PER_TOKEN = 4;
export const MB_BOUNDARY = 3;
export const MB_MIN_TOKENS = 6;
export const MB_MAX_TOKENS = 16;
export const MB_FEAT = 366;

export const MODEL_JOINTS = [
  0, 1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 24, 25, 26,
  29, 30, 31, 34, 35, 36, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 52, 53,
  54, 57, 58, 59, 62, 63, 64, 67, 68, 69, 70, 72, 73, 74, 75, 7, 8, 9, 10,
  18, 23, 28, 33,
] as const;

/** Single SOMA joint transform: [px, py, pz, qx, qy, qz, qw] */
export type SomaJointPose = [number, number, number, number, number, number, number];
/** Full 77-joint SOMA skeleton pose */
export type SomaPose = SomaJointPose[];

export interface SomaStyleSpec {
  id: string;
  label: string;
  speed: number;
  window: SomaPose[];
}

export interface SomaRuntimeData {
  fps: number;
  joint_names: string[];
  parents: number[];
  reference: SomaPose;
  styles: SomaStyleSpec[];
}

export interface SomaFkResult {
  wp: Array<[number, number, number]>;
  wq: Array<[number, number, number, number]>;
}

export function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatInv(
  q: [number, number, number, number]
): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNorm(
  q: [number, number, number, number]
): [number, number, number, number] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatRotateVec(
  q: [number, number, number, number],
  v: [number, number, number]
): [number, number, number] {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function quatSlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    return quatNorm([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return quatNorm([
    a[0] * s0 + bx * s1,
    a[1] * s0 + by * s1,
    a[2] * s0 + bz * s1,
    a[3] * s0 + bw * s1,
  ]);
}

export function quatYaw(yaw: number): [number, number, number, number] {
  const h = yaw * 0.5;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

export class SomaSkeleton {
  readonly fps: number;
  readonly jointNames: string[];
  readonly parents: number[];
  readonly numJoints: number;
  readonly reference: SomaPose;
  readonly styles: Map<string, SomaStyleSpec>;
  readonly refFk: SomaFkResult;

  constructor(data: SomaRuntimeData) {
    this.fps = data.fps || MB_FPS;
    this.jointNames = data.joint_names;
    this.parents = data.parents;
    this.numJoints = this.jointNames.length;
    this.reference = data.reference;
    this.styles = new Map((data.styles || []).map((s) => [s.id, s]));
    this.refFk = this.fk(this.reference);
  }

  clonePose(pose: SomaPose): SomaPose {
    return pose.map((j) => [...j] as SomaJointPose);
  }

  fk(pose: SomaPose): SomaFkResult {
    const wp: Array<[number, number, number]> = new Array(this.numJoints);
    const wq: Array<[number, number, number, number]> = new Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      const r = pose[i];
      const lp: [number, number, number] = [r[0], r[1], r[2]];
      const lq: [number, number, number, number] = [r[3], r[4], r[5], r[6]];
      const p = this.parents[i];
      if (p < 0) {
        wp[i] = lp;
        wq[i] = lq;
      } else {
        const rp = quatRotateVec(wq[p], lp);
        wp[i] = [wp[p][0] + rp[0], wp[p][1] + rp[1], wp[p][2] + rp[2]];
        wq[i] = quatMul(wq[p], lq);
      }
    }
    return {wp, wq};
  }
}

export class MotionRecorder {
  readonly frames: SomaPose[] = [];

  constructor(private readonly capacity = 90) {}

  record(pose: SomaPose): void {
    this.frames.push(pose.map((j) => [...j] as SomaJointPose));
    if (this.frames.length > this.capacity) {
      this.frames.shift();
    }
  }

  latest(): SomaPose | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  lastN(n = 4): SomaPose[] {
    if (this.frames.length === 0) return [];
    const out = this.frames.slice(-n).map((p) => p.map((j) => [...j] as SomaJointPose));
    while (out.length < n) {
      out.unshift(out[0].map((j) => [...j] as SomaJointPose));
    }
    return out;
  }

  clear(): void {
    this.frames.length = 0;
  }
}

function quatTo6D(q: [number, number, number, number]): [number, number, number, number, number, number] {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
  ];
}

export function encodeSomaFrames(frames: SomaPose[]): Float32Array {
  const T = frames.length;
  const out = new Float32Array(T * MB_FEAT);
  for (let t = 0; t < T; t++) {
    const pose = frames[t];
    const base = t * MB_FEAT;
    for (let k = 0; k < MODEL_JOINTS.length; k++) {
      const ji = MODEL_JOINTS[k] % pose.length;
      const r = pose[ji];
      const d6 = quatTo6D([r[3], r[4], r[5], r[6]]);
      for (let m = 0; m < 6; m++) out[base + k * 6 + m] = d6[m];
    }
    out[base] = pose[0][0];
    out[base + 1] = pose[0][1];
    out[base + 2] = pose[0][2];
  }
  return out;
}

export function decodeSomaFrames(
  sk: SomaSkeleton,
  featSeq: Float32Array,
  startPose?: SomaPose
): SomaPose[] {
  const T = Math.floor(featSeq.length / MB_FEAT);
  const basePose = startPose || sk.reference;
  const frames: SomaPose[] = [];
  for (let t = 0; t < T; t++) {
    const pose = sk.clonePose(basePose);
    const base = t * MB_FEAT;
    pose[0][0] = featSeq[base];
    pose[0][1] = featSeq[base + 1];
    pose[0][2] = featSeq[base + 2];
    frames.push(pose);
  }
  return frames;
}

export function lerpSomaPoses(a: SomaPose, b: SomaPose, alpha: number): SomaPose {
  const t = Math.max(0, Math.min(1, alpha));
  const out: SomaPose = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const ja = a[i];
    const jb = b[i] || ja;
    const nq = quatSlerp([ja[3], ja[4], ja[5], ja[6]], [jb[3], jb[4], jb[5], jb[6]], t);
    out[i] = [
      ja[0] + (jb[0] - ja[0]) * t,
      ja[1] + (jb[1] - ja[1]) * t,
      ja[2] + (jb[2] - ja[2]) * t,
      nq[0],
      nq[1],
      nq[2],
      nq[3],
    ];
  }
  return out;
}

export function smoothSomaFrames(frames: SomaPose[], passes = 1): SomaPose[] {
  let cur = frames.map((f) => f.map((j) => [...j] as SomaJointPose));
  for (let p = 0; p < passes; p++) {
    const next = cur.map((f) => f.map((j) => [...j] as SomaJointPose));
    for (let t = 1; t < cur.length - 1; t++) {
      next[t] = lerpSomaPoses(lerpSomaPoses(cur[t - 1], cur[t + 1], 0.5), cur[t], 0.5);
    }
    cur = next;
  }
  return cur;
}

export function correctEndpoints(
  frames: SomaPose[],
  startPoses: SomaPose[] | null | undefined,
  endWindow: SomaPose[] | null | undefined
): SomaPose[] {
  if (!frames || frames.length === 0) return frames;
  const out = frames.map((f) => f.map((j) => [...j] as SomaJointPose));
  const N = out.length;
  const blendIn = Math.min(MB_BOUNDARY + 2, Math.floor(N * 0.35));
  if (startPoses && startPoses.length > 0 && blendIn > 0) {
    const startRef = startPoses[startPoses.length - 1];
    for (let i = 0; i < blendIn; i++) {
      const alpha = (i + 1) / (blendIn + 1);
      const smooth = alpha * alpha * (3 - 2 * alpha);
      out[i] = lerpSomaPoses(startRef, out[i], smooth);
    }
  }
  const blendOut = Math.min(MB_BOUNDARY + 2, Math.floor(N * 0.35));
  if (endWindow && endWindow.length > 0 && blendOut > 0) {
    const endRef = endWindow[0];
    for (let i = 0; i < blendOut; i++) {
      const idx = N - 1 - i;
      const alpha = (i + 1) / (blendOut + 1);
      const smooth = alpha * alpha * (3 - 2 * alpha);
      out[idx] = lerpSomaPoses(endRef, out[idx], smooth);
    }
  }
  return out;
}

export function sampleSomaFrames(frames: SomaPose[], frameIdx: number): SomaPose | null {
  if (!frames || frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  const clamped = Math.max(0, Math.min(frames.length - 1, frameIdx));
  const lo = Math.floor(clamped);
  const hi = Math.min(frames.length - 1, lo + 1);
  if (lo === hi) return frames[lo];
  return lerpSomaPoses(frames[lo], frames[hi], clamped - lo);
}

/**
 * Places a local SOMA action/primitive window at a world anchor `(worldPos, worldYaw)`.
 * Preserves local root offset `(rx, ry, rz)` rotated by `worldYaw` around Y.
 */
export function placeTarget(
  sk: SomaSkeleton,
  targetWindow: SomaPose[],
  worldPos: [number, number, number],
  worldYaw: number
): SomaPose[] {
  const qy = quatYaw(worldYaw);
  return targetWindow.map((pose) => {
    const copy = sk.clonePose(pose);
    const root = copy[0];
    const [rx, ry, rz] = quatRotateVec(qy, [root[0], root[1], root[2]]);
    const rq = quatMul(qy, [root[3], root[4], root[5], root[6]]);
    copy[0] = [
      worldPos[0] + rx,
      worldPos[1] + ry,
      worldPos[2] + rz,
      rq[0],
      rq[1],
      rq[2],
      rq[3],
    ];
    return copy;
  });
}

/**
 * Synthesizes an endpoint-corrected SOMA 77-joint transition trajectory from a
 * context window to a placed target window (matching the exact [T, 77, 7] contract
 * of `mb_worker.js` ONNX predictions).
 */
export function synthesizeSomaticTransition(
  sk: SomaSkeleton,
  contextPoses: SomaPose[],
  placedTargetWindow: SomaPose[],
  totalFrames: number
): SomaPose[] {
  const N = Math.max(4, Math.round(totalFrames));
  const startPose =
    contextPoses.length > 0
      ? contextPoses[contextPoses.length - 1]
      : sk.styles.get('idle')?.window[0] ?? sk.reference;
  const endWindowLen = Math.min(placedTargetWindow.length, Math.max(1, Math.floor(N * 0.28)));
  const transitionCount = Math.max(2, N - endWindowLen);

  const frames: SomaPose[] = [];
  for (let t = 0; t < transitionCount; t++) {
    const u = (t + 1) / (transitionCount + 1);
    const ease = u * u * (3 - 2 * u);
    const targetSample =
      placedTargetWindow[Math.min(t % placedTargetWindow.length, placedTargetWindow.length - 1)];
    const blended = lerpSomaPoses(startPose, targetSample, ease);
    // Natural mid-transition weight shift & gentle knee bounce
    const midArc = Math.sin(u * Math.PI);
    blended[0][1] -= midArc * 0.018;
    frames.push(blended);
  }
  for (let k = 0; k < endWindowLen; k++) {
    const tw = placedTargetWindow[k % placedTargetWindow.length];
    frames.push(sk.clonePose(tw));
  }

  return correctEndpoints(smoothSomaFrames(frames, 1), contextPoses, placedTargetWindow);
}
