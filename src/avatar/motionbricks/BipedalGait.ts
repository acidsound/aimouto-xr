/**
 * Pure biomechanically grounded bipedal walk-cycle synthesizer for VRM 1.0
 * normalized humanoid bones (+Z forward, +Y up, +X character-left).
 *
 * Right-hand rule around +X:
 * - Negative rx on UpperLeg swings the downward (-Y) thigh FORWARD (+Z).
 * - Positive rx on UpperLeg swings the thigh BACKWARD (-Z).
 * - Positive rx on LowerLeg bends the knee BACKWARD (-Z).
 * - Negative rx on Foot dorsiflexes (toes up on heel strike); positive rx plantarflexes (push-off).
 */

export const DEFAULT_STRIDE_LENGTH_M = 0.66;

export interface BipedalGaitPose {
  leftUpperLegX: number;
  rightUpperLegX: number;
  leftLowerLegX: number;
  rightLowerLegX: number;
  leftFootX: number;
  rightFootX: number;
  hipsYaw: number;
  hipsRoll: number;
  hipsBobY: number;
  spinePitch: number;
  spineYaw: number;
  leftUpperArmX: number;
  rightUpperArmX: number;
  leftLowerArmY: number;
  rightLowerArmY: number;
}

/**
 * Advances gait phase in lockstep with ground speed so feet match floor travel
 * (1 full 2*PI cycle = 1 left step + 1 right step = `strideLengthM` meters).
 */
export function advanceGaitPhase(
  phase: number,
  speedMps: number,
  dt: number,
  strideLengthM = DEFAULT_STRIDE_LENGTH_M
): number {
  if (speedMps <= 0.03 || dt <= 0) return phase;
  const safeStride = Math.max(0.25, strideLengthM);
  const omega = (speedMps / safeStride) * Math.PI * 2;
  return (phase + omega * dt) % (Math.PI * 2);
}

function evalSingleLeg(theta: number): {
  upperX: number;
  lowerX: number;
  footX: number;
} {
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  // Hip flexion/extension:
  // theta = 0      -> heel strike (forward, negative rx ~ -0.52 rad)
  // theta = PI/2   -> mid-stance (near vertical, ~ -0.04 rad)
  // theta = PI     -> toe-off (backward, positive rx ~ +0.44 rad)
  // theta = 3*PI/2 -> mid-swing (passing forward past stance leg)
  const upperX = -0.04 - 0.48 * c;

  // Knee flexion (always >= 0, bending backward):
  // - Main swing-phase lift peaks just before 3*PI/2 so the swinging foot clears the floor cleanly
  // - Subtle weight-acceptance cushion during early/mid-stance
  const swingWave = Math.max(0, -Math.sin(theta + 0.24));
  const stanceCushion = Math.max(0, s) * 0.14;
  const lowerX = 0.05 + Math.pow(swingWave, 0.85) * 0.88 + stanceCushion;

  // Ankle pitch:
  // - Heel strike (cos > 0): slight dorsiflexion (toes up, negative rx)
  // - Push-off (cos < 0): plantarflexion (toes pushing down, positive rx)
  // - Mid-swing: lifted slightly to prevent toe drag
  const footX = -0.18 * c + 0.03 - swingWave * 0.14;

  return {upperX, lowerX, footX};
}

/**
 * Computes a complete symmetric two-step bipedal walk pose where left and right
 * legs are strictly 180 degrees (PI radians) out of phase.
 */
export function computeBipedalGait(
  phase: number,
  walkFactor: number
): BipedalGaitPose {
  const w = Math.max(0, Math.min(1, walkFactor));
  if (w <= 1e-4) {
    return {
      leftUpperLegX: 0,
      rightUpperLegX: 0,
      leftLowerLegX: 0,
      rightLowerLegX: 0,
      leftFootX: 0,
      rightFootX: 0,
      hipsYaw: 0,
      hipsRoll: 0,
      hipsBobY: 0,
      spinePitch: 0,
      spineYaw: 0,
      leftUpperArmX: 0,
      rightUpperArmX: 0,
      leftLowerArmY: 0,
      rightLowerArmY: 0,
    };
  }

  const left = evalSingleLeg(phase);
  const right = evalSingleLeg(phase + Math.PI);

  const c = Math.cos(phase);
  const s = Math.sin(phase);

  // Pelvis rotates forward on the stepping side; torso & arms counter-rotate
  const hipsYaw = -0.095 * c * w;
  const hipsRoll = 0.042 * s * w;
  // Inverted-pendulum double-frequency vertical bob: lowest at heel strike (0, PI), highest at mid-stance (PI/2, 3PI/2)
  const hipsBobY = -0.015 * Math.cos(phase * 2) * w;

  const spinePitch = 0.075 * w;
  const spineYaw = 0.115 * c * w;

  // Counter-phase arm swing: when Left leg is forward (c > 0), Left arm swings back (+rx) & Right arm swings forward (-rx)
  const leftUpperArmX = 0.44 * c * w;
  const rightUpperArmX = -0.44 * c * w;
  // Forearms bend forward slightly more on forward swing (Left forward bend = -ry, Right forward bend = +ry)
  const leftForwardSwing = Math.max(0, -c);
  const rightForwardSwing = Math.max(0, c);
  const leftLowerArmY = (-0.14 - 0.30 * leftForwardSwing) * w;
  const rightLowerArmY = (0.14 + 0.30 * rightForwardSwing) * w;

  return {
    leftUpperLegX: left.upperX * w,
    rightUpperLegX: right.upperX * w,
    leftLowerLegX: left.lowerX * w,
    rightLowerLegX: right.lowerX * w,
    leftFootX: left.footX * w,
    rightFootX: right.footX * w,
    hipsYaw,
    hipsRoll,
    hipsBobY,
    spinePitch,
    spineYaw,
    leftUpperArmX,
    rightUpperArmX,
    leftLowerArmY,
    rightLowerArmY,
  };
}
