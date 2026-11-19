import * as THREE from 'three';
import {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';
import {AVATAR_PHYSICS_CONFIG, MOTION_BRICK_LABELS} from '../constants';
import {ROOM_WALK_BOUNDS, RoomObstacle} from '../scene/LofiRoomEnvironment';
import {MotionBrickPose, MotionBrickSnapshot, RoomPropId} from '../types';
import {MotionBricksPhysics} from './MotionBricksPhysics';
import {
  MB_FPS,
  MotionRecorder,
  sampleSomaFrames,
  SomaPose,
  SomaRuntimeData,
  SomaSkeleton,
  synthesizeSomaticTransition,
} from './motionbricks/mbRuntime';
import {SomaVrmRetargeter} from './motionbricks/SomaVrmRetargeter';
import {
  ArdyRuntimeData,
  buildSitPrimitive,
  placeArdyAction,
  probeSegmentFrames,
  ScheduledMotionStep,
} from './motionbricks/SmartPrimitives';
import {advanceGaitPhase, computeBipedalGait} from './motionbricks/BipedalGait';
import {
  AvatarBodyProfile,
  BodyContactRegionWorld,
  checkTargetReachability,
  computeBodyContactRegionWorld,
  computeBoundedSupportCorrection,
  computeInteractionStanceFromSurface,
  ContactAuditSnapshot,
  ContactFailureReason,
  ContactRelationContract,
  createDefaultAvatarBodyProfile,
  evaluateContactVerification,
  InteractionExecutionStatus,
  measureAvatarBodyProfile,
  MotionFrameSource,
  PropContactSurfaceLocal,
  resolveWorldContactSurface,
  WorldContactSurface,
  WorldPoseTransform,
} from './motionbricks/ContactContract';

export interface Waypoint2D {
  x: number;
  z: number;
}

export interface WalkBounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Pure helper: clamps a world (x, z) point inside the walkable bounds
 * and pushes it outside any solid furniture obstacle AABB.
 */
export function clampAndAvoidObstacles(
  x: number,
  z: number,
  obstacles: RoomObstacle[],
  margin = 0.22,
  ignoreObstacleId?: string | null,
  bounds: WalkBounds2D | null = ROOM_WALK_BOUNDS
): Waypoint2D {
  let px = bounds ? THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX) : x;
  let pz = bounds ? THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ) : z;

  for (const obs of obstacles) {
    if (ignoreObstacleId && obs.id === ignoreObstacleId) continue;
    const minX = obs.minX - margin;
    const maxX = obs.maxX + margin;
    const minZ = obs.minZ - margin;
    const maxZ = obs.maxZ + margin;

    if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
      const dLeft = Math.abs(px - minX);
      const dRight = Math.abs(maxX - px);
      const dTop = Math.abs(pz - minZ);
      const dBottom = Math.abs(maxZ - pz);
      const m = Math.min(dLeft, dRight, dTop, dBottom);
      if (m === dLeft) px = minX;
      else if (m === dRight) px = maxX;
      else if (m === dTop) pz = minZ;
      else pz = maxZ;
    }
  }

  if (bounds) {
    px = THREE.MathUtils.clamp(px, bounds.minX, bounds.maxX);
    pz = THREE.MathUtils.clamp(pz, bounds.minZ, bounds.maxZ);
  }
  return {x: px, z: pz};
}

/**
 * Pure helper: builds an obstacle-free 2D waypoint path through the compact
 * Lo-Fi bedroom corridor so the avatar walks cleanly around the desk & bed.
 */
export function computeRoomPath(
  from: Waypoint2D,
  to: Waypoint2D,
  obstacles: RoomObstacle[],
  ignoreObstacleId?: string | null,
  bounds: WalkBounds2D | null = ROOM_WALK_BOUNDS
): Waypoint2D[] {
  const safeGoal = clampAndAvoidObstacles(
    to.x,
    to.z,
    obstacles,
    0.16,
    ignoreObstacleId,
    bounds
  );

  if (obstacles.length > 0 && bounds) {
    const startsAtChair = from.x < -0.42 && from.z < -1.72;
    const crossesDeskBed =
      (from.x < -0.3 && safeGoal.x > 0.12) || (from.x > 0.12 && safeGoal.x < -0.3);

    if (startsAtChair && (safeGoal.x > -0.45 || safeGoal.z > -1.7)) {
      return [{x: -0.22, z: -1.58}, safeGoal];
    }

    if (crossesDeskBed && (from.z < -1.1 || safeGoal.z < -1.1)) {
      const midCorridor: Waypoint2D = {
        x: -0.06,
        z: Math.max(-1.62, Math.min(-1.05, (from.z + safeGoal.z) * 0.5)),
      };
      return [midCorridor, safeGoal];
    }
  }

  return [safeGoal];
}

/**
 * Pure analytical 2-bone IK solver computing intermediate joint world position
 * given root, target end-effector position, bone lengths, and pole hint vector.
 */
export function solveTwoBoneIKPosition(
  rootPos: THREE.Vector3,
  targetPos: THREE.Vector3,
  len1: number,
  len2: number,
  poleDir: THREE.Vector3,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3
): void {
  const toTarget = _tmpVecA.copy(targetPos).sub(rootPos);
  const rawDist = toTarget.length();
  const minDist = Math.max(0.04, Math.abs(len1 - len2) + 0.02);
  const maxDist = Math.max(minDist + 0.01, (len1 + len2) * 0.985);
  const dist = THREE.MathUtils.clamp(rawDist, minDist, maxDist);

  const forward =
    rawDist > 1e-5
      ? toTarget.multiplyScalar(1 / rawDist)
      : _tmpVecB.set(0, -1, 0);

  const cosA = THREE.MathUtils.clamp(
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist),
    -1,
    1
  );
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  const bendDir = _tmpVecC
    .copy(poleDir)
    .addScaledVector(forward, -poleDir.dot(forward));
  if (bendDir.lengthSq() < 1e-5) {
    bendDir.set(0, -1, -0.5);
    bendDir.addScaledVector(forward, -bendDir.dot(forward));
  }
  bendDir.normalize();

  outMid
    .copy(rootPos)
    .addScaledVector(forward, len1 * cosA)
    .addScaledVector(bendDir, len1 * sinA);

  outEnd.copy(rootPos).addScaledVector(forward, dist);
}

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();
const _midWorld = new THREE.Vector3();
const _endWorld = new THREE.Vector3();
const _rootBoneWorld = new THREE.Vector3();
const _lowerWorld = new THREE.Vector3();
const _endBoneWorld = new THREE.Vector3();
const _poleDir = new THREE.Vector3();
const _parentWorldQuat = new THREE.Quaternion();
const _invParentWorldQuat = new THREE.Quaternion();
const _dirLocal = new THREE.Vector3();
const _restAxis = new THREE.Vector3();
const _deltaQuat = new THREE.Quaternion();
const _targetEuler = new THREE.Euler();
const _targetQuat = new THREE.Quaternion();
const _ikStartTarget = new THREE.Vector3();
const _followDir = new THREE.Vector3();
const _preIkRegionPos = new THREE.Vector3();
const _postIkRegionPos = new THREE.Vector3();
const _clampedIkTarget = new THREE.Vector3();
const _rawRegionCopy = new THREE.Vector3();

/**
 * Unified declarative MotionBricks interaction command:
 * carries interaction intent, live prop transform source, prop-local contact
 * surface, and geometric contact contract.
 */
export interface MotionBrickCommand {
  propId: RoomPropId;
  pose: MotionBrickPose;
  /** Prop-local contact region & approach/facing directions. */
  contactSurface: PropContactSurfaceLocal;
  /** Declarative body-region <-> prop-surface contact contract. */
  contract: ContactRelationContract;
  /** Live Three.js Object3D representing the prop. */
  surfaceObject: THREE.Object3D;
  /** Optional live Rapier collider world pose provider (takes precedence when non-null). */
  colliderPoseProvider?: () => WorldPoseTransform | null;
  /** Optional secondary prop surface (e.g. laptop keyboard or mug while seated at chair). */
  secondarySurface?: {
    surfaceObject: THREE.Object3D;
    contactSurface: PropContactSurfaceLocal;
  };
  /** Fired STRICTLY when final-pose geometric contact verification succeeds. */
  onContactVerified?: (
    verification: import('./motionbricks/ContactContract').ContactVerificationResult,
    surface: WorldContactSurface
  ) => void;
  /** Fired if a sustained support contact breaks after being established. */
  onContactLost?: (
    verification: import('./motionbricks/ContactContract').ContactVerificationResult,
    surface: WorldContactSurface
  ) => void;
  /** Fired if the target is unreachable, exceeds correction budget, or fails contact verification. */
  onFailed?: (reason: ContactFailureReason, detail: string) => void;
  onComplete?: () => void;
}

interface ActiveSomaSequence {
  kind: 'sit' | 'stand' | 'action';
  steps: ScheduledMotionStep[];
  stepIndex: number;
  stepElapsedSec: number;
  totalDurationSec: number;
  elapsedSec: number;
  currentFrames: SomaPose[];
  frameSource: MotionFrameSource;
  holdOnLast: boolean;
  holdingFinal: boolean;
  onComplete?: () => void;
}

interface ActiveInteractionState {
  cmd: MotionBrickCommand;
  status: InteractionExecutionStatus;
  targetSurface: WorldContactSurface;
  targetYaw: number;
  contactAnchorPos: THREE.Vector3;
  standUpPos: THREE.Vector3;
  contactVerifiedFired: boolean;
  replanCount: number;
  sustainedFrames: number;
  executionElapsedSec: number;
  failureReason: ContactFailureReason;
}

/**
 * Contact-contract-driven MotionBricks executor:
 * - Resolves prop contact surfaces dynamically from live Three.js Object3D / Rapier collider transforms
 * - Measures VRM body profile (scale, femur/shin/arm lengths, seated support underside below Hips)
 * - Generates SOMA 77-joint motion from recent recorded pose context + surface-adapted target windows
 * - Applies bounded root & 2-bone IK corrections within `contract.maxCorrectionMeters`
 * - Verifies contact strictly on the FINAL posed skeleton (gap, penetration, normal alignment)
 * - Fires prop effects / physics impulses ONLY upon verified contact; continuously verifies sustained sits
 */
export class MotionBricksEngine {
  readonly rootPosition = new THREE.Vector3(-0.08, 0, -1.28);
  rootYaw = 0;

