// MotionBricks Browser SOMA 77-Joint Runtime (compatible with NVlabs/motionbricks & monoradio/motionbricks-live)
export const FPS = 30;
export const POSES_PER_TOKEN = 4;
export const BOUNDARY = 3;
export const MIN_TOKENS = 6;
export const MAX_TOKENS = 16;
export const FEAT = 366;

// 61-joint core subset used by MotionBricks VQ/MMM tokenizer (61 * 6 = 366 features)
export const MODEL_JOINTS = [
  0, 1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 24, 25, 26,
  29, 30, 31, 34, 35, 36, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 52, 53,
  54, 57, 58, 59, 62, 63, 64, 67, 68, 69, 70, 72, 73, 74, 75, 7, 8, 9, 10,
  18, 23, 28, 33,
];

function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qRot(q, v) {
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

function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function qSlerp(a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    return qNorm([
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
  return qNorm([
    a[0] * s0 + bx * s1,
    a[1] * s0 + by * s1,
    a[2] * s0 + bz * s1,
    a[3] * s0 + bw * s1,
  ]);
}

function qYaw(yaw) {
  const h = yaw * 0.5;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

export class Skeleton {
  constructor(data) {
    this.fps = data.fps || FPS;
    this.jointNames = data.joint_names;
    this.parents = data.parents;
    this.numJoints = this.jointNames.length;
    this.reference = data.reference;
    this.styles = new Map((data.styles || []).map((s) => [s.id, s]));
    this.refFk = this.fk(this.reference);
  }

  clonePose(pose) {
    return pose.map((j) => j.slice());
  }

  fk(pose) {
    const wp = new Array(this.numJoints);
    const wq = new Array(this.numJoints);
    for (let i = 0; i < this.numJoints; i++) {
      const r = pose[i];
      const lp = [r[0], r[1], r[2]];
      const lq = [r[3], r[4], r[5], r[6]];
      const p = this.parents[i];
      if (p < 0) {
        wp[i] = lp;
        wq[i] = lq;
      } else {
        const rp = qRot(wq[p], lp);
        wp[i] = [wp[p][0] + rp[0], wp[p][1] + rp[1], wp[p][2] + rp[2]];
        wq[i] = qMul(wq[p], lq);
      }
    }
    return {wp, wq};
  }
}

export class Recorder {
  constructor(capacity = 90) {
    this.capacity = capacity;
    this.frames = [];
  }

  record(pose) {
    this.frames.push(pose.map((j) => j.slice()));
    if (this.frames.length > this.capacity) {
      this.frames.shift();
    }
  }

  latest() {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  lastN(n = 4) {
    if (this.frames.length === 0) return [];
    const out = this.frames.slice(-n);
    while (out.length < n) {
      out.unshift(out[0].map((j) => j.slice()));
    }
    return out;
  }

  clear() {
    this.frames.length = 0;
  }
}

function quatTo6D(q) {
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

export function encode(sk, frames) {
  const T = frames.length;
  const out = new Float32Array(T * FEAT);
  for (let t = 0; t < T; t++) {
    const pose = frames[t];
    const base = t * FEAT;
    for (let k = 0; k < MODEL_JOINTS.length; k++) {
      const ji = MODEL_JOINTS[k] % pose.length;
      const r = pose[ji];
      const d6 = quatTo6D([r[3], r[4], r[5], r[6]]);
      for (let m = 0; m < 6; m++) out[base + k * 6 + m] = d6[m];
    }
    if (T > 0) {
      out[base] = pose[0][0];
      out[base + 1] = pose[0][1];
      out[base + 2] = pose[0][2];
    }
  }
  return out;
}

export function decode(sk, featSeq, startPose) {
  const T = Math.floor(featSeq.length / FEAT);
  const basePose = startPose || sk.reference;
  const frames = [];
  for (let t = 0; t < T; t++) {
    const pose = sk.clonePose(basePose);
    const base = t * FEAT;
    pose[0][0] = featSeq[base];
    pose[0][1] = featSeq[base + 1];
    pose[0][2] = featSeq[base + 2];
    frames.push(pose);
  }
  return frames;
}

export function lerpPoses(a, b, alpha) {
  const t = Math.max(0, Math.min(1, alpha));
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const ja = a[i];
    const jb = b[i] || ja;
    const nq = qSlerp([ja[3], ja[4], ja[5], ja[6]], [jb[3], jb[4], jb[5], jb[6]], t);
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

export function smoothFrames(frames, passes = 1) {
  let cur = frames.map((f) => f.map((j) => j.slice()));
  for (let p = 0; p < passes; p++) {
    const next = cur.map((f) => f.map((j) => j.slice()));
    for (let t = 1; t < cur.length - 1; t++) {
      next[t] = lerpPoses(lerpPoses(cur[t - 1], cur[t + 1], 0.5), cur[t], 0.5);
    }
    cur = next;
  }
  return cur;
}

export function correctEndpoints(frames, startPoses, endWindow) {
  if (!frames || frames.length === 0) return frames;
  const out = frames.map((f) => f.map((j) => j.slice()));
  const N = out.length;
  const blendIn = Math.min(BOUNDARY + 2, Math.floor(N * 0.35));
  if (startPoses && startPoses.length > 0 && blendIn > 0) {
    const startRef = startPoses[startPoses.length - 1];
    for (let i = 0; i < blendIn; i++) {
      const alpha = (i + 1) / (blendIn + 1);
      const smooth = alpha * alpha * (3 - 2 * alpha);
      out[i] = lerpPoses(startRef, out[i], smooth);
    }
  }
  const blendOut = Math.min(BOUNDARY + 2, Math.floor(N * 0.35));
  if (endWindow && endWindow.length > 0 && blendOut > 0) {
    const endRef = endWindow[0];
    for (let i = 0; i < blendOut; i++) {
      const idx = N - 1 - i;
      const alpha = (i + 1) / (blendOut + 1);
      const smooth = alpha * alpha * (3 - 2 * alpha);
      out[idx] = lerpPoses(endRef, out[idx], smooth);
    }
  }
  return out;
}

export function sampleFrames(frames, frameIdx) {
  if (!frames || frames.length === 0) return null;
  if (frames.length === 1) return frames[0];
  const clamped = Math.max(0, Math.min(frames.length - 1, frameIdx));
  const lo = Math.floor(clamped);
  const hi = Math.min(frames.length - 1, lo + 1);
  if (lo === hi) return frames[lo];
  return lerpPoses(frames[lo], frames[hi], clamped - lo);
}

export function placeTarget(sk, targetWindow, targetPos, targetYaw) {
  const qy = qYaw(targetYaw);
  return targetWindow.map((pose) => {
    const copy = sk.clonePose(pose);
    const root = copy[0];
    const [rx, ry, rz] = qRot(qy, [root[0], root[1], root[2]]);
    const rq = qMul(qy, [root[3], root[4], root[5], root[6]]);
    copy[0] = [targetPos[0] + rx, (targetPos[1] || 0) + ry, targetPos[2] + rz, rq[0], rq[1], rq[2], rq[3]];
    return copy;
  });
}
