import {
  MB_FPS,
  placeTarget,
  quatRotateVec,
  quatYaw,
  SomaPose,
  SomaSkeleton,
} from './mbRuntime';

export interface ArdyStepSpec {
  node: string;
  time: number;
  num_poses_to_use: number;
  transition_early_by_frames: number;
  min_tokens: number;
  max_tokens: number;
  window: SomaPose[];
}

export interface ArdySequenceSpec {
  name: string;
  pivot: number | null;
  steps: ArdyStepSpec[];
}

export interface ArdyPrimitiveSpec {
  name: string;
  boxes: Array<{center: [number, number, number]; size_runtime_wdh: [number, number, number]}>;
  pivots?: Record<
    string,
    {
      position: [number, number, number];
      motion_direction: [number, number, number];
      world: number[];
    }
  >;
  sequences: ArdySequenceSpec[];
}

export interface ArdyActionSpec {
  steps?: ArdyStepSpec[];
  foot?: string;
  speed?: number;
  contact?: [number, number, number];
}

export interface ArdyRuntimeData {
  source?: string;
  styles?: Array<{id: string; label: string; speed: number; window: SomaPose[]}>;
  prims: ArdyPrimitiveSpec[];
  actions: Record<string, ArdyActionSpec>;
}

export interface ScheduledMotionStep {
  node: string;
  durationSec: number;
  earlyFrames: number;
  targetWindow: SomaPose[];
  holdLoop?: boolean;
}

export interface PrimitiveSequencePlan {
  id: string;
  sitSteps: ScheduledMotionStep[];
  standSteps: ScheduledMotionStep[];
  seatAnchorWorld: [number, number, number];
  seatYaw: number;
  standAnchorWorld: [number, number, number];
}

export interface ActionSequencePlan {
  actionName: string;
  anchorWorld: [number, number, number];
  approachYaw: number;
  contactPointWorld: [number, number, number];
  contactDelaySec: number;
  steps: ScheduledMotionStep[];
}

export function quickenSteps(
  steps: ScheduledMotionStep[],
  speedFactor = 1.0
): ScheduledMotionStep[] {
  const factor = Math.max(0.25, speedFactor);
  return steps.map((st) => ({
    ...st,
    durationSec: st.durationSec / factor,
  }));
}

/**
 * Builds an authentic MotionBricks `ardy_sit` Smart Primitive plan (`Sit`: ToSit -> Sit,
 * and `Stand`: ToStand) anchored onto a target chair or bed surface in world space.
 */
export function buildSitPrimitive(
  sk: SomaSkeleton,
  ardyData: ArdyRuntimeData,
  seatWorldPos: [number, number, number],
  seatYaw: number,
  standWorldPos?: [number, number, number]
): PrimitiveSequencePlan {
  const sitPrim = ardyData.prims.find((p) => p.name === 'ardy_sit');
  if (!sitPrim) {
    throw new Error('Missing ardy_sit Smart Primitive in ardy_runtime.json');
  }

  const sitSeq = sitPrim.sequences.find((s) => s.name === 'Sit');
  const standSeq = sitPrim.sequences.find((s) => s.name === 'Stand');
  if (!sitSeq || !standSeq) {
    throw new Error('ardy_sit missing Sit or Stand sequence');
  }

  const effectiveStandPos: [number, number, number] = standWorldPos ?? [
    seatWorldPos[0] + Math.sin(seatYaw) * 0.42,
    0,
    seatWorldPos[2] + Math.cos(seatYaw) * 0.42,
  ];

  const sitSteps: ScheduledMotionStep[] = sitSeq.steps.map((step, idx) => {
    const isFinalSit = step.node === 'Sit' || idx === sitSeq.steps.length - 1;
    // Keep targetWindow in local +Z frame because `avatarAnchor.rotation.y` applies `seatYaw`
    const placed = placeTarget(sk, step.window, [0, 0, 0], 0);
    return {
      node: step.node,
      durationSec: isFinalSit
        ? 0.58
        : Math.min(0.45, Math.max(0.32, step.time * 0.22)),
      earlyFrames: step.transition_early_by_frames || 0,
      targetWindow: placed,
      holdLoop: isFinalSit,
    };
  });

  const standSteps: ScheduledMotionStep[] = standSeq.steps.map((step) => {
    const placed = placeTarget(sk, step.window, [0, 0, 0], 0);
    return {
      node: step.node,
      durationSec: Math.min(0.45, Math.max(0.32, step.time * 0.22)),
      earlyFrames: step.transition_early_by_frames || 0,
      targetWindow: placed,
    };
  });

  return {
    id: 'ardy_sit',
    sitSteps,
    standSteps,
    seatAnchorWorld: seatWorldPos,
    seatYaw,
    standAnchorWorld: effectiveStandPos,
  };
}

/**
 * Places an ARDY interaction action (`kick`, `pickup`, `push`) so its measured SOMA
 * contact vector `[cx, cy, cz]` lands directly at `propWorldPos` when approaching from
 * `avatarWorldPos`.
 */
export function placeArdyAction(
  sk: SomaSkeleton,
  ardyData: ArdyRuntimeData,
  actionName: 'kick' | 'pickup' | 'push',
  propWorldPos: [number, number, number],
  avatarWorldPos: [number, number, number]
): ActionSequencePlan {
  const act = ardyData.actions[actionName];
  if (!act || !act.steps || act.steps.length === 0) {
    throw new Error(`Missing ARDY action "${actionName}" in ardy_runtime.json`);
  }

  const contact = act.contact ?? [0, 0.35, 0.4];
  let dx = propWorldPos[0] - avatarWorldPos[0];
  let dz = propWorldPos[2] - avatarWorldPos[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) {
    dx = 0;
    dz = -1;
  } else {
    dx /= dist;
    dz /= dist;
  }

  // Compensate for lateral contact offset (e.g. kick uses right foot cx = -0.35m)
  const approachYaw = Math.atan2(dx, dz);
  const rotContact = quatRotateVec(quatYaw(approachYaw), contact);
  const anchorX = propWorldPos[0] - rotContact[0];
  const anchorZ = propWorldPos[2] - rotContact[2];
  const anchorWorld: [number, number, number] = [anchorX, 0, anchorZ];

  const steps: ScheduledMotionStep[] = act.steps.map((step) => {
    // Keep targetWindow in local +Z frame because `avatarAnchor.rotation.y` applies `approachYaw`
    const placed = placeTarget(sk, step.window, [0, 0, 0], 0);
    return {
      node: step.node,
      durationSec: Math.min(0.65, Math.max(0.4, step.time * 0.55)),
      earlyFrames: step.transition_early_by_frames || 0,
      targetWindow: placed,
    };
  });

  // Contact triggers right as the first action step reaches peak contact before Follow/Rise
  const contactDelaySec = Math.max(0.24, steps[0].durationSec * 0.72);

  return {
    actionName,
    anchorWorld,
    approachYaw,
    contactPointWorld: propWorldPos,
    contactDelaySec,
    steps,
  };
}

export function probeSegmentFrames(durationSec: number): number {
  return Math.max(4, Math.round(durationSec * MB_FPS));
}