  private vrm: VRM | null = null;
  private bodyProfile: AvatarBodyProfile = createDefaultAvatarBodyProfile(1);
  private obstacles: RoomObstacle[] = [];
  private walkBounds: WalkBounds2D | null = null;
  private physics: MotionBricksPhysics | null = null;

  // Authentic SOMA runtime state
  private somaSk: SomaSkeleton | null = null;
  private ardyData: ArdyRuntimeData | null = null;
  private retargeter: SomaVrmRetargeter | null = null;
  private readonly recorder = new MotionRecorder(90);
  private worker: Worker | null = null;
  private workerReady = false;
  private activeSomaSeq: ActiveSomaSequence | null = null;
  private seatedStandSteps: ScheduledMotionStep[] | null = null;
  private seatedPropObject: THREE.Object3D | null = null;
  private pendingStandNextCmd: (() => void) | null = null;
  private recordAccumSec = 0;

  private currentPose: MotionBrickPose = 'idle';
  private activeProp: RoomPropId | null = null;
  private waypoints: Waypoint2D[] = [];
  private activeInteraction: ActiveInteractionState | null = null;
  private floorWalkTargetYaw: number | null = null;

  private gaitPhase = 0;
  private speed = 0;
  private desiredVx = 0;
  private desiredVz = 0;
  private activeIgnoreObstacleId: string | null = null;
  private wasDeepSeated = false;

  // Bounded support root correction accumulated cleanly relative to raw pose
  private readonly rootCorrectionOffset = new THREE.Vector3();
  private appliedSupportCorrectionMeters = 0;
  private appliedLimbCorrectionMeters = 0;
  private lastFrameSource: MotionFrameSource = 'fallback_procedural';

  // Hand-holding & gaze state
  private handHoldActive = false;
  private handHoldSide: 'left' | 'right' = 'right';
  private readonly handIkTargetWorld = new THREE.Vector3();
  private readonly gazeWorldOverride = new THREE.Vector3();
  private hasGazeWorldOverride = false;
  private ikWeightR = 0;
  private ikWeightL = 0;
  private ikWeightFootR = 0;
  private readonly tmpLeftHand = new THREE.Vector3();
  private readonly tmpRightHand = new THREE.Vector3();

  // Procedural fallback weights (used strictly when SOMA runtime is unavailable)
  private fallbackSitWeight = 0;
  private fallbackSitDropY = 0;

  private contactAudit: ContactAuditSnapshot = {
    propId: null,
    pose: 'idle',
    status: 'idle',
    frameSource: 'fallback_procedural',
    bodyRegionId: null,
    contractKind: null,
    targetSurface: null,
    bodyRegion: null,
    verification: null,
    failureReason: 'none',
    replanCount: 0,
    sustainedFrames: 0,
    timestampMs: 0,
  };

  constructor(autoLoadBrowserAssets = true) {
    if (
      autoLoadBrowserAssets &&
      typeof window !== 'undefined' &&
      typeof fetch === 'function'
    ) {
      void this.loadBrowserAssets();
    }
  }

  loadRuntimeData(somaData: SomaRuntimeData, ardyData: ArdyRuntimeData): void {
    this.somaSk = new SomaSkeleton(somaData);
    this.ardyData = ardyData;
    this.retargeter = new SomaVrmRetargeter(this.somaSk);
    if (this.vrm) {
      this.retargeter.bindVRM(this.vrm);
      this.bodyProfile = this.retargeter.bodyProfile;
    }
    const idlePose =
      this.somaSk.styles.get('idle')?.window[0] ?? this.somaSk.reference;
    this.recorder.clear();
    this.recorder.record(idlePose);
  }

  private async loadBrowserAssets(): Promise<void> {
    try {
      const [somaRes, ardyRes] = await Promise.all([
        fetch('/motionbricks/soma_runtime.json'),
        fetch('/motionbricks/ardy_runtime.json'),
      ]);
      if (!somaRes.ok || !ardyRes.ok) return;
      const somaData = (await somaRes.json()) as SomaRuntimeData;
      const ardyData = (await ardyRes.json()) as ArdyRuntimeData;
      this.loadRuntimeData(somaData, ardyData);

      if (typeof Worker !== 'undefined') {
        try {
          this.worker = new Worker('/motionbricks/mb_worker.js', {
            type: 'module',
          });
          this.worker.onmessage = (e: MessageEvent<{type?: string}>) => {
            if (e.data?.type === 'ready') {
              this.workerReady = true;
            }
          };
          this.worker.onerror = () => {
            this.workerReady = false;
          };
          this.worker.postMessage({type: 'init', somaData});
        } catch {
          this.workerReady = false;
        }
      }
    } catch {
      // Offline / headless test fallback
    }
  }

  get hasSomaRuntime(): boolean {
    return Boolean(this.somaSk && this.ardyData && this.retargeter);
  }

  get activeSomaSequenceNode(): string | null {
    if (!this.activeSomaSeq) return null;
    const step = this.activeSomaSeq.steps[this.activeSomaSeq.stepIndex];
    return step ? step.node : null;
  }

  getBodyProfile(): AvatarBodyProfile {
    return this.bodyProfile;
  }

  getContactAudit(): ContactAuditSnapshot {
    return this.contactAudit;
  }

  setObstacles(obstacles: RoomObstacle[], bounds: WalkBounds2D | null = ROOM_WALK_BOUNDS): void {
    this.obstacles = obstacles;
    this.walkBounds = obstacles.length > 0 ? bounds : null;
  }

  setWalkBounds(bounds: WalkBounds2D | null): void {
    this.walkBounds = bounds;
  }

  attachPhysics(physics: MotionBricksPhysics | null): void {
    this.physics = physics;
    if (physics) {
      physics.syncBodyPosition(
        this.rootPosition.x,
        Math.max(0, this.rootPosition.y),
        this.rootPosition.z
      );
    }
  }

  getPhysics(): MotionBricksPhysics | null {
    return this.physics;
  }

  triggerJump(impulse = AVATAR_PHYSICS_CONFIG.jumpImpulse): boolean {
    if (!this.physics) return false;
    this.cancelActiveInteraction();
    return this.physics.triggerJump(impulse);
  }

  setVRM(vrm: VRM): void {
    this.vrm = vrm;
    if (this.retargeter) {
      this.retargeter.bindVRM(vrm);
      this.bodyProfile = this.retargeter.bodyProfile;
    } else {
      this.bodyProfile = measureAvatarBodyProfile(vrm);
    }
  }

  refreshBodyProfile(): AvatarBodyProfile {
    if (this.vrm) {
      if (this.retargeter) {
        this.retargeter.bindVRM(this.vrm);
        this.bodyProfile = this.retargeter.bodyProfile;
      } else {
        this.bodyProfile = measureAvatarBodyProfile(this.vrm);
      }
    }
    return this.bodyProfile;
  }

  get pose(): MotionBrickPose {
    return this.currentPose;
  }

  get isHandHolding(): boolean {
    return this.handHoldActive;
  }

  get heldHandSide(): 'left' | 'right' {
    return this.handHoldSide;
  }

  getSnapshot(): MotionBrickSnapshot {
    return {
      pose: this.currentPose,
      activeProp: this.activeProp,
      handHoldActive: this.handHoldActive,
      moving: this.waypoints.length > 0 || this.speed > 0.08,
      label: MOTION_BRICK_LABELS[this.currentPose] ?? 'Room Idle',
      physicsActive: Boolean(this.physics),
      grounded: this.physics ? this.physics.state.grounded : true,
      weightKg: this.physics
        ? this.physics.state.weightKg
        : AVATAR_PHYSICS_CONFIG.massKg,
      verticalVelocity: this.physics ? this.physics.state.verticalVelocity : 0,
      motionBackend: this.workerReady ? 'onnx_webgpu' : 'soma_runtime',
      frameSource: this.contactAudit.frameSource,
      contactStatus: this.contactAudit.status,
      contactGapMm: this.contactAudit.verification
        ? Math.round(this.contactAudit.verification.gapMeters * 1000)
        : undefined,
      contactFailureReason:
        this.contactAudit.failureReason !== 'none'
          ? this.contactAudit.failureReason
          : undefined,
    };
  }

  get isDrivingBodyPose(): boolean {
    return (
      this.currentPose !== 'idle' ||
      Boolean(this.activeSomaSeq) ||
      Boolean(this.activeInteraction) ||
      this.handHoldActive ||
      this.waypoints.length > 0 ||
      this.speed > 0.04 ||
      this.fallbackSitWeight > 0.02 ||
      this.ikWeightR > 0.02 ||
      this.ikWeightL > 0.02 ||
      this.ikWeightFootR > 0.02
    );
  }

  private isSeatedPose(pose: MotionBrickPose): boolean {
    return (
      pose === 'sit_desk' ||
      pose === 'type_desk' ||
      pose === 'sip_mug' ||
      pose === 'sit_bed' ||
      pose === 'lounge_bed'
    );
  }

  getHandWorldPosition(
    side: 'left' | 'right',
    out = new THREE.Vector3()
  ): THREE.Vector3 {
    const boneName =
      side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
    const bone = this.vrm?.humanoid.getNormalizedBoneNode(boneName);
    if (bone) {
      bone.getWorldPosition(out);
      return out;
    }
    return out.set(
      this.rootPosition.x + (side === 'left' ? 0.24 : -0.24) * this.bodyProfile.overallScale,
      this.rootPosition.y + 0.92 * this.bodyProfile.overallScale,
      this.rootPosition.z
    );
  }

  getChestWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const chest = this.vrm?.humanoid.getNormalizedBoneNode(
      VRMHumanBoneName.Chest
    );
    if (chest) {
      chest.getWorldPosition(out);
      return out;
    }
    return out.set(
      this.rootPosition.x,
      this.rootPosition.y + 1.05 * this.bodyProfile.overallScale,
      this.rootPosition.z
    );
  }

  getActiveGazeTargetWorld(out: THREE.Vector3): boolean {
    if (this.handHoldActive) {
      out.copy(this.handIkTargetWorld);
      out.y += 0.25;
      return true;
    }
    if (this.hasGazeWorldOverride) {
      out.copy(this.gazeWorldOverride);
      return true;
    }
    return false;
  }

  startHandHold(
    targetWorld: THREE.Vector3,
    preferredSide?: 'left' | 'right'
  ): void {
    this.cancelActiveInteraction();
    this.handHoldActive = true;
    this.activeProp = null;
    this.currentPose = 'hand_hold';
    this.handIkTargetWorld.copy(targetWorld);

    if (preferredSide) {
      this.handHoldSide = preferredSide;
    } else {
      const leftDist = this.getHandWorldPosition('left', _tmpVecA).distanceToSquared(
        targetWorld
      );
      const rightDist = this.getHandWorldPosition('right', _tmpVecB).distanceToSquared(
        targetWorld
      );
      this.handHoldSide = rightDist <= leftDist ? 'right' : 'left';
    }
  }

  updateHandHoldTarget(targetWorld: THREE.Vector3): void {
    if (!this.handHoldActive) return;
    this.handIkTargetWorld.copy(targetWorld);
  }

  stopHandHold(): void {
    if (!this.handHoldActive) return;
    this.handHoldActive = false;
    this.currentPose = 'idle';
  }

  walkToFloor(x: number, z: number, facingYaw?: number): void {
    this.handHoldActive = false;
    this.hasGazeWorldOverride = false;
    const safe = clampAndAvoidObstacles(
      x,
      z,
      this.obstacles,
      0.22,
      null,
      this.walkBounds
    );
    const yaw =
      facingYaw ??
      Math.atan2(safe.x - this.rootPosition.x, safe.z - this.rootPosition.z);

    const startWalk = () => {
      this.activeInteraction = null;
      this.activeProp = 'floor';
      this.rootCorrectionOffset.set(0, 0, 0);
      this.appliedSupportCorrectionMeters = 0;
      this.floorWalkTargetYaw = yaw;
      const dist = Math.hypot(
        safe.x - this.rootPosition.x,
        safe.z - this.rootPosition.z
      );
      if (dist < 0.12) {
        this.waypoints = [];
        this.currentPose = 'idle';
      } else {
        this.waypoints = computeRoomPath(
          {x: this.rootPosition.x, z: this.rootPosition.z},
          safe,
          this.obstacles,
          null,
          this.walkBounds
        );
        this.currentPose = 'walk';
      }
      this.updateAuditSnapshot({
        propId: 'floor',
        pose: this.currentPose,
        status: 'idle',
        bodyRegionId: null,
        contractKind: null,
        targetSurface: null,
        bodyRegion: null,
        verification: null,
        failureReason: 'none',
        replanCount: 0,
        sustainedFrames: 0,
      });
    };

    if (this.seatedStandSteps && this.somaSk) {
      this.triggerStandUpThen(startWalk);
    } else {
      this.activeSomaSeq = null;
      this.seatedStandSteps = null;
      this.seatedPropObject = null;
      startWalk();
    }
  }

  /**
   * Common contact-contract executor for ALL prop interactions (sit, type, sip,
   * lounge, reach, pet, kick, pickup, push).
   */
  executeCommand(cmd: MotionBrickCommand): {
    accepted: boolean;
    reason: ContactFailureReason;
    detail: string;
  } {
    this.handHoldActive = false;
    this.floorWalkTargetYaw = null;

    const surface = this.resolveCommandSurface(cmd);
    const profile = this.bodyProfile;
    const ignoreId = this.obstacleIdForProp(cmd.propId);

    const reach = checkTargetReachability(surface, profile, cmd.contract, {
      obstacles: this.obstacles,
      roomBounds: this.walkBounds ?? undefined,
      ignoreObstacleId: ignoreId,
    });

    if (!reach.reachable) {
      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: this.currentPose,
        status: 'failed',
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: null,
        verification: null,
        failureReason: reach.reason,
        replanCount: 0,
        sustainedFrames: 0,
      });
      cmd.onFailed?.(reach.reason, reach.detail);
      return {accepted: false, reason: reach.reason, detail: reach.detail};
    }

    this.activeProp = cmd.propId;
    this.gazeWorldOverride.copy(surface.lookAtWorld);
    this.hasGazeWorldOverride = true;

    const stance = computeInteractionStanceFromSurface(
      surface,
      profile,
      cmd.contract,
      this.rootPosition
    );

    const interaction: ActiveInteractionState = {
      cmd,
      status: 'approaching',
      targetSurface: surface,
      targetYaw: stance.targetYaw,
      contactAnchorPos: stance.contactAnchorPos,
      standUpPos: stance.standUpPos,
      contactVerifiedFired: false,
      replanCount: 0,
      sustainedFrames: 0,
      executionElapsedSec: 0,
      failureReason: 'none',
    };

    const isStayingOnSameSeat =
      cmd.contract.kind === 'support' &&
      Boolean(this.seatedPropObject) &&
      this.seatedPropObject === cmd.surfaceObject &&
      this.isSeatedPose(this.currentPose);

    const beginApproach = () => {
      this.activeInteraction = interaction;
      this.planApproachOrExecute(interaction);
    };

    if (isStayingOnSameSeat) {
      // Already seated on this exact physical seat object (e.g. desk_chair -> laptop / coffee_mug / bed -> lounge)
      this.activeInteraction = interaction;
      this.activeInteraction.status = 'executing';
      this.currentPose = cmd.pose;
      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: cmd.pose,
        status: 'executing',
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: this.contactAudit.bodyRegion,
        verification: this.contactAudit.verification,
        failureReason: 'none',
        replanCount: 0,
        sustainedFrames: 0,
      });
      return {accepted: true, reason: 'none', detail: 'reusing seated contact'};
    }

    if (this.seatedStandSteps && this.somaSk) {
      this.triggerStandUpThen(beginApproach);
    } else {
      this.activeSomaSeq = null;
      this.seatedStandSteps = null;
      this.seatedPropObject = null;
      this.rootCorrectionOffset.set(0, 0, 0);
      this.appliedSupportCorrectionMeters = 0;
      beginApproach();
    }

    return {accepted: true, reason: 'none', detail: 'executing'};
  }

  private resolveCommandSurface(cmd: MotionBrickCommand): WorldContactSurface {
    const colliderPose = cmd.colliderPoseProvider?.() ?? null;
    return resolveWorldContactSurface(
      cmd.contactSurface,
      colliderPose ?? cmd.surfaceObject
    );
  }

  private planApproachOrExecute(interaction: ActiveInteractionState): void {
    const {cmd} = interaction;
    const surface = this.resolveCommandSurface(cmd);
    interaction.targetSurface = surface;
    const profile = this.bodyProfile;
    const ignoreId = this.obstacleIdForProp(cmd.propId);

    const reach = checkTargetReachability(surface, profile, cmd.contract, {
      obstacles: this.obstacles,
      roomBounds: this.walkBounds ?? undefined,
      ignoreObstacleId: ignoreId,
    });
    if (!reach.reachable) {
      this.failActiveInteraction(reach.reason, reach.detail);
      return;
    }

    // For ARDY impact actions with SOMA runtime, compute exact SOMA-scaled contact stance
    if (
      cmd.contract.kind === 'impact' &&
      this.somaSk &&
      this.ardyData &&
      (cmd.contract.motionPrimitive === 'kick' ||
        cmd.contract.motionPrimitive === 'pickup' ||
        cmd.contract.motionPrimitive === 'push')
    ) {
      const retargetScale =
        profile.hipsHeightY / Math.max(0.2, this.somaSk.reference[0][1]);
      const plan = placeArdyAction(
        this.somaSk,
        this.ardyData,
        cmd.contract.motionPrimitive,
        [surface.center.x, surface.center.y, surface.center.z],
        [this.rootPosition.x, 0, this.rootPosition.z],
        retargetScale
      );
      const safeApproach = clampAndAvoidObstacles(
        plan.anchorWorld[0],
        plan.anchorWorld[2],
        this.obstacles,
        0.16,
        ignoreId,
        this.walkBounds
      );
      interaction.contactAnchorPos.set(safeApproach.x, 0, safeApproach.z);
      interaction.targetYaw = plan.approachYaw;

      const dist = Math.hypot(
        safeApproach.x - this.rootPosition.x,
        safeApproach.z - this.rootPosition.z
      );
      if (dist < 0.16) {
        this.waypoints = [];
        this.beginMotionExecution(interaction);
      } else {
        interaction.status = 'approaching';
        this.waypoints = computeRoomPath(
          {x: this.rootPosition.x, z: this.rootPosition.z},
          safeApproach,
          this.obstacles,
          ignoreId,
          this.walkBounds
        );
        this.currentPose = 'walk';
      }
      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: this.currentPose,
        status: interaction.status,
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: null,
        verification: null,
        failureReason: 'none',
        replanCount: interaction.replanCount,
        sustainedFrames: interaction.sustainedFrames,
      });
      return;
    }

    // Support (sit) or Touch (reach): compute stance directly from live surface + body profile
    const stance = computeInteractionStanceFromSurface(
      surface,
      profile,
      cmd.contract,
      this.rootPosition
    );
    const safeGoal =
      cmd.contract.kind === 'support'
        ? {x: stance.contactAnchorPos.x, z: stance.contactAnchorPos.z}
        : clampAndAvoidObstacles(
            stance.approachPos.x,
            stance.approachPos.z,
            this.obstacles,
            0.16,
            ignoreId,
            this.walkBounds
          );

    interaction.contactAnchorPos.set(safeGoal.x, 0, safeGoal.z);
    interaction.standUpPos.copy(stance.standUpPos);
    interaction.targetYaw = stance.targetYaw;

    const dist = Math.hypot(
      safeGoal.x - this.rootPosition.x,
      safeGoal.z - this.rootPosition.z
    );
    if (dist < 0.15) {
      this.waypoints = [];
      this.beginMotionExecution(interaction);
    } else {
      interaction.status = 'approaching';
      this.waypoints = computeRoomPath(
        {x: this.rootPosition.x, z: this.rootPosition.z},
        safeGoal,
        this.obstacles,
        ignoreId,
        this.walkBounds
      );
      this.currentPose = 'walk';
    }

    this.updateAuditSnapshot({
      propId: cmd.propId,
      pose: this.currentPose,
      status: interaction.status,
      bodyRegionId: cmd.contract.bodyRegion,
      contractKind: cmd.contract.kind,
      targetSurface: surface,
      bodyRegion: null,
      verification: null,
      failureReason: 'none',
      replanCount: interaction.replanCount,
      sustainedFrames: interaction.sustainedFrames,
    });
  }

  private beginMotionExecution(interaction: ActiveInteractionState): void {
    const {cmd} = interaction;
    const surface = this.resolveCommandSurface(cmd);
    interaction.targetSurface = surface;
    interaction.executionElapsedSec = 0;
    interaction.status = 'executing';
    const profile = this.bodyProfile;

    this.gazeWorldOverride.copy(surface.lookAtWorld);
    this.hasGazeWorldOverride = true;

    // 1. Support interaction -> MotionBricks `ardy_sit` adapted to live surface height + body profile
    if (cmd.contract.kind === 'support') {
      const stance = computeInteractionStanceFromSurface(
        surface,
        profile,
        cmd.contract,
        this.rootPosition
      );
      interaction.contactAnchorPos.copy(stance.contactAnchorPos);
      interaction.standUpPos.copy(stance.standUpPos);
      interaction.targetYaw = stance.targetYaw;
      this.rootYaw = stance.targetYaw;

      if (this.somaSk && this.ardyData) {
        const plan = buildSitPrimitive(
          this.somaSk,
          this.ardyData,
          [stance.contactAnchorPos.x, 0, stance.contactAnchorPos.z],
          stance.targetYaw,
          [stance.standUpPos.x, 0, stance.standUpPos.z],
          {surface, profile}
        );
        this.seatedStandSteps = plan.standSteps;
        this.seatedPropObject = cmd.surfaceObject;
        const firstStep = this.buildFramesForStep(plan.sitSteps[0]);
        const totalDur = plan.sitSteps.reduce((acc, s) => acc + Math.max(0.1, s.durationSec), 0);
        this.activeSomaSeq = {
          kind: 'sit',
          steps: plan.sitSteps,
          stepIndex: 0,
          stepElapsedSec: 0,
          totalDurationSec: totalDur,
          elapsedSec: 0,
          currentFrames: firstStep.frames,
          frameSource: firstStep.source,
          holdOnLast: true,
          holdingFinal: false,
        };
      } else {
        this.seatedPropObject = cmd.surfaceObject;
      }

      // Do NOT fire onContactVerified here — pose transitions and final-pose contact verification decides!
      this.currentPose = cmd.pose;
      return;
    }

    // 2. Impact interaction -> MotionBricks ARDY action (`kick`, `pickup`, `push`)
    if (
      cmd.contract.kind === 'impact' &&
      this.somaSk &&
      this.ardyData &&
      (cmd.contract.motionPrimitive === 'kick' ||
        cmd.contract.motionPrimitive === 'pickup' ||
        cmd.contract.motionPrimitive === 'push')
    ) {
      const retargetScale =
        profile.hipsHeightY / Math.max(0.2, this.somaSk.reference[0][1]);
      const plan = placeArdyAction(
        this.somaSk,
        this.ardyData,
        cmd.contract.motionPrimitive,
        [surface.center.x, surface.center.y, surface.center.z],
        [this.rootPosition.x, 0, this.rootPosition.z],
        retargetScale
      );

      // If dynamic prop moved noticeably while walking, replan before swinging!
      const anchorDrift = Math.hypot(
        plan.anchorWorld[0] - this.rootPosition.x,
        plan.anchorWorld[2] - this.rootPosition.z
      );
      if (anchorDrift > 0.42 && interaction.replanCount < (cmd.contract.maxReplans ?? 1)) {
        interaction.replanCount++;
        this.planApproachOrExecute(interaction);
        return;
      }

      interaction.targetYaw = plan.approachYaw;
      this.rootYaw = plan.approachYaw;
      this.currentPose = cmd.pose;

      const firstStep = this.buildFramesForStep(plan.steps[0]);
      const totalDur = plan.steps.reduce((acc, s) => acc + Math.max(0.1, s.durationSec), 0);
      this.activeSomaSeq = {
        kind: 'action',
        steps: plan.steps,
        stepIndex: 0,
        stepElapsedSec: 0,
        totalDurationSec: totalDur,
        elapsedSec: 0,
        currentFrames: firstStep.frames,
        frameSource: firstStep.source,
        holdOnLast: false,
        holdingFinal: false,
        onComplete: () => {
          this.finishNonSustainedInteraction(interaction);
        },
      };
      return;
    }

    // 3. Touch / Reach interaction (or fallback impact when SOMA runtime absent)
    const toTargetYaw = Math.atan2(
      surface.center.x - this.rootPosition.x,
      surface.center.z - this.rootPosition.z
    );
    interaction.targetYaw = toTargetYaw;
    this.rootYaw = toTargetYaw;
    this.currentPose = cmd.pose;
  }

  private finishNonSustainedInteraction(interaction: ActiveInteractionState): void {
    if (this.activeInteraction !== interaction) return;

    if (!interaction.contactVerifiedFired) {
      const maxReplans = interaction.cmd.contract.maxReplans ?? 1;
      const surface = this.resolveCommandSurface(interaction.cmd);
      const reach = checkTargetReachability(
        surface,
        this.bodyProfile,
        interaction.cmd.contract,
        {
          obstacles: this.obstacles,
          roomBounds: this.walkBounds ?? undefined,
          ignoreObstacleId: this.obstacleIdForProp(interaction.cmd.propId),
        }
      );

      if (interaction.replanCount < maxReplans && reach.reachable) {
        const distToTarget = Math.hypot(
          surface.center.x - this.rootPosition.x,
          surface.center.z - this.rootPosition.z
        );
        if (distToTarget > 0.45) {
          interaction.replanCount++;
          this.planApproachOrExecute(interaction);
          return;
        }
      }

      const failReason =
        this.contactAudit.verification &&
        this.contactAudit.verification.reason !== 'none'
          ? this.contactAudit.verification.reason
          : 'contact_not_achieved';
      this.failActiveInteraction(
        failReason,
        `Final-pose contact with ${interaction.cmd.propId} was not achieved (${failReason})`
      );
      return;
    }

    // Contact was verified earlier during the execution window
    const cmd = interaction.cmd;
    if (
      cmd.pose === 'kick_ball' ||
      cmd.pose === 'pickup_die' ||
      cmd.pose === 'push_prop' ||
      cmd.pose === 'reach_prop'
    ) {
      this.currentPose = 'idle';
      this.activeInteraction = null;
    }
    cmd.onComplete?.();
  }

  private failActiveInteraction(
    reason: ContactFailureReason,
    detail: string
  ): void {
    const interaction = this.activeInteraction;
    this.activeInteraction = null;
    this.activeSomaSeq = null;
    this.seatedStandSteps = null;
    this.seatedPropObject = null;
    this.waypoints = [];
    this.currentPose = 'idle';
    this.rootCorrectionOffset.set(0, 0, 0);
    this.appliedSupportCorrectionMeters = 0;

    this.updateAuditSnapshot({
      propId: interaction?.cmd.propId ?? this.activeProp,
      pose: 'idle',
      status: 'failed',
      bodyRegionId: interaction?.cmd.contract.bodyRegion ?? null,
      contractKind: interaction?.cmd.contract.kind ?? null,
      targetSurface: interaction?.targetSurface ?? this.contactAudit.targetSurface,
      bodyRegion: this.contactAudit.bodyRegion,
      verification: this.contactAudit.verification,
      failureReason: reason,
      replanCount: interaction?.replanCount ?? 0,
      sustainedFrames: interaction?.sustainedFrames ?? 0,
    });

    interaction?.cmd.onFailed?.(reason, detail);
  }

  private cancelActiveInteraction(): void {
    this.activeInteraction = null;
    this.activeSomaSeq = null;
    this.seatedStandSteps = null;
    this.seatedPropObject = null;
    this.pendingStandNextCmd = null;
    this.waypoints = [];
    this.rootCorrectionOffset.set(0, 0, 0);
    this.appliedSupportCorrectionMeters = 0;
    this.hasGazeWorldOverride = false;
    if (this.isSeatedPose(this.currentPose)) {
      this.currentPose = 'idle';
      this.activeProp = null;
    }
  }

  private triggerStandUpThen(afterStand: () => void): void {
    const standSteps = this.seatedStandSteps;
    this.seatedStandSteps = null;
    this.seatedPropObject = null;
    this.activeInteraction = null;
    this.rootCorrectionOffset.set(0, 0, 0);
    this.appliedSupportCorrectionMeters = 0;

    if (!standSteps || standSteps.length === 0 || !this.somaSk) {
      this.activeSomaSeq = null;
      afterStand();
      return;
    }
    this.pendingStandNextCmd = afterStand;
    this.currentPose = 'idle';
    const firstStep = this.buildFramesForStep(standSteps[0]);
    const totalDur = standSteps.reduce((acc, s) => acc + Math.max(0.1, s.durationSec), 0);
    this.activeSomaSeq = {
      kind: 'stand',
      steps: standSteps,
      stepIndex: 0,
      stepElapsedSec: 0,
      totalDurationSec: totalDur,
      elapsedSec: 0,
      currentFrames: firstStep.frames,
      frameSource: firstStep.source,
      holdOnLast: false,
      holdingFinal: false,
      onComplete: () => {
        const next = this.pendingStandNextCmd;
        this.pendingStandNextCmd = null;
        next?.();
      },
    };
  }

  private buildFramesForStep(step: ScheduledMotionStep): {
    frames: SomaPose[];
    source: MotionFrameSource;
  } {
    if (!this.somaSk) {
      return {frames: [], source: 'fallback_procedural'};
    }
    const context = this.recorder.lastN(4);
    const totalFrames = probeSegmentFrames(step.durationSec);
    const frames = synthesizeSomaticTransition(
      this.somaSk,
      context,
      step.targetWindow,
      totalFrames
    );
    // Honest frame source: synchronous SOMA transition is 'motionbricks_soma'
    // (only report 'motionbricks_onnx' when an actual ONNX worker inference produced these frames)
    return {frames, source: 'motionbricks_soma'};
  }

  private obstacleIdForProp(propId: RoomPropId | null): string | null {
    if (!propId) return null;
    if (
      propId === 'desk_chair' ||
      propId === 'laptop' ||
      propId === 'coffee_mug'
    ) {
      return 'desk_chair';
    }
    if (propId === 'bed') {
      return 'bed';
    }
    return null;
  }

  private resolveIgnoreObstacleId(): string | null {
    const propId = this.activeInteraction?.cmd.propId ?? this.activeProp;
    const direct = this.obstacleIdForProp(propId);
    if (direct) return direct;

    for (const obs of this.obstacles) {
      if (obs.id !== 'desk_chair' && obs.id !== 'bed') continue;
      if (
        this.rootPosition.x >= obs.minX - 0.28 &&
        this.rootPosition.x <= obs.maxX + 0.28 &&
        this.rootPosition.z >= obs.minZ - 0.28 &&
        this.rootPosition.z <= obs.maxZ + 0.28
      ) {
        return obs.id;
      }
    }
    return null;
  }

  stepPhysics(dt: number): void {
    if (!this.physics) return;
    const safeDt = Math.min(Math.max(dt, 0.001), 0.05);
    this.updateLocomotion(safeDt);

    const seated =
      this.isSeatedPose(this.currentPose) &&
      (this.activeInteraction?.status === 'sustained_contact' ||
        this.activeInteraction?.status === 'contact_verified' ||
        this.activeSomaSeq?.kind === 'sit' ||
        this.fallbackSitWeight > 0.45);
    if (seated && !this.wasDeepSeated) {
      this.physics.triggerWeightImpact(0.95);
    }
    this.wasDeepSeated = seated;

    this.getHandWorldPosition('left', this.tmpLeftHand);
    this.getHandWorldPosition('right', this.tmpRightHand);

    const state = this.physics.step(safeDt, {
      desiredVx: this.desiredVx,
      desiredVz: this.desiredVz,
      yaw: this.rootYaw,
      seated,
      ignoreObstacleId: this.activeIgnoreObstacleId,
      leftHandWorld: {
        x: this.tmpLeftHand.x,
        y: this.tmpLeftHand.y,
        z: this.tmpLeftHand.z,
      },
      rightHandWorld: {
        x: this.tmpRightHand.x,
        y: this.tmpRightHand.y,
        z: this.tmpRightHand.z,
      },
    });

    this.rootPosition.set(state.x, state.footY, state.z);
    this.speed = Math.hypot(state.vx, state.vz);
  }

  update(dt: number, elapsed: number, avatarAnchor: THREE.Group): void {
    const safeDt = Math.min(Math.max(dt, 0.001), 0.12);

    if (!this.physics) {
      this.updateLocomotion(safeDt);
    }

    // 1. Advance active SOMA MotionBricks sequence
    const activeSomaPose = this.stepActiveSomaSequence(safeDt);
    const hasSomaSeq = Boolean(activeSomaPose);
    this.lastFrameSource = activeSomaPose
      ? this.activeSomaSeq?.frameSource ?? 'motionbricks_soma'
      : 'fallback_procedural';

    // 2. Smoothly zero root correction when no support contact is executing/sustained
    const isSupportExecuting =
      this.activeInteraction?.cmd.contract.kind === 'support' &&
      (this.activeInteraction.status === 'executing' ||
        this.activeInteraction.status === 'contact_verified' ||
        this.activeInteraction.status === 'sustained_contact');
    if (!isSupportExecuting) {
      const decay = 1 - Math.exp(-12 * safeDt);
      this.rootCorrectionOffset.lerp(_tmpVecA.set(0, 0, 0), decay);
      this.appliedSupportCorrectionMeters = this.rootCorrectionOffset.length();
    }

    // 3. Procedural fallback sit drop (only when SOMA runtime is absent!)
    let targetFallbackDropY = 0;
    if (!hasSomaSeq && isSupportExecuting && this.activeInteraction) {
      const surface = this.resolveCommandSurface(this.activeInteraction.cmd);
      this.activeInteraction.targetSurface = surface;
      // Dynamically derive drop from live seat surface Y and avatar body profile (zero hardcoded offset!)
      const desiredHipsY =
        surface.center.y + this.bodyProfile.seatedSupportOffsetBelowHips;
      targetFallbackDropY = desiredHipsY - this.bodyProfile.hipsHeightY;
    }
    this.fallbackSitDropY = THREE.MathUtils.damp(
      this.fallbackSitDropY,
      targetFallbackDropY,
      10,
      safeDt
    );

    const walkFactor =
      THREE.MathUtils.clamp(this.speed / 0.65, 0, 1) *
      (isSupportExecuting ? 0 : 1);
    const gaitBob =
      !hasSomaSeq && walkFactor > 0.02
        ? computeBipedalGait(this.gaitPhase, walkFactor).hipsBobY
        : 0;

    const footY = this.physics ? this.physics.state.footY : 0;
    const compressionY = this.physics ? this.physics.state.compressionY : 0;

    // Position anchor with current root + bounded support correction
    avatarAnchor.position.set(
      this.rootPosition.x + this.rootCorrectionOffset.x,
      footY +
        (hasSomaSeq ? 0 : this.fallbackSitDropY) +
        gaitBob +
        compressionY +
        this.rootCorrectionOffset.y,
      this.rootPosition.z + this.rootCorrectionOffset.z
    );
    avatarAnchor.rotation.y = this.rootYaw;
    avatarAnchor.updateMatrixWorld(true);

    // 4. Pose VRM skeleton (SOMA retargeting OR procedural gait/fallback) + bounded limb IK
    this.appliedLimbCorrectionMeters = 0;
    if (this.vrm) {
      this.applyWholeBodyMotionBricks(
        this.vrm,
        safeDt,
        elapsed,
        activeSomaPose,
        avatarAnchor
      );
      avatarAnchor.updateMatrixWorld(true);
      this.vrm.scene.updateMatrixWorld(true);
    }

    // 5. Final-pose contact verification & bounded support correction
    if (this.activeInteraction) {
      this.verifyActiveInteractionFinalPose(
        safeDt,
        avatarAnchor,
        activeSomaPose
      );
    }
  }

  private verifyActiveInteractionFinalPose(
    dt: number,
    avatarAnchor: THREE.Group,
    activeSomaPose: SomaPose | null
  ): void {
    const interaction = this.activeInteraction;
    if (!interaction) return;
    if (interaction.status === 'approaching') return;

    interaction.executionElapsedSec += dt;
    const {cmd} = interaction;
    const surface = this.resolveCommandSurface(cmd);
    interaction.targetSurface = surface;

    const fallbackSoma =
      activeSomaPose && this.somaSk
        ? {sk: this.somaSk, pose: activeSomaPose}
        : null;

    // A. Support contact (sitting)
    if (cmd.contract.kind === 'support') {
      const seq = this.activeSomaSeq;
      const sitProgress = seq
        ? seq.holdingFinal
          ? 1
          : Math.min(1, seq.elapsedSec / Math.max(0.2, seq.totalDurationSec))
        : this.fallbackSitWeight;

      const rawBodyRegion = computeBodyContactRegionWorld(
        this.vrm,
        this.bodyProfile,
        cmd.contract.bodyRegion,
        avatarAnchor.position,
        this.rootYaw,
        surface,
        fallbackSoma
      );

      // Compute uncorrected body support position by subtracting current rootCorrectionOffset
      // so correction magnitude is ALWAYS measured honestly from raw pose to final pose!
      _rawRegionCopy.copy(rawBodyRegion.center).sub(this.rootCorrectionOffset);
      const uncorrectedRegion: BodyContactRegionWorld = {
        ...rawBodyRegion,
        center: _rawRegionCopy.clone(),
      };

      const readyToVerify =
        interaction.status === 'sustained_contact' ||
        (seq ? seq.holdingFinal || sitProgress >= 0.72 : sitProgress >= 0.75);

      if (!readyToVerify) {
        this.updateAuditSnapshot({
          propId: cmd.propId,
          pose: this.currentPose,
          status: 'executing',
          bodyRegionId: cmd.contract.bodyRegion,
          contractKind: cmd.contract.kind,
          targetSurface: surface,
          bodyRegion: rawBodyRegion,
          verification: null,
          failureReason: 'none',
          replanCount: interaction.replanCount,
          sustainedFrames: interaction.sustainedFrames,
        });
        return;
      }

      const corr = computeBoundedSupportCorrection(
        uncorrectedRegion,
        surface,
        cmd.contract
      );

      // Apply bounded correction (clamped strictly to contract.maxCorrectionMeters)
      const alpha =
        interaction.status === 'sustained_contact' || sitProgress >= 0.92
          ? 1
          : 1 - Math.exp(-16 * dt);
      this.rootCorrectionOffset.lerp(corr.appliedDelta, alpha);
      this.appliedSupportCorrectionMeters = this.rootCorrectionOffset.length();

      // Re-apply updated anchor transform and re-measure FINAL posed body contact region
      const footY = this.physics ? this.physics.state.footY : 0;
      const compressionY = this.physics ? this.physics.state.compressionY : 0;
      avatarAnchor.position.set(
        this.rootPosition.x + this.rootCorrectionOffset.x,
        footY +
          (activeSomaPose ? 0 : this.fallbackSitDropY) +
          compressionY +
          this.rootCorrectionOffset.y,
        this.rootPosition.z + this.rootCorrectionOffset.z
      );
      avatarAnchor.updateMatrixWorld(true);
      this.vrm?.scene.updateMatrixWorld(true);

      const finalBodyRegion = computeBodyContactRegionWorld(
        this.vrm,
        this.bodyProfile,
        cmd.contract.bodyRegion,
        avatarAnchor.position,
        this.rootYaw,
        surface,
        fallbackSoma
      );

      // Total correction reported to evaluator: use requiredMagnitude if budget exceeded so budget violation is explicit
      const reportedCorrection = corr.exceededBudget
        ? corr.requiredMagnitude
        : this.appliedSupportCorrectionMeters;

      const verification = evaluateContactVerification(
        finalBodyRegion,
        surface,
        cmd.contract,
        reportedCorrection
      );

      if (verification.valid) {
        interaction.sustainedFrames++;
        interaction.failureReason = 'none';
        const nextStatus: InteractionExecutionStatus =
          cmd.contract.requiresSustainedContact
            ? 'sustained_contact'
            : 'contact_verified';
        interaction.status = nextStatus;
        this.updateAuditSnapshot({
          propId: cmd.propId,
          pose: this.currentPose,
          status: nextStatus,
          bodyRegionId: cmd.contract.bodyRegion,
          contractKind: cmd.contract.kind,
          targetSurface: surface,
          bodyRegion: finalBodyRegion,
          verification,
          failureReason: 'none',
          replanCount: interaction.replanCount,
          sustainedFrames: interaction.sustainedFrames,
        });

        if (!interaction.contactVerifiedFired) {
          interaction.contactVerifiedFired = true;
          cmd.onContactVerified?.(verification, surface);
        }
        return;
      }

      // Verification NOT valid:
      if (interaction.status === 'sustained_contact') {
        // Seated support was previously valid, now broken (e.g. chair moved/tilted/raised!)
        this.updateAuditSnapshot({
          propId: cmd.propId,
          pose: 'idle',
          status: 'failed',
          bodyRegionId: cmd.contract.bodyRegion,
          contractKind: cmd.contract.kind,
          targetSurface: surface,
          bodyRegion: finalBodyRegion,
          verification,
          failureReason: 'contact_lost',
          replanCount: interaction.replanCount,
          sustainedFrames: interaction.sustainedFrames,
        });
        cmd.onContactLost?.(verification, surface);
        this.failActiveInteraction(
          'contact_lost',
          `Sustained seat contact lost (${verification.reason}, gap=${(verification.gapMeters * 1000).toFixed(0)}mm)`
        );
        return;
      }

      // Not yet verified: if transition completed (or budget exceeded), replan or fail!
      const transitionDone =
        (seq && seq.holdingFinal) ||
        (!seq && interaction.executionElapsedSec > 0.85) ||
        corr.exceededBudget;

      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: this.currentPose,
        status: 'executing',
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: finalBodyRegion,
        verification,
        failureReason: verification.reason,
        replanCount: interaction.replanCount,
        sustainedFrames: interaction.sustainedFrames,
      });

      if (transitionDone) {
        const maxReplans = cmd.contract.maxReplans ?? 1;
        const reach = checkTargetReachability(
          surface,
          this.bodyProfile,
          cmd.contract,
          {
            obstacles: this.obstacles,
            roomBounds: this.walkBounds ?? undefined,
            ignoreObstacleId: this.obstacleIdForProp(cmd.propId),
          }
        );
        if (interaction.replanCount < maxReplans && reach.reachable) {
          interaction.replanCount++;
          this.activeSomaSeq = null;
          this.rootCorrectionOffset.set(0, 0, 0);
          this.planApproachOrExecute(interaction);
        } else {
          this.failActiveInteraction(
            verification.reason !== 'none'
              ? verification.reason
              : 'contact_not_achieved',
            `Seat contact verification failed (${verification.reason}, gap=${(verification.gapMeters * 1000).toFixed(0)}mm)`
          );
        }
      }
      return;
    }

    // B. Impact (`kick`, `pickup`, `push`) and Touch (`reach`) contact verification on FINAL pose
    const finalBodyRegion = computeBodyContactRegionWorld(
      this.vrm,
      this.bodyProfile,
      cmd.contract.bodyRegion,
      avatarAnchor.position,
      this.rootYaw,
      surface,
      fallbackSoma
    );

    const verification = evaluateContactVerification(
      finalBodyRegion,
      surface,
      cmd.contract,
      this.appliedLimbCorrectionMeters
    );

    if (verification.valid && !interaction.contactVerifiedFired) {
      interaction.contactVerifiedFired = true;
      interaction.status = 'contact_verified';
      interaction.sustainedFrames = 1;
      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: this.currentPose,
        status: 'contact_verified',
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: finalBodyRegion,
        verification,
        failureReason: 'none',
        replanCount: interaction.replanCount,
        sustainedFrames: 1,
      });
      cmd.onContactVerified?.(verification, surface);
    } else if (!interaction.contactVerifiedFired) {
      this.updateAuditSnapshot({
        propId: cmd.propId,
        pose: this.currentPose,
        status: 'executing',
        bodyRegionId: cmd.contract.bodyRegion,
        contractKind: cmd.contract.kind,
        targetSurface: surface,
        bodyRegion: finalBodyRegion,
        verification,
        failureReason: verification.reason,
        replanCount: interaction.replanCount,
        sustainedFrames: interaction.sustainedFrames,
      });
    }

    // Non-SOMA touch/reach completion timeout (never triggers contact — only ends attempt or fails if unverified!)
    if (!this.activeSomaSeq && interaction.executionElapsedSec >= 1.35) {
      this.finishNonSustainedInteraction(interaction);
    }
  }

  private stepActiveSomaSequence(dt: number): SomaPose | null {
    const seq = this.activeSomaSeq;
    if (!seq || !this.somaSk) return null;

    seq.elapsedSec += dt;
    const step = seq.steps[seq.stepIndex];
    if (!step) {
      this.activeSomaSeq = null;
      seq.onComplete?.();
      return null;
    }

    seq.stepElapsedSec += dt;
    const stepDur = Math.max(0.1, step.durationSec);
    const earlySec = (step.earlyFrames || 0) / MB_FPS;
    const advanceThreshold =
      seq.stepIndex < seq.steps.length - 1
        ? Math.max(0.15, stepDur - earlySec)
        : stepDur;

    if (seq.stepElapsedSec >= advanceThreshold) {
      if (seq.stepIndex < seq.steps.length - 1) {
        seq.stepIndex++;
        seq.stepElapsedSec = 0;
        const nextStep = seq.steps[seq.stepIndex];
        const built = this.buildFramesForStep(nextStep);
        seq.currentFrames = built.frames;
        seq.frameSource = built.source;
      } else if (seq.holdOnLast) {
        seq.holdingFinal = true;
      } else {
        this.activeSomaSeq = null;
        seq.onComplete?.();
        return null;
      }
    }

    const frames = seq.currentFrames;
    if (!frames || frames.length === 0) return null;

    let pose: SomaPose | null;
    if (seq.holdingFinal) {
      const holdIdx = Math.min(
        frames.length - 1,
        Math.max(0, frames.length - step.targetWindow.length)
      );
      pose = sampleSomaFrames(frames, holdIdx);
    } else {
      const progress = Math.min(1, seq.stepElapsedSec / stepDur);
      pose = sampleSomaFrames(frames, progress * (frames.length - 1));
    }

    if (pose) {
      this.recordAccumSec += dt;
      if (this.recordAccumSec >= 1 / MB_FPS) {
        this.recordAccumSec %= 1 / MB_FPS;
        this.recorder.record(pose);
      }
    }
    return pose;
  }

  private updateLocomotion(dt: number): void {
    let targetVx = 0;
    let targetVz = 0;
    this.activeIgnoreObstacleId = this.resolveIgnoreObstacleId();

    const standingWait = this.activeSomaSeq?.kind === 'stand';

    if (this.handHoldActive) {
      _followDir.set(
        this.handIkTargetWorld.x - this.rootPosition.x,
        0,
        this.handIkTargetWorld.z - this.rootPosition.z
      );
      const dist = _followDir.length();
      if (dist > 0.36) {
        const pullSpeed = Math.min(1.55, (dist - 0.36) * 3.4);
        _followDir.normalize();
        targetVx = _followDir.x * pullSpeed;
        targetVz = _followDir.z * pullSpeed;

        if (!this.physics) {
          const nextSafe = clampAndAvoidObstacles(
            this.rootPosition.x + targetVx * dt,
            this.rootPosition.z + targetVz * dt,
            this.obstacles,
            0.22,
            null,
            this.walkBounds
          );
          this.rootPosition.x = nextSafe.x;
          this.rootPosition.z = nextSafe.z;
          this.speed = Math.hypot(targetVx, targetVz);
        }

        const desiredYaw = Math.atan2(_followDir.x, _followDir.z);
        this.rootYaw = dampAngle(this.rootYaw, desiredYaw, 8.5, dt);
      } else {
        const desiredYaw = Math.atan2(_followDir.x, _followDir.z);
        this.rootYaw = dampAngle(this.rootYaw, desiredYaw, 5, dt);
        if (!this.physics) {
          this.speed = 0;
        }
      }
    } else if (this.waypoints.length > 0 && !standingWait) {
      this.currentPose = 'walk';
      const wp = this.waypoints[0];
      const dx = wp.x - this.rootPosition.x;
      const dz = wp.z - this.rootPosition.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.1) {
        if (!this.physics) {
          this.rootPosition.x = wp.x;
          this.rootPosition.z = wp.z;
        }
        this.waypoints.shift();
        if (this.waypoints.length === 0) {
          if (this.activeInteraction) {
            this.beginMotionExecution(this.activeInteraction);
          } else {
            this.currentPose = 'idle';
          }
        }
      } else {
        const walkSpeed = Math.min(1.22, Math.max(0.55, dist * 1.8));
        const nx = dx / dist;
        const nz = dz / dist;
        targetVx = nx * walkSpeed;
        targetVz = nz * walkSpeed;
        if (!this.physics) {
          this.rootPosition.x += targetVx * dt;
          this.rootPosition.z += targetVz * dt;
          this.speed = walkSpeed;
        }

        const moveYaw = Math.atan2(nx, nz);
        this.rootYaw = dampAngle(this.rootYaw, moveYaw, 10, dt);
      }
    } else {
      if (!this.physics) {
        this.speed = THREE.MathUtils.damp(this.speed, 0, 12, dt);
      }
      if (this.activeInteraction && this.activeInteraction.status !== 'approaching') {
        const liveSurface = this.resolveCommandSurface(this.activeInteraction.cmd);
        const desiredYaw =
          this.activeInteraction.cmd.contract.kind === 'support'
            ? liveSurface.facingYaw
            : Math.atan2(
                liveSurface.center.x - this.rootPosition.x,
                liveSurface.center.z - this.rootPosition.z
              );
        this.activeInteraction.targetYaw = desiredYaw;
        this.rootYaw = dampAngle(this.rootYaw, desiredYaw, 12, dt);
      } else if (this.floorWalkTargetYaw !== null) {
        this.rootYaw = dampAngle(this.rootYaw, this.floorWalkTargetYaw, 8, dt);
      }
    }

    this.desiredVx = targetVx;
    this.desiredVz = targetVz;

    if (this.speed > 0.03) {
      this.gaitPhase = advanceGaitPhase(this.gaitPhase, this.speed, dt);
    }
  }

  private applyWholeBodyMotionBricks(
    vrm: VRM,
    dt: number,
    elapsed: number,
    activeSomaPose: SomaPose | null,
    avatarAnchor: THREE.Group
  ): void {
    const isSupportExecuting =
      this.activeInteraction?.cmd.contract.kind === 'support' &&
      this.activeInteraction.status !== 'approaching';

    this.fallbackSitWeight = THREE.MathUtils.damp(
      this.fallbackSitWeight,
      !activeSomaPose && isSupportExecuting ? 1 : 0,
      8.5,
      dt
    );

    const walkFactor =
      THREE.MathUtils.clamp(this.speed / 0.65, 0, 1) *
      (1 - (isSupportExecuting ? 1 : this.fallbackSitWeight));

    // 1. Authentic SOMA 77-joint playback (ardy_sit, kick, pickup, push)
    if (activeSomaPose && this.retargeter) {
      this.retargeter.applyPose(activeSomaPose, {
        blendAlpha: 1 - Math.exp(-18 * dt),
        skipHipsPositionXZ: true,
      });
      avatarAnchor.updateMatrixWorld(true);
      vrm.scene.updateMatrixWorld(true);
      this.applyContextualAndContactIK(vrm, dt, elapsed);
      return;
    }

    // Restore neutral hips Y smoothly whenever we are not in a SOMA sequence
    this.retargeter?.restoreRestHipsY(1 - Math.exp(-12 * dt));

    const physicsCompression = this.physics ? this.physics.state.compressionY : 0;
    const kneeAbsorb = Math.max(0, -physicsCompression) * 5.2;
    const airborneKnee =
      this.physics && !this.physics.state.grounded
        ? THREE.MathUtils.clamp(
            Math.abs(this.physics.state.verticalVelocity) * 0.14,
            0.08,
            0.38
          )
        : 0;
    const leanPitch = this.physics ? this.physics.state.leanPitch : 0;
    const leanRoll = this.physics ? this.physics.state.leanRoll : 0;

    if (!this.isDrivingBodyPose) {
      this.dampBoneEuler(vrm, VRMHumanBoneName.LeftUpperLeg, -(kneeAbsorb + airborneKnee) * 0.45, 0, 0, 12, dt);
      this.dampBoneEuler(vrm, VRMHumanBoneName.RightUpperLeg, -(kneeAbsorb + airborneKnee) * 0.45, 0, 0, 12, dt);
      this.dampBoneEuler(vrm, VRMHumanBoneName.LeftLowerLeg, (kneeAbsorb + airborneKnee) * 0.9, 0, 0, 12, dt);
      this.dampBoneEuler(vrm, VRMHumanBoneName.RightLowerLeg, (kneeAbsorb + airborneKnee) * 0.9, 0, 0, 12, dt);
      this.dampBoneEuler(vrm, VRMHumanBoneName.LeftFoot, 0, 0, 0, 14, dt);
      this.dampBoneEuler(vrm, VRMHumanBoneName.RightFoot, 0, 0, 0, 14, dt);
      if (
        Math.abs(kneeAbsorb) > 0.01 ||
        Math.abs(leanPitch) > 0.004 ||
        Math.abs(leanRoll) > 0.004
      ) {
        this.dampBoneEuler(
          vrm,
          VRMHumanBoneName.Spine,
          leanPitch + kneeAbsorb * 0.25,
          0,
          leanRoll,
          10,
          dt
        );
      }
      return;
    }

    // 2. Full two-step alternating bipedal gait (strict 180-deg crossover) + procedural sit fallback
    const gait = computeBipedalGait(this.gaitPhase, walkFactor);
    const legLambda = walkFactor > 0.08 ? 22 : 12;
    const anySit = this.fallbackSitWeight;
    const isBedSit = this.currentPose === 'sit_bed';

    const sitThighX = -1.42 * anySit - (kneeAbsorb + airborneKnee) * 0.42 * (1 - anySit);
    const bedLegSwing = isBedSit ? anySit * Math.sin(elapsed * 2.1) * 0.14 : 0;
    const sitKneeX = 1.44 * anySit + (kneeAbsorb + airborneKnee) * 0.85 * (1 - anySit);

    this.dampBoneEuler(vrm, VRMHumanBoneName.Hips, 0, gait.hipsYaw, gait.hipsRoll, legLambda, dt);
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.LeftUpperLeg,
      sitThighX + gait.leftUpperLegX,
      0.03 * anySit,
      -0.04 * anySit,
      legLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.RightUpperLeg,
      sitThighX + gait.rightUpperLegX,
      -0.03 * anySit,
      0.04 * anySit,
      legLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.LeftLowerLeg,
      sitKneeX + gait.leftLowerLegX + bedLegSwing,
      0,
      0,
      legLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.RightLowerLeg,
      sitKneeX + gait.rightLowerLegX - bedLegSwing,
      0,
      0,
      legLambda,
      dt
    );
    this.dampBoneEuler(vrm, VRMHumanBoneName.LeftFoot, gait.leftFootX, 0, 0, legLambda, dt);
    this.dampBoneEuler(vrm, VRMHumanBoneName.RightFoot, gait.rightFootX, 0, 0, legLambda, dt);

    const breath = Math.sin(elapsed * 2.1);
    const spinePitch =
      gait.spinePitch +
      leanPitch +
      kneeAbsorb * 0.22 +
      (this.currentPose === 'lounge_bed' ? -0.18 : 0) +
      (this.currentPose === 'pet_cat' ? 0.22 : 0);

    this.dampBoneEuler(vrm, VRMHumanBoneName.Spine, spinePitch, gait.spineYaw, leanRoll, 14, dt);
    this.dampBoneEuler(vrm, VRMHumanBoneName.Chest, breath * 0.025, 0, 0, 10, dt);

    const armLambda = walkFactor > 0.08 ? 18 : 10;
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.LeftUpperArm,
      gait.leftUpperArmX + 0.05,
      0.05,
      -1.18 - breath * 0.02,
      armLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.LeftLowerArm,
      0.05,
      walkFactor > 0.05 ? gait.leftLowerArmY : 0.16,
      -0.14,
      armLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.RightUpperArm,
      gait.rightUpperArmX + 0.05,
      -0.05,
      1.18 + breath * 0.02,
      armLambda,
      dt
    );
    this.dampBoneEuler(
      vrm,
      VRMHumanBoneName.RightLowerArm,
      0.05,
      walkFactor > 0.05 ? gait.rightLowerArmY : -0.16,
      0.14,
      armLambda,
      dt
    );

    avatarAnchor.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);
    this.applyContextualAndContactIK(vrm, dt, elapsed);
  }

  private applyContextualAndContactIK(
    vrm: VRM,
    dt: number,
    elapsed: number
  ): void {
    const interaction = this.activeInteraction;
    const isExecuting =
      Boolean(interaction) && interaction!.status !== 'approaching';
    const contract = interaction?.cmd.contract;

    if (this.currentPose === 'lounge_bed') {
      this.dampBoneEuler(vrm, VRMHumanBoneName.Spine, -0.24, 0, 0, 8, dt);
    }

    // Check secondary surface (e.g. live laptop keyboard / coffee mug while seated)
    const secondary = interaction?.cmd.secondarySurface
      ? resolveWorldContactSurface(
          interaction.cmd.secondarySurface.contactSurface,
          interaction.cmd.secondarySurface.surfaceObject
        )
      : null;

    const isSeatedTask =
      isExecuting &&
      contract?.kind === 'support' &&
      (interaction!.status === 'sustained_contact' ||
        interaction!.status === 'contact_verified');

    const isTyping = isSeatedTask && this.currentPose === 'type_desk' && Boolean(secondary);
    const isSipping = isSeatedTask && this.currentPose === 'sip_mug' && Boolean(secondary);

    const isHandContactTask =
      isExecuting &&
      contract &&
      (contract.kind === 'touch' || contract.kind === 'impact') &&
      (contract.bodyRegion === 'right_hand' ||
        contract.bodyRegion === 'left_hand' ||
        contract.bodyRegion === 'both_hands');

    const isFootImpactTask =
      isExecuting &&
      contract &&
      contract.kind === 'impact' &&
      (contract.bodyRegion === 'right_foot' || contract.bodyRegion === 'left_foot');

    const wantRightHandIK =
      (this.handHoldActive && this.handHoldSide === 'right') ||
      isTyping ||
      isSipping ||
      Boolean(
        isHandContactTask &&
          (contract!.bodyRegion === 'right_hand' ||
            contract!.bodyRegion === 'both_hands')
      );

    const wantLeftHandIK =
      (this.handHoldActive && this.handHoldSide === 'left') ||
      isTyping ||
      Boolean(
        isHandContactTask &&
          (contract!.bodyRegion === 'left_hand' ||
            contract!.bodyRegion === 'both_hands')
      );

    // Strike window for bounded foot IK assist during kick
    const kickProgress = this.activeSomaSeq
      ? Math.min(
          1,
          this.activeSomaSeq.elapsedSec /
            Math.max(0.2, this.activeSomaSeq.totalDurationSec)
        )
      : Math.min(1, (interaction?.executionElapsedSec ?? 0) / 0.9);
    const wantRightFootIK = Boolean(
      isFootImpactTask &&
        !interaction!.contactVerifiedFired &&
        kickProgress >= 0.22 &&
        kickProgress <= 0.78
    );

    this.ikWeightR = THREE.MathUtils.damp(this.ikWeightR, wantRightHandIK ? 1 : 0, 14, dt);
    this.ikWeightL = THREE.MathUtils.damp(this.ikWeightL, wantLeftHandIK ? 1 : 0, 14, dt);
    this.ikWeightFootR = THREE.MathUtils.damp(
      this.ikWeightFootR,
      wantRightFootIK ? 1 : 0,
      18,
      dt
    );

    // Apply right hand IK
    if (this.ikWeightR > 0.02) {
      if (this.handHoldActive && this.handHoldSide === 'right') {
        _ikStartTarget.copy(this.handIkTargetWorld);
        this.solveArmIKWorld(vrm, 'right', _ikStartTarget, this.ikWeightR);
      } else if (isTyping && secondary) {
        _ikStartTarget
          .copy(secondary.center)
          .addScaledVector(secondary.axes[0], -0.075)
          .addScaledVector(secondary.normal, 0.025 + Math.abs(Math.sin(elapsed * 9.0)) * 0.02);
        this.solveArmIKWorld(vrm, 'right', _ikStartTarget, this.ikWeightR);
      } else if (isSipping && secondary) {
        const sipMix = (Math.sin(elapsed * 1.8) + 1) * 0.5;
        const headPos = this.getChestWorldPosition(_tmpVecA);
        headPos.y += 0.24 * this.bodyProfile.overallScale;
        _ikStartTarget.copy(secondary.center).lerp(headPos, sipMix * 0.65);
        this.solveArmIKWorld(vrm, 'right', _ikStartTarget, this.ikWeightR);
      } else if (isHandContactTask && interaction) {
        const surface = this.resolveCommandSurface(interaction.cmd);
        _ikStartTarget.copy(surface.center);
        if (this.currentPose === 'pet_cat' && interaction.contactVerifiedFired) {
          _ikStartTarget.x += Math.sin(elapsed * 5.2) * 0.035;
          _ikStartTarget.y += Math.abs(Math.sin(elapsed * 5.2)) * 0.025;
        }
        this.appliedLimbCorrectionMeters = Math.max(
          this.appliedLimbCorrectionMeters,
          this.solveBoundedLimbContactIK(
            vrm,
            'right_hand',
            _ikStartTarget,
            this.ikWeightR,
            interaction.cmd.contract.maxCorrectionMeters
          )
        );
      }
    }

    // Apply left hand IK
    if (this.ikWeightL > 0.02) {
      if (this.handHoldActive && this.handHoldSide === 'left') {
        _ikStartTarget.copy(this.handIkTargetWorld);
        this.solveArmIKWorld(vrm, 'left', _ikStartTarget, this.ikWeightL);
      } else if (isTyping && secondary) {
        _ikStartTarget
          .copy(secondary.center)
          .addScaledVector(secondary.axes[0], 0.075)
          .addScaledVector(secondary.normal, 0.025 + Math.abs(Math.cos(elapsed * 8.4)) * 0.02);
        this.solveArmIKWorld(vrm, 'left', _ikStartTarget, this.ikWeightL);
      } else if (isHandContactTask && interaction) {
        const surface = this.resolveCommandSurface(interaction.cmd);
        _ikStartTarget.copy(surface.center);
        this.appliedLimbCorrectionMeters = Math.max(
          this.appliedLimbCorrectionMeters,
          this.solveBoundedLimbContactIK(
            vrm,
            'left_hand',
            _ikStartTarget,
            this.ikWeightL,
            interaction.cmd.contract.maxCorrectionMeters
          )
        );
      }
    }

    // Apply bounded foot IK assist during kick strike window
    if (this.ikWeightFootR > 0.02 && isFootImpactTask && interaction) {
      const surface = this.resolveCommandSurface(interaction.cmd);
      this.appliedLimbCorrectionMeters = Math.max(
        this.appliedLimbCorrectionMeters,
        this.solveBoundedLimbContactIK(
          vrm,
          'right_foot',
          surface.center,
          this.ikWeightFootR,
          interaction.cmd.contract.maxCorrectionMeters
        )
      );
    }
  }

  /**
   * Solves 2-bone IK toward a contact target while strictly bounding end-effector
   * correction against `maxCorrectionMeters` when an underlying SOMA sequence is
   * driving the limb (or naturally bounded by limb bone lengths during procedural reach).
   * Returns the actual end-effector displacement applied in world meters.
   */
  private solveBoundedLimbContactIK(
    vrm: VRM,
    limb: 'right_hand' | 'left_hand' | 'right_foot',
    targetWorld: THREE.Vector3,
    weight: number,
    maxCorrectionMeters: number
  ): number {
    const endBoneName =
      limb === 'right_hand'
        ? VRMHumanBoneName.RightHand
        : limb === 'left_hand'
          ? VRMHumanBoneName.LeftHand
          : VRMHumanBoneName.RightFoot;
    const endBone = vrm.humanoid.getNormalizedBoneNode(endBoneName);
    if (!endBone) return 0;

    vrm.scene.updateMatrixWorld(true);
    endBone.getWorldPosition(_preIkRegionPos);

    _clampedIkTarget.copy(targetWorld);
    if (this.activeSomaSeq) {
      // When refining a SOMA MotionBricks pose, clamp IK pull strictly to maxCorrectionMeters
      const delta = _tmpVecA.copy(targetWorld).sub(_preIkRegionPos);
      const dist = delta.length();
      if (dist > maxCorrectionMeters && dist > 1e-5) {
        _clampedIkTarget
          .copy(_preIkRegionPos)
          .addScaledVector(delta, maxCorrectionMeters / dist);
      }
    }

    if (limb === 'right_foot') {
      this.solveLegIKWorld(vrm, 'right', _clampedIkTarget, weight);
    } else {
      this.solveArmIKWorld(
        vrm,
        limb === 'left_hand' ? 'left' : 'right',
        _clampedIkTarget,
        weight
      );
    }

    vrm.scene.updateMatrixWorld(true);
    endBone.getWorldPosition(_postIkRegionPos);

    // For SOMA refinement, report actual shift from SOMA pose; for procedural reach,
    // report only overshoot beyond natural arm reach (0 when naturally within reach)
    if (this.activeSomaSeq) {
      return _postIkRegionPos.distanceTo(_preIkRegionPos);
    }
    const rootBoneName =
      limb === 'right_hand'
        ? VRMHumanBoneName.RightUpperArm
        : limb === 'left_hand'
          ? VRMHumanBoneName.LeftUpperArm
          : VRMHumanBoneName.RightUpperLeg;
    const rootBone = vrm.humanoid.getNormalizedBoneNode(rootBoneName);
    if (!rootBone) return 0;
    rootBone.getWorldPosition(_rootBoneWorld);
    const naturalMax =
      limb === 'right_foot'
        ? this.bodyProfile.femurLength + this.bodyProfile.shinLength
        : this.bodyProfile.armReachMax;
    const requiredReach = _rootBoneWorld.distanceTo(targetWorld);
    return Math.max(0, requiredReach - naturalMax);
  }

  private dampBoneEuler(
    vrm: VRM,
    boneName: VRMHumanBoneName,
    rx: number,
    ry: number,
    rz: number,
    lambda: number,
    dt: number
  ): void {
    const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!bone) return;
    _targetEuler.set(rx, ry, rz, 'XYZ');
    _targetQuat.setFromEuler(_targetEuler);
    const alpha = 1 - Math.exp(-lambda * dt);
    bone.quaternion.slerp(_targetQuat, alpha);
  }

  private solveArmIKWorld(
    vrm: VRM,
    side: 'left' | 'right',
    targetWorld: THREE.Vector3,
    weight: number
  ): void {
    const upper = vrm.humanoid.getNormalizedBoneNode(
      side === 'left'
        ? VRMHumanBoneName.LeftUpperArm
        : VRMHumanBoneName.RightUpperArm
    );
    const lower = vrm.humanoid.getNormalizedBoneNode(
      side === 'left'
        ? VRMHumanBoneName.LeftLowerArm
        : VRMHumanBoneName.RightLowerArm
    );
    const hand = vrm.humanoid.getNormalizedBoneNode(
      side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand
    );
    if (!upper || !lower || !hand || !upper.parent) return;

    upper.parent.updateWorldMatrix(true, false);
    upper.getWorldPosition(_rootBoneWorld);
    lower.getWorldPosition(_lowerWorld);
    hand.getWorldPosition(_endBoneWorld);

    const len1 = Math.max(0.1, _rootBoneWorld.distanceTo(_lowerWorld));
    const len2 = Math.max(0.1, _lowerWorld.distanceTo(_endBoneWorld));

    _poleDir.set(side === 'left' ? 0.35 : -0.35, -0.7, -0.65);
    _poleDir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rootYaw);

    solveTwoBoneIKPosition(
      _rootBoneWorld,
      targetWorld,
      len1,
      len2,
      _poleDir,
      _midWorld,
      _endWorld
    );

    this.alignTwoBoneChain(upper, lower, hand, side === 'left' ? 1 : -1, weight);
  }

  private solveLegIKWorld(
    vrm: VRM,
    side: 'left' | 'right',
    targetWorld: THREE.Vector3,
    weight: number
  ): void {
    const upper = vrm.humanoid.getNormalizedBoneNode(
      side === 'left'
        ? VRMHumanBoneName.LeftUpperLeg
        : VRMHumanBoneName.RightUpperLeg
    );
    const lower = vrm.humanoid.getNormalizedBoneNode(
      side === 'left'
        ? VRMHumanBoneName.LeftLowerLeg
        : VRMHumanBoneName.RightLowerLeg
    );
    const foot = vrm.humanoid.getNormalizedBoneNode(
      side === 'left' ? VRMHumanBoneName.LeftFoot : VRMHumanBoneName.RightFoot
    );
    if (!upper || !lower || !foot || !upper.parent) return;

    upper.parent.updateWorldMatrix(true, false);
    upper.getWorldPosition(_rootBoneWorld);
    lower.getWorldPosition(_lowerWorld);
    foot.getWorldPosition(_endBoneWorld);

    const len1 = Math.max(0.14, _rootBoneWorld.distanceTo(_lowerWorld));
    const len2 = Math.max(0.14, _lowerWorld.distanceTo(_endBoneWorld));

    // Knee bends forward along avatar facing direction
    _poleDir.set(0, 0.15, 1.0);
    _poleDir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rootYaw);

    solveTwoBoneIKPosition(
      _rootBoneWorld,
      targetWorld,
      len1,
      len2,
      _poleDir,
      _midWorld,
      _endWorld
    );

    this.alignTwoBoneChain(upper, lower, foot, 0, weight);
  }

  private alignTwoBoneChain(
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    end: THREE.Object3D,
    fallbackAxisX: number,
    weight: number
  ): void {
    if (!upper.parent) return;
    upper.parent.getWorldQuaternion(_parentWorldQuat);
    _invParentWorldQuat.copy(_parentWorldQuat).invert();
    _dirLocal
      .copy(_midWorld)
      .sub(_rootBoneWorld)
      .normalize()
      .applyQuaternion(_invParentWorldQuat);
    _restAxis.copy(lower.position);
    if (_restAxis.lengthSq() < 1e-6) {
      _restAxis.set(fallbackAxisX, fallbackAxisX === 0 ? -1 : 0, 0);
    } else {
      _restAxis.normalize();
    }
    _deltaQuat.setFromUnitVectors(_restAxis, _dirLocal);
    upper.quaternion.slerp(_deltaQuat, weight);
    upper.updateWorldMatrix(true, false);

    upper.getWorldQuaternion(_parentWorldQuat);
    _invParentWorldQuat.copy(_parentWorldQuat).invert();
    _dirLocal
      .copy(_endWorld)
      .sub(_midWorld)
      .normalize()
      .applyQuaternion(_invParentWorldQuat);
    _restAxis.copy(end.position);
    if (_restAxis.lengthSq() < 1e-6) {
      _restAxis.set(fallbackAxisX, fallbackAxisX === 0 ? -1 : 0, 0);
    } else {
      _restAxis.normalize();
    }
    _deltaQuat.setFromUnitVectors(_restAxis, _dirLocal);
    lower.quaternion.slerp(_deltaQuat, weight);
  }

  private updateAuditSnapshot(
    patch: Omit<ContactAuditSnapshot, 'frameSource' | 'timestampMs'>
  ): void {
    this.contactAudit = {
      ...patch,
      frameSource: this.lastFrameSource,
      timestampMs: Date.now(),
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function shortestAngleDiff(current: number, target: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function dampAngle(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  return (
    current + shortestAngleDiff(current, target) * (1 - Math.exp(-lambda * dt))
  );
}
