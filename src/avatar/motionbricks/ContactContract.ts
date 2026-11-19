import * as THREE from 'three';
import {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';
import {RoomObstacle} from '../../scene/LofiRoomEnvironment';
import {MotionBrickPose, RoomPropId} from '../../types';
import {SomaPose, SomaSkeleton} from './mbRuntime';

export type BodyContactRegionId =
  | 'pelvis_support'
  | 'right_hand'
  | 'left_hand'
  | 'both_hands'
  | 'right_foot'
  | 'left_foot';

export type ContactRelationKind = 'support' | 'touch' | 'impact';

export type MotionPrimitiveKind = 'sit' | 'kick' | 'pickup' | 'push' | 'reach';

export type MotionFrameSource =
  | 'motionbricks_onnx'
  | 'motionbricks_soma'
  | 'fallback_procedural';

export type InteractionExecutionStatus =
  | 'idle'
  | 'approaching'
  | 'executing'
  | 'contact_verified'
  | 'sustained_contact'
  | 'failed';

export type ContactFailureReason =
  | 'none'
  | 'unreachable'
  | 'gap_too_large'
  | 'penetration_too_deep'
  | 'normal_misaligned'
  | 'correction_budget_exceeded'
  | 'contact_not_achieved'
  | 'contact_lost';

export interface WorldPoseTransform {
  position: {x: number; y: number; z: number};
  quaternion: {x: number; y: number; z: number; w: number};
  scale?: {x: number; y: number; z: number};
}

/**
 * Prop contact region and approach/facing vectors defined strictly in the
 * prop's LOCAL coordinate system. At execution time, the live world matrix of
 * the prop's Three.js Object3D or Rapier collider transforms this into world space.
 */
export interface PropContactSurfaceLocal {
  shape: 'box' | 'sphere' | 'plane';
  /** Surface center in prop local coordinates. */
  localCenter: [number, number, number];
  /** Half-extents [hx, hy, hz] in prop local coordinates (for sphere, hx = radius). */
  localHalfExtents: [number, number, number];
  /** Outward surface normal in prop local coordinates (unit length). */
  localNormal: [number, number, number];
  /** Direction from surface toward the approach standing spot in prop local space. */
  localApproachDir: [number, number, number];
  /** Direction avatar faces upon completing the interaction, in prop local space. */
  localFacingDir: [number, number, number];
  /** Nominal stand-off distance along approachDir (meters, scaled lightly by avatar). */
  approachStandOff: number;
  /** Optional gaze target offset in prop local space. */
  localLookAt?: [number, number, number];
  /** Optional hover indicator offset in prop local space. */
  localHoverAnchor?: [number, number, number];
}

/**
 * Declarative contract defining which avatar body region must form what
 * geometric contact relationship with the prop surface for the interaction to succeed.
 */
export interface ContactRelationContract {
  bodyRegion: BodyContactRegionId;
  kind: ContactRelationKind;
  motionPrimitive: MotionPrimitiveKind;
  /** Maximum allowed positive surface gap (meters). */
  maxDistance: number;
  /** Maximum allowed interpenetration depth (meters). */
  maxPenetration: number;
  /** Minimum cosine alignment between body contact normal and opposite of surface normal. */
  minNormalAlignment: number;
  /** Hard upper bound on root + IK correction (meters). Exceeding triggers replan or failure. */
  maxCorrectionMeters: number;
  /** Whether valid contact must remain continuously satisfied after transition completes. */
  requiresSustainedContact: boolean;
  /** Max automatic replans allowed when prop shifts or correction exceeds budget. */
  maxReplans?: number;
}

export interface WorldContactSurface {
  shape: 'box' | 'sphere' | 'plane';
  center: THREE.Vector3;
  normal: THREE.Vector3;
  approachDir: THREE.Vector3;
  facingDir: THREE.Vector3;
  facingYaw: number;
  /** Orthonormal world axes [rightX, upY, forwardZ] of the surface OBB. */
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  halfExtents: THREE.Vector3;
  radius: number;
  approachStandOff: number;
  lookAtWorld: THREE.Vector3;
  hoverAnchorWorld: THREE.Vector3;
  worldMatrix: THREE.Matrix4;
}

/**
 * Scale- and proportion-aware anatomical profile measured directly from the bound VRM rig.
 * Used so support contacts (sitting) align the physical underside of the avatar's seated
 * pelvis/thighs onto the seat surface rather than using the Hips bone origin or a fixed offset.
 */
export interface AvatarBodyProfile {
  overallScale: number;
  hipsHeightY: number;
  femurLength: number;
  shinLength: number;
  upperArmLength: number;
  lowerArmLength: number;
  shoulderHeightY: number;
  armReachMax: number;
  /** Vertical offset below Hips bone origin to the seated gluteal/thigh support underside. */
  seatedSupportOffsetBelowHips: number;
  /** Forward offset along avatar facing direction from Hips to the center of the seated support patch. */
  seatedSupportForwardOffset: number;
  pelvisSupportRadius: number;
  pelvisHalfExtents: [number, number, number];
  handRadius: number;
  footRadius: number;
  footSoleOffsetY: number;
  minSitHeightY: number;
  maxSitHeightY: number;
}

export interface BodyContactRegionWorld {
  regionId: BodyContactRegionId;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  halfExtents: [number, number, number];
  /** Optional raw Hips bone world origin (recorded to prove support contact != hips origin). */
  hipsOriginWorld?: THREE.Vector3;
}

export interface ContactVerificationResult {
  valid: boolean;
  gapMeters: number;
  penetrationMeters: number;
  normalAlignment: number;
  correctionAppliedMeters: number;
  withinCorrectionBudget: boolean;
  closestSurfacePoint: THREE.Vector3;
  bodyContactPoint: THREE.Vector3;
  reason: ContactFailureReason;
}

export interface ContactAuditSnapshot {
  propId: RoomPropId | null;
  pose: MotionBrickPose;
  status: InteractionExecutionStatus;
  frameSource: MotionFrameSource;
  bodyRegionId: BodyContactRegionId | null;
  contractKind: ContactRelationKind | null;
  targetSurface: WorldContactSurface | null;
  bodyRegion: BodyContactRegionWorld | null;
  verification: ContactVerificationResult | null;
  failureReason: ContactFailureReason;
  replanCount: number;
  sustainedFrames: number;
  timestampMs: number;
}

const _tmpMatrix = new THREE.Matrix4();
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();
const _tmpRotMat = new THREE.Matrix4();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _vE = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export function createDefaultAvatarBodyProfile(overallScale = 1): AvatarBodyProfile {
  const s = Math.max(0.4, overallScale);
  const hipsHeightY = 0.86 * s;
  const femurLength = 0.38 * s;
  const shinLength = 0.37 * s;
  const upperArmLength = 0.24 * s;
  const lowerArmLength = 0.23 * s;
  const handRadius = 0.052 * s;
  const footRadius = 0.068 * s;
  const shoulderHeightY = 1.24 * s;
  const armReachMax = upperArmLength + lowerArmLength + handRadius * 1.4;
  // Physical seated support patch sits underneath glutes/proximal thighs, below Hips bone origin
  const seatedSupportOffsetBelowHips = femurLength * 0.30;
  const seatedSupportForwardOffset = femurLength * 0.14;
  const pelvisSupportRadius = 0.135 * s;
  return {
    overallScale: s,
    hipsHeightY,
    femurLength,
    shinLength,
    upperArmLength,
    lowerArmLength,
    shoulderHeightY,
    armReachMax,
    seatedSupportOffsetBelowHips,
    seatedSupportForwardOffset,
    pelvisSupportRadius,
    pelvisHalfExtents: [0.14 * s, 0.035 * s, 0.14 * s],
    handRadius,
    footRadius,
    footSoleOffsetY: 0.055 * s,
    minSitHeightY: Math.max(0.16, shinLength * 0.55),
    maxSitHeightY: Math.max(0.55, shinLength * 1.98),
  };
}

/**
 * Measures real VRM anatomical proportions and world scale from normalized bones.
 */
export function measureAvatarBodyProfile(
  vrm: VRM | null,
  fallbackScale = 1
): AvatarBodyProfile {
  if (!vrm) {
    return createDefaultAvatarBodyProfile(fallbackScale);
  }

  vrm.scene.updateMatrixWorld(true);
  const rootPos = new THREE.Vector3();
  const rootScale = new THREE.Vector3(1, 1, 1);
  vrm.scene.getWorldPosition(rootPos);
  vrm.scene.getWorldScale(rootScale);
  const worldScale = Math.max(0.4, (rootScale.x + rootScale.y + rootScale.z) / 3);

  const getBonePos = (name: VRMHumanBoneName): THREE.Vector3 | null => {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) return null;
    const p = new THREE.Vector3();
    node.getWorldPosition(p);
    return p;
  };

  const hips = getBonePos(VRMHumanBoneName.Hips);
  const lUpLeg = getBonePos(VRMHumanBoneName.LeftUpperLeg);
  const lLoLeg = getBonePos(VRMHumanBoneName.LeftLowerLeg);
  const lFoot = getBonePos(VRMHumanBoneName.LeftFoot);
  const rUpLeg = getBonePos(VRMHumanBoneName.RightUpperLeg);
  const rLoLeg = getBonePos(VRMHumanBoneName.RightLowerLeg);
  const rFoot = getBonePos(VRMHumanBoneName.RightFoot);
  const rUpArm = getBonePos(VRMHumanBoneName.RightUpperArm);
  const rLoArm = getBonePos(VRMHumanBoneName.RightLowerArm);
  const rHand = getBonePos(VRMHumanBoneName.RightHand);
  const lUpArm = getBonePos(VRMHumanBoneName.LeftUpperArm);
  const lLoArm = getBonePos(VRMHumanBoneName.LeftLowerArm);
  const lHand = getBonePos(VRMHumanBoneName.LeftHand);

  // Measure actual floor-to-hips height from bone hierarchy when available
  const footY =
    lFoot && rFoot
      ? Math.min(lFoot.y, rFoot.y)
      : lFoot
        ? lFoot.y
        : rFoot
          ? rFoot.y
          : rootPos.y;
  const rawHipHeight = hips ? Math.abs(hips.y - rootPos.y) : 0;
  const hipsHeightY =
    rawHipHeight > 0.25 ? rawHipHeight : 0.86 * worldScale;

  // Overall anatomical scale relative to 0.86m reference anime rig
  const overallScale = Math.max(0.45, hipsHeightY / 0.86);

  const femurL = lUpLeg && lLoLeg ? lUpLeg.distanceTo(lLoLeg) : 0;
  const femurR = rUpLeg && rLoLeg ? rUpLeg.distanceTo(rLoLeg) : 0;
  const femurLength =
    femurL > 0.1 && femurR > 0.1
      ? (femurL + femurR) * 0.5
      : Math.max(femurL, femurR) > 0.1
        ? Math.max(femurL, femurR)
        : 0.38 * overallScale;

  const shinL = lLoLeg && lFoot ? lLoLeg.distanceTo(lFoot) : 0;
  const shinR = rLoLeg && rFoot ? rLoLeg.distanceTo(rFoot) : 0;
  const shinLength =
    shinL > 0.1 && shinR > 0.1
      ? (shinL + shinR) * 0.5
      : Math.max(shinL, shinR) > 0.1
        ? Math.max(shinL, shinR)
        : 0.37 * overallScale;

  const uArmR = rUpArm && rLoArm ? rUpArm.distanceTo(rLoArm) : 0;
  const uArmL = lUpArm && lLoArm ? lUpArm.distanceTo(lLoArm) : 0;
  const upperArmLength =
    Math.max(uArmR, uArmL) > 0.08 ? Math.max(uArmR, uArmL) : 0.24 * overallScale;

  const lArmR = rLoArm && rHand ? rLoArm.distanceTo(rHand) : 0;
  const lArmL = lLoArm && lHand ? lLoArm.distanceTo(lHand) : 0;
  const lowerArmLength =
    Math.max(lArmR, lArmL) > 0.08 ? Math.max(lArmR, lArmL) : 0.23 * overallScale;

  const rawShoulderHeight =
    rUpArm && lUpArm
      ? ((rUpArm.y + lUpArm.y) * 0.5) - rootPos.y
      : rUpArm
        ? rUpArm.y - rootPos.y
        : lUpArm
          ? lUpArm.y - rootPos.y
          : 0;
  const shoulderHeightY =
    rawShoulderHeight > 0.45 ? rawShoulderHeight : 1.24 * overallScale;

  const footSoleOffsetY = Math.max(
    0.03 * overallScale,
    Math.min(0.11 * overallScale, Math.abs(footY - rootPos.y) || 0.055 * overallScale)
  );
  const handRadius = 0.052 * overallScale;
  const footRadius = 0.068 * overallScale;
  const armReachMax = upperArmLength + lowerArmLength + handRadius * 1.4;

  // Seated body support underside lies below Hips bone origin by gluteal/thigh soft-tissue
  // depth (~30% of femur length, scaled naturally by VRM proportions & world scale)
  const seatedSupportOffsetBelowHips = Math.max(0.055, femurLength * 0.30);
  const seatedSupportForwardOffset = femurLength * 0.14;
  const pelvisSupportRadius = Math.max(0.09, femurLength * 0.36);

  return {
    overallScale,
    hipsHeightY,
    femurLength,
    shinLength,
    upperArmLength,
    lowerArmLength,
    shoulderHeightY,
    armReachMax,
    seatedSupportOffsetBelowHips,
    seatedSupportForwardOffset,
    pelvisSupportRadius,
    pelvisHalfExtents: [pelvisSupportRadius, 0.035 * overallScale, pelvisSupportRadius],
    handRadius,
    footRadius,
    footSoleOffsetY,
    minSitHeightY: Math.max(0.16, shinLength * 0.55),
    maxSitHeightY: Math.max(0.55, shinLength * 1.98),
  };
}

/**
 * Resolves a prop-local surface declaration into live world space using either
 * the prop's Three.js Object3D world matrix or a live Rapier collider world pose.
 */
export function resolveWorldContactSurface(
  localSurface: PropContactSurfaceLocal,
  source: THREE.Object3D | WorldPoseTransform
): WorldContactSurface {
  const worldMatrix = new THREE.Matrix4();
  if (source instanceof THREE.Object3D) {
    source.updateWorldMatrix(true, false);
    worldMatrix.copy(source.matrixWorld);
  } else {
    _tmpPos.set(source.position.x, source.position.y, source.position.z);
    _tmpQuat.set(
      source.quaternion.x,
      source.quaternion.y,
      source.quaternion.z,
      source.quaternion.w
    );
    if (_tmpQuat.lengthSq() < 1e-6) {
      _tmpQuat.identity();
    } else {
      _tmpQuat.normalize();
    }
    _tmpScale.set(
      source.scale?.x ?? 1,
      source.scale?.y ?? 1,
      source.scale?.z ?? 1
    );
    worldMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
  }

  worldMatrix.decompose(_tmpPos, _tmpQuat, _tmpScale);
  const absScaleX = Math.max(1e-4, Math.abs(_tmpScale.x));
  const absScaleY = Math.max(1e-4, Math.abs(_tmpScale.y));
  const absScaleZ = Math.max(1e-4, Math.abs(_tmpScale.z));

  const center = new THREE.Vector3(...localSurface.localCenter).applyMatrix4(worldMatrix);

  _tmpRotMat.makeRotationFromQuaternion(_tmpQuat);
  const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(_tmpQuat).normalize();
  const axisY = new THREE.Vector3(0, 1, 0).applyQuaternion(_tmpQuat).normalize();
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(_tmpQuat).normalize();

  // Normal transforms with inverse-transpose under non-uniform scale
  const normal = new THREE.Vector3(
    localSurface.localNormal[0] / absScaleX,
    localSurface.localNormal[1] / absScaleY,
    localSurface.localNormal[2] / absScaleZ
  )
    .applyQuaternion(_tmpQuat)
    .normalize();
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);

  const approachDir = new THREE.Vector3(...localSurface.localApproachDir)
    .applyQuaternion(_tmpQuat);
  approachDir.y = 0;
  if (approachDir.lengthSq() < 1e-6) {
    approachDir.set(0, 0, 1).applyQuaternion(_tmpQuat);
    approachDir.y = 0;
  }
  if (approachDir.lengthSq() < 1e-6) {
    approachDir.set(0, 0, 1);
  } else {
    approachDir.normalize();
  }

  const facingDir = new THREE.Vector3(...localSurface.localFacingDir)
    .applyQuaternion(_tmpQuat);
  facingDir.y = 0;
  if (facingDir.lengthSq() < 1e-6) {
    facingDir.copy(approachDir);
  } else {
    facingDir.normalize();
  }
  const facingYaw = Math.atan2(facingDir.x, facingDir.z);

  const halfExtents = new THREE.Vector3(
    Math.max(0.005, localSurface.localHalfExtents[0] * absScaleX),
    Math.max(0.002, localSurface.localHalfExtents[1] * absScaleY),
    Math.max(0.005, localSurface.localHalfExtents[2] * absScaleZ)
  );
  const radius =
    localSurface.shape === 'sphere'
      ? Math.max(halfExtents.x, halfExtents.y, halfExtents.z)
      : Math.hypot(halfExtents.x, halfExtents.z);

  const lookAtWorld = localSurface.localLookAt
    ? new THREE.Vector3(...localSurface.localLookAt).applyMatrix4(worldMatrix)
    : center.clone().addScaledVector(normal, 0.08);
  const hoverAnchorWorld = localSurface.localHoverAnchor
    ? new THREE.Vector3(...localSurface.localHoverAnchor).applyMatrix4(worldMatrix)
    : center.clone().add(new THREE.Vector3(0, 0.22, 0));

  const meanHorizScale = (absScaleX + absScaleZ) * 0.5;
  return {
    shape: localSurface.shape,
    center,
    normal,
    approachDir,
    facingDir,
    facingYaw,
    axes: [axisX, axisY, axisZ],
    halfExtents,
    radius,
    approachStandOff: localSurface.approachStandOff * meanHorizScale,
    lookAtWorld,
    hoverAnchorWorld,
    worldMatrix,
  };
}

/**
 * Computes the world-space contact anchor & approach stance purely from the
 * resolved live WorldContactSurface and AvatarBodyProfile (zero hardcoded room coords).
 */
export function computeInteractionStanceFromSurface(
  surface: WorldContactSurface,
  profile: AvatarBodyProfile,
  contract: ContactRelationContract,
  currentAvatarPos: {x: number; z: number}
): {
  approachPos: THREE.Vector3;
  contactAnchorPos: THREE.Vector3;
  standUpPos: THREE.Vector3;
  targetYaw: number;
} {
  if (contract.kind === 'support') {
    // Seated pelvis support patch sits slightly forward of Hips along facingDir,
    // so place root anchor slightly behind surface center along -facingDir.
    const seatRootX =
      surface.center.x - surface.facingDir.x * profile.seatedSupportForwardOffset;
    const seatRootZ =
      surface.center.z - surface.facingDir.z * profile.seatedSupportForwardOffset;
    const contactAnchorPos = new THREE.Vector3(seatRootX, 0, seatRootZ);

    const standClearance = Math.max(
      0.28 * profile.overallScale,
      surface.approachStandOff
    );
    const standUpPos = new THREE.Vector3(
      surface.center.x + surface.approachDir.x * standClearance,
      0,
      surface.center.z + surface.approachDir.z * standClearance
    );

    return {
      approachPos: contactAnchorPos.clone(),
      contactAnchorPos,
      standUpPos,
      targetYaw: surface.facingYaw,
    };
  }

  // Touch or impact: stand at approachStandOff scaled lightly by arm/leg length
  let dirX = surface.approachDir.x;
  let dirZ = surface.approachDir.z;
  if (surface.shape === 'sphere' || contract.motionPrimitive === 'kick' || contract.motionPrimitive === 'pickup' || contract.motionPrimitive === 'push') {
    // For free-standing dynamic props, approach from avatar's side so we don't walk around unnecessarily
    const toAvatarX = currentAvatarPos.x - surface.center.x;
    const toAvatarZ = currentAvatarPos.z - surface.center.z;
    const len = Math.hypot(toAvatarX, toAvatarZ);
    if (len > 0.08) {
      dirX = toAvatarX / len;
      dirZ = toAvatarZ / len;
    }
  }

  const desiredStandOff =
    contract.bodyRegion === 'right_hand' ||
    contract.bodyRegion === 'left_hand' ||
    contract.bodyRegion === 'both_hands'
      ? Math.min(
          Math.max(0.24 * profile.overallScale, surface.approachStandOff),
          Math.max(0.30, profile.armReachMax * 0.88 + surface.radius * 0.35)
        )
      : Math.max(0.26 * profile.overallScale, surface.approachStandOff * profile.overallScale);

  const ax = surface.center.x + dirX * desiredStandOff;
  const az = surface.center.z + dirZ * desiredStandOff;
  const approachPos = new THREE.Vector3(ax, 0, az);
  const toTargetYaw = Math.atan2(surface.center.x - ax, surface.center.z - az);

  return {
    approachPos,
    contactAnchorPos: approachPos.clone(),
    standUpPos: approachPos.clone(),
    targetYaw: toTargetYaw,
  };
}

/**
 * Checks whether the resolved live target surface is physically reachable for
 * the given avatar body profile and contract without cheating or exceeding correction budget.
 */
export function checkTargetReachability(
  surface: WorldContactSurface,
  profile: AvatarBodyProfile,
  contract: ContactRelationContract,
  options?: {
    obstacles?: RoomObstacle[];
    roomBounds?: {minX: number; maxX: number; minZ: number; maxZ: number};
    ignoreObstacleId?: string | null;
  }
): {reachable: boolean; reason: ContactFailureReason; detail: string} {
  if (contract.kind === 'support') {
    if (surface.normal.y < 0.7) {
      return {
        reachable: false,
        reason: 'normal_misaligned',
        detail: `Seat surface tilted too steeply (normal.y=${surface.normal.y.toFixed(2)})`,
      };
    }
    const seatY = surface.center.y;
    if (seatY < profile.minSitHeightY || seatY > profile.maxSitHeightY) {
      return {
        reachable: false,
        reason: 'unreachable',
        detail: `Seat height ${seatY.toFixed(2)}m outside avatar sit envelope [${profile.minSitHeightY.toFixed(2)}m, ${profile.maxSitHeightY.toFixed(2)}m]`,
      };
    }
  } else if (
    contract.bodyRegion === 'right_hand' ||
    contract.bodyRegion === 'left_hand' ||
    contract.bodyRegion === 'both_hands'
  ) {
    const maxReachY =
      profile.shoulderHeightY + profile.armReachMax + contract.maxCorrectionMeters;
    const minReachY = -0.02;
    if (surface.center.y > maxReachY || surface.center.y < minReachY) {
      return {
        reachable: false,
        reason: 'unreachable',
        detail: `Hand target height ${surface.center.y.toFixed(2)}m outside reachable range [${minReachY.toFixed(2)}m, ${maxReachY.toFixed(2)}m]`,
      };
    }
  } else if (
    contract.bodyRegion === 'right_foot' ||
    contract.bodyRegion === 'left_foot'
  ) {
    const maxKickY = profile.hipsHeightY * 0.88 + contract.maxCorrectionMeters;
    if (surface.center.y > maxKickY || surface.center.y < -0.05) {
      return {
        reachable: false,
        reason: 'unreachable',
        detail: `Foot target height ${surface.center.y.toFixed(2)}m outside kick range [0, ${maxKickY.toFixed(2)}m]`,
      };
    }
  }

  // If room bounds are enforced, verify the target isn't completely outside walkable reach
  if (options?.roomBounds) {
    const b = options.roomBounds;
    const clampedX = THREE.MathUtils.clamp(surface.center.x, b.minX, b.maxX);
    const clampedZ = THREE.MathUtils.clamp(surface.center.z, b.minZ, b.maxZ);
    const excessDist = Math.hypot(surface.center.x - clampedX, surface.center.z - clampedZ);
    const maxAllowedOutOfBounds =
      contract.kind === 'support'
        ? surface.radius + contract.maxCorrectionMeters + 0.15
        : profile.armReachMax + surface.radius + contract.maxCorrectionMeters + 0.35;
    if (excessDist > maxAllowedOutOfBounds) {
      return {
        reachable: false,
        reason: 'unreachable',
        detail: `Target lies ${excessDist.toFixed(2)}m outside walkable reach`,
      };
    }
  }

  return {reachable: true, reason: 'none', detail: 'reachable'};
}

/**
 * Computes the FINAL-POSE body contact region in world space directly from the
 * posed VRM normalized bones AFTER retargeting, IK, and physics root update.
 *
 * Crucially, `'pelvis_support'` is computed as the physical underside of the seated
 * pelvis/thigh region (offset from `Hips` by `profile.seatedSupportOffsetBelowHips`
 * and `seatedSupportForwardOffset`), NEVER the `Hips` bone origin itself.
 */
export function computeBodyContactRegionWorld(
  vrm: VRM | null,
  profile: AvatarBodyProfile,
  regionId: BodyContactRegionId,
  anchorPos: THREE.Vector3,
  anchorYaw: number,
  targetSurfaceHint?: WorldContactSurface | null,
  fallbackSoma?: {sk: SomaSkeleton; pose: SomaPose} | null
): BodyContactRegionWorld {
  const forwardX = Math.sin(anchorYaw);
  const forwardZ = Math.cos(anchorYaw);

  const getVrmWorld = (bone: VRMHumanBoneName, out: THREE.Vector3): boolean => {
    const node = vrm?.humanoid.getNormalizedBoneNode(bone);
    if (!node) return false;
    node.getWorldPosition(out);
    return true;
  };

  if (regionId === 'pelvis_support') {
    const hipsPos = new THREE.Vector3();
    let hasHips = getVrmWorld(VRMHumanBoneName.Hips, hipsPos);

    if (!hasHips && fallbackSoma) {
      const fk = fallbackSoma.sk.fk(fallbackSoma.pose);
      const scale = profile.hipsHeightY / Math.max(0.2, fallbackSoma.sk.reference[0][1]);
      hipsPos.set(
        anchorPos.x,
        anchorPos.y + fk.wp[0][1] * scale,
        anchorPos.z
      );
      hasHips = true;
    }
    if (!hasHips) {
      hipsPos.set(anchorPos.x, anchorPos.y + profile.hipsHeightY, anchorPos.z);
    }

    // Measure actual thigh midpoint if posed in VRM to anchor support region along seated thighs
    const lThigh = _vA;
    const rThigh = _vB;
    const lKnee = _vC;
    const rKnee = _vD;
    const hasThighs =
      getVrmWorld(VRMHumanBoneName.LeftUpperLeg, lThigh) &&
      getVrmWorld(VRMHumanBoneName.RightUpperLeg, rThigh);
    const hasKnees =
      getVrmWorld(VRMHumanBoneName.LeftLowerLeg, lKnee) &&
      getVrmWorld(VRMHumanBoneName.RightLowerLeg, rKnee);

    const supportCenter = hipsPos.clone();
    if (hasThighs && hasKnees) {
      // Proximal thigh direction from hip sockets toward knees
      const thighMid = lThigh.add(rThigh).multiplyScalar(0.5);
      const kneeMid = lKnee.add(rKnee).multiplyScalar(0.5);
      const thighDir = _vE.copy(kneeMid).sub(thighMid);
      const horizLen = Math.hypot(thighDir.x, thighDir.z);
      if (horizLen > 0.04) {
        thighDir.x /= horizLen;
        thighDir.z /= horizLen;
        supportCenter.x = thighMid.x + thighDir.x * profile.seatedSupportForwardOffset;
        supportCenter.z = thighMid.z + thighDir.z * profile.seatedSupportForwardOffset;
      } else {
        supportCenter.x += forwardX * profile.seatedSupportForwardOffset;
        supportCenter.z += forwardZ * profile.seatedSupportForwardOffset;
      }
      // Support underside is below the lower of hips/proximal thigh root
      supportCenter.y =
        Math.min(hipsPos.y, thighMid.y) - profile.seatedSupportOffsetBelowHips;
    } else {
      supportCenter.x += forwardX * profile.seatedSupportForwardOffset;
      supportCenter.z += forwardZ * profile.seatedSupportForwardOffset;
      supportCenter.y = hipsPos.y - profile.seatedSupportOffsetBelowHips;
    }

    // Seated support contact normal points downward (-Y) against the upward seat surface
    const normal = new THREE.Vector3(0, -1, 0);
    return {
      regionId,
      center: supportCenter,
      normal,
      radius: profile.pelvisSupportRadius,
      halfExtents: [...profile.pelvisHalfExtents],
      hipsOriginWorld: hipsPos,
    };
  }

  if (
    regionId === 'right_hand' ||
    regionId === 'left_hand' ||
    regionId === 'both_hands'
  ) {
    const computeOneHand = (side: 'left' | 'right'): THREE.Vector3 => {
      const handPos = new THREE.Vector3();
      const lowerPos = new THREE.Vector3();
      const handBone =
        side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand;
      const lowerBone =
        side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm;
      const gotHand = getVrmWorld(handBone, handPos);
      const gotLower = getVrmWorld(lowerBone, lowerPos);
      if (gotHand && gotLower) {
        const dir = _vA.copy(handPos).sub(lowerPos);
        if (dir.lengthSq() > 1e-6) {
          dir.normalize();
          handPos.addScaledVector(dir, profile.handRadius * 0.65);
        }
        return handPos;
      }
      if (gotHand) return handPos;
      if (fallbackSoma) {
        const fk = fallbackSoma.sk.fk(fallbackSoma.pose);
        const idx = side === 'left' ? 14 : 42;
        const scale = profile.hipsHeightY / Math.max(0.2, fallbackSoma.sk.reference[0][1]);
        const local = new THREE.Vector3(
          (fk.wp[idx][0] - fk.wp[0][0]) * scale,
          fk.wp[idx][1] * scale,
          (fk.wp[idx][2] - fk.wp[0][2]) * scale
        );
        local.applyAxisAngle(_worldUp, anchorYaw);
        return local.add(anchorPos);
      }
      const lateral = (side === 'left' ? 0.22 : -0.22) * profile.overallScale;
      return new THREE.Vector3(
        anchorPos.x + Math.cos(anchorYaw) * lateral + forwardX * 0.28 * profile.overallScale,
        anchorPos.y + profile.shoulderHeightY * 0.82,
        anchorPos.z - Math.sin(anchorYaw) * lateral + forwardZ * 0.28 * profile.overallScale
      );
    };

    let center: THREE.Vector3;
    if (regionId === 'both_hands') {
      const lh = computeOneHand('left');
      const rh = computeOneHand('right');
      // Use the hand closest to target surface when verifying dual-hand reach, or midpoint
      if (targetSurfaceHint) {
        center =
          lh.distanceToSquared(targetSurfaceHint.center) <=
          rh.distanceToSquared(targetSurfaceHint.center)
            ? lh
            : rh;
      } else {
        center = lh.add(rh).multiplyScalar(0.5);
      }
    } else {
      center = computeOneHand(regionId === 'left_hand' ? 'left' : 'right');
    }

    const normal = new THREE.Vector3(forwardX, -0.2, forwardZ).normalize();
    if (targetSurfaceHint) {
      const toSurf = _vA.copy(targetSurfaceHint.center).sub(center);
      if (toSurf.lengthSq() > 1e-6) {
        normal.copy(toSurf).normalize();
      }
    }

    return {
      regionId,
      center,
      normal,
      radius: profile.handRadius,
      halfExtents: [profile.handRadius, profile.handRadius, profile.handRadius],
    };
  }

  // Foot impact/contact region ('right_foot' | 'left_foot')
  const isLeft = regionId === 'left_foot';
  const footPos = new THREE.Vector3();
  const toesPos = new THREE.Vector3();
  const gotFoot = getVrmWorld(
    isLeft ? VRMHumanBoneName.LeftFoot : VRMHumanBoneName.RightFoot,
    footPos
  );
  const gotToes = getVrmWorld(
    isLeft ? VRMHumanBoneName.LeftToes : VRMHumanBoneName.RightToes,
    toesPos
  );

  let center: THREE.Vector3;
  if (gotFoot && gotToes) {
    center = footPos.clone().lerp(toesPos, 0.55);
  } else if (gotFoot) {
    center = footPos
      .clone()
      .add(new THREE.Vector3(forwardX * 0.06 * profile.overallScale, 0, forwardZ * 0.06 * profile.overallScale));
  } else if (fallbackSoma) {
    const fk = fallbackSoma.sk.fk(fallbackSoma.pose);
    const footIdx = isLeft ? 69 : 74;
    const toeIdx = isLeft ? 70 : 75;
    const scale = profile.hipsHeightY / Math.max(0.2, fallbackSoma.sk.reference[0][1]);
    const fx = ((fk.wp[footIdx][0] + fk.wp[toeIdx][0]) * 0.5 - fk.wp[0][0]) * scale;
    const fy = ((fk.wp[footIdx][1] + fk.wp[toeIdx][1]) * 0.5) * scale;
    const fz = ((fk.wp[footIdx][2] + fk.wp[toeIdx][2]) * 0.5 - fk.wp[0][2]) * scale;
    center = new THREE.Vector3(fx, fy, fz).applyAxisAngle(_worldUp, anchorYaw).add(anchorPos);
  } else {
    center = new THREE.Vector3(
      anchorPos.x + forwardX * 0.22 * profile.overallScale,
      anchorPos.y + profile.footSoleOffsetY,
      anchorPos.z + forwardZ * 0.22 * profile.overallScale
    );
  }

  const normal = new THREE.Vector3(forwardX, 0, forwardZ).normalize();
  if (targetSurfaceHint) {
    const toSurf = _vA.copy(targetSurfaceHint.center).sub(center);
    if (toSurf.lengthSq() > 1e-6) {
      normal.copy(toSurf).normalize();
    }
  }

  return {
    regionId,
    center,
    normal,
    radius: profile.footRadius,
    halfExtents: [profile.footRadius, profile.footRadius * 0.7, profile.footRadius * 1.2],
  };
}

/**
 * Computes closest point on a WorldContactSurface (OBB box, plane, or sphere)
 * and evaluates distance, penetration depth, normal alignment, and correction budget.
 */
export function evaluateContactVerification(
  bodyRegion: BodyContactRegionWorld,
  surface: WorldContactSurface,
  contract: ContactRelationContract,
  correctionAppliedMeters: number
): ContactVerificationResult {
  const withinCorrectionBudget =
    correctionAppliedMeters <= contract.maxCorrectionMeters + 1e-4;

  const closestSurfacePoint = new THREE.Vector3();
  const bodyContactPoint = bodyRegion.center.clone();
  let gapMeters = 0;
  let penetrationMeters = 0;
  let normalAlignment = 1;

  if (contract.kind === 'support') {
    // Project body support underside onto the seat OBB frame
    const rel = _vA.copy(bodyRegion.center).sub(surface.center);
    const lx = rel.dot(surface.axes[0]);
    const ly = rel.dot(surface.axes[1]);
    const lz = rel.dot(surface.axes[2]);

    const hx = surface.halfExtents.x;
    const hz = surface.halfExtents.z;

    // Clamped point on the seat top plane (local y = 0 since surface.center is ON the seat top surface)
    const cx = THREE.MathUtils.clamp(lx, -hx, hx);
    const cz = THREE.MathUtils.clamp(lz, -hz, hz);

    closestSurfacePoint
      .copy(surface.center)
      .addScaledVector(surface.axes[0], cx)
      .addScaledVector(surface.axes[2], cz);

    const overhangX = Math.max(0, Math.abs(lx) - (hx + bodyRegion.radius * 0.35));
    const overhangZ = Math.max(0, Math.abs(lz) - (hz + bodyRegion.radius * 0.35));
    const lateralOverhang = Math.hypot(overhangX, overhangZ);

    // Signed height above the seat top surface along surface.normal
    const signedHeight = rel.dot(surface.normal);
    if (signedHeight < 0) {
      penetrationMeters = -signedHeight;
      gapMeters = lateralOverhang;
    } else {
      penetrationMeters = 0;
      gapMeters = Math.hypot(lateralOverhang, signedHeight);
    }

    // Downward body support normal vs upward seat surface normal -> dot(-bodyNormal, surfaceNormal)
    normalAlignment = THREE.MathUtils.clamp(
      -bodyRegion.normal.dot(surface.normal),
      -1,
      1
    );
  } else if (surface.shape === 'sphere') {
    const offset = _vA.copy(bodyRegion.center).sub(surface.center);
    const centerDist = offset.length();
    const dir =
      centerDist > 1e-6 ? offset.clone().multiplyScalar(1 / centerDist) : surface.normal.clone();
    closestSurfacePoint.copy(surface.center).addScaledVector(dir, surface.radius);
    bodyContactPoint
      .copy(bodyRegion.center)
      .addScaledVector(dir, -bodyRegion.radius);

    const signedGap = centerDist - surface.radius - bodyRegion.radius;
    gapMeters = Math.max(0, signedGap);
    penetrationMeters = Math.max(0, -signedGap);

    // For a sphere, outward surface normal at impact point is `dir`; body normal should point into `-dir`
    normalAlignment = THREE.MathUtils.clamp(-bodyRegion.normal.dot(dir), -1, 1);
  } else {
    // Box or plane touch/impact: closest point on OBB
    const rel = _vA.copy(bodyRegion.center).sub(surface.center);
    const lx = rel.dot(surface.axes[0]);
    const ly = rel.dot(surface.axes[1]);
    const lz = rel.dot(surface.axes[2]);

    const hx = surface.halfExtents.x;
    const hy = surface.shape === 'plane' ? 0.004 : surface.halfExtents.y;
    const hz = surface.halfExtents.z;

    const cx = THREE.MathUtils.clamp(lx, -hx, hx);
    const cy = THREE.MathUtils.clamp(ly, -hy, hy);
    const cz = THREE.MathUtils.clamp(lz, -hz, hz);

    closestSurfacePoint
      .copy(surface.center)
      .addScaledVector(surface.axes[0], cx)
      .addScaledVector(surface.axes[1], cy)
      .addScaledVector(surface.axes[2], cz);

    const insideBox =
      Math.abs(lx) < hx && Math.abs(ly) < hy && Math.abs(lz) < hz;

    if (insideBox) {
      const penX = hx - Math.abs(lx);
      const penY = hy - Math.abs(ly);
      const penZ = hz - Math.abs(lz);
      penetrationMeters = Math.min(penX, penY, penZ) + bodyRegion.radius * 0.5;
      gapMeters = 0;
    } else {
      const distToSurface = bodyRegion.center.distanceTo(closestSurfacePoint);
      const signedGap = distToSurface - bodyRegion.radius;
      gapMeters = Math.max(0, signedGap);
      penetrationMeters = Math.max(0, -signedGap);

      const dirOut = _vB.copy(bodyRegion.center).sub(closestSurfacePoint);
      if (dirOut.lengthSq() > 1e-6) {
        dirOut.normalize();
        bodyContactPoint
          .copy(bodyRegion.center)
          .addScaledVector(dirOut, -bodyRegion.radius);
      }
    }

    // Contact direction check: body normal must oppose local exterior face or surface normal
    const outVec = _vC.copy(bodyRegion.center).sub(closestSurfacePoint);
    const faceNormal =
      outVec.lengthSq() > 1e-6 ? outVec.normalize() : surface.normal;
    const alignFace = -bodyRegion.normal.dot(faceNormal);
    const alignDeclared = -bodyRegion.normal.dot(surface.normal);
    normalAlignment = THREE.MathUtils.clamp(
      Math.max(alignFace, alignDeclared),
      -1,
      1
    );
  }

  let reason: ContactFailureReason = 'none';
  if (!withinCorrectionBudget) {
    reason = 'correction_budget_exceeded';
  } else if (penetrationMeters > contract.maxPenetration) {
    reason = 'penetration_too_deep';
  } else if (gapMeters > contract.maxDistance) {
    reason = 'gap_too_large';
  } else if (normalAlignment < contract.minNormalAlignment) {
    reason = 'normal_misaligned';
  }

  return {
    valid: reason === 'none',
    gapMeters,
    penetrationMeters,
    normalAlignment,
    correctionAppliedMeters,
    withinCorrectionBudget,
    closestSurfacePoint,
    bodyContactPoint,
    reason,
  };
}

/**
 * Computes the exact root correction vector needed to seat the underside of
 * `pelvis_support` cleanly onto `surface`, clamped to `contract.maxCorrectionMeters`.
 */
export function computeBoundedSupportCorrection(
  bodyRegion: BodyContactRegionWorld,
  surface: WorldContactSurface,
  contract: ContactRelationContract
): {
  requiredDelta: THREE.Vector3;
  appliedDelta: THREE.Vector3;
  requiredMagnitude: number;
  appliedMagnitude: number;
  exceededBudget: boolean;
} {
  // Desired point: center of the seat top surface (keeping slight lateral leeway inside seat footprint)
  const rel = _vA.copy(bodyRegion.center).sub(surface.center);
  const lx = rel.dot(surface.axes[0]);
  const lz = rel.dot(surface.axes[2]);

  // Pull inside safe seat footprint (70% of half-extents) if overhanging
  const safeHx = surface.halfExtents.x * 0.65;
  const safeHz = surface.halfExtents.z * 0.65;
  const clampedLx = THREE.MathUtils.clamp(lx, -safeHx, safeHx);
  const clampedLz = THREE.MathUtils.clamp(lz, -safeHz, safeHz);

  const desiredSupportWorld = _vB
    .copy(surface.center)
    .addScaledVector(surface.axes[0], clampedLx)
    .addScaledVector(surface.axes[2], clampedLz);

  const requiredDelta = desiredSupportWorld.clone().sub(bodyRegion.center);
  const requiredMagnitude = requiredDelta.length();
  const budget = Math.max(0, contract.maxCorrectionMeters);
  const exceededBudget = requiredMagnitude > budget + 1e-4;

  const appliedDelta = requiredDelta.clone();
  if (requiredMagnitude > budget && requiredMagnitude > 1e-6) {
    appliedDelta.multiplyScalar(budget / requiredMagnitude);
  }

  return {
    requiredDelta,
    appliedDelta,
    requiredMagnitude,
    appliedMagnitude: appliedDelta.length(),
    exceededBudget,
  };
}

/**
 * Adapts a SOMA `ardy_sit` target window so its seated Hips height aligns with
 * the live seat surface + avatar seated support underside offset, instead of
 * relying on a hardcoded chair height.
 */
export function adaptSomaSitWindowToSurface(
  window: SomaPose[],
  sk: SomaSkeleton,
  surface: WorldContactSurface,
  profile: AvatarBodyProfile
): SomaPose[] {
  const retargetScale = profile.hipsHeightY / Math.max(0.2, sk.reference[0][1]);
  // Desired VRM Hips world Y = seat surface Y + underside offset below Hips
  const desiredVrmHipsY = surface.center.y + profile.seatedSupportOffsetBelowHips;
  // Convert desired VRM Hips delta back into SOMA Hips Y space
  const desiredDeltaY = desiredVrmHipsY - profile.hipsHeightY;
  const desiredSomaHipsY = sk.reference[0][1] + desiredDeltaY / Math.max(0.2, retargetScale);

  // Measure the final frame's existing SOMA Hips Y in the window and shift smoothly
  const lastFrameHipsY = window[window.length - 1]?.[0]?.[1] ?? desiredSomaHipsY;
  const shiftY = desiredSomaHipsY - lastFrameHipsY;

  return window.map((frame) =>
    frame.map((v, idx) =>
      idx === 0
        ? [v[0], v[1] + shiftY, v[2], v[3], v[4], v[5], v[6]]
        : [v[0], v[1], v[2], v[3], v[4], v[5], v[6]]
    )
  );
}

/**
 * Default declarative contact contracts for each room prop type.
 * Geometry lives in prop-local space (configured per prop in LofiRoomEnvironment),
 * while contact tolerances & body region semantics are declared here.
 */
export const DEFAULT_CONTACT_CONTRACTS: Record<RoomPropId, ContactRelationContract> = {
  floor: {
    bodyRegion: 'right_foot',
    kind: 'support',
    motionPrimitive: 'reach',
    maxDistance: 0.12,
    maxPenetration: 0.08,
    minNormalAlignment: 0.6,
    maxCorrectionMeters: 0.15,
    requiresSustainedContact: false,
  },
  desk_chair: {
    bodyRegion: 'pelvis_support',
    kind: 'support',
    motionPrimitive: 'sit',
    maxDistance: 0.045,
    maxPenetration: 0.045,
    minNormalAlignment: 0.85,
    maxCorrectionMeters: 0.22,
    requiresSustainedContact: true,
    maxReplans: 1,
  },
  bed: {
    bodyRegion: 'pelvis_support',
    kind: 'support',
    motionPrimitive: 'sit',
    maxDistance: 0.05,
    maxPenetration: 0.055,
    minNormalAlignment: 0.85,
    maxCorrectionMeters: 0.24,
    requiresSustainedContact: true,
    maxReplans: 1,
  },
  laptop: {
    bodyRegion: 'pelvis_support',
    kind: 'support',
    motionPrimitive: 'sit',
    maxDistance: 0.045,
    maxPenetration: 0.045,
    minNormalAlignment: 0.85,
    maxCorrectionMeters: 0.22,
    requiresSustainedContact: true,
    maxReplans: 1,
  },
  coffee_mug: {
    bodyRegion: 'pelvis_support',
    kind: 'support',
    motionPrimitive: 'sit',
    maxDistance: 0.045,
    maxPenetration: 0.045,
    minNormalAlignment: 0.85,
    maxCorrectionMeters: 0.22,
    requiresSustainedContact: true,
    maxReplans: 1,
  },
  desk_lamp: {
    bodyRegion: 'right_hand',
    kind: 'touch',
    motionPrimitive: 'reach',
    maxDistance: 0.09,
    maxPenetration: 0.08,
    minNormalAlignment: 0.25,
    maxCorrectionMeters: 0.18,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  window: {
    bodyRegion: 'right_hand',
    kind: 'touch',
    motionPrimitive: 'reach',
    maxDistance: 0.11,
    maxPenetration: 0.09,
    minNormalAlignment: 0.2,
    maxCorrectionMeters: 0.20,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  cat_plushie: {
    bodyRegion: 'right_hand',
    kind: 'touch',
    motionPrimitive: 'reach',
    maxDistance: 0.085,
    maxPenetration: 0.08,
    minNormalAlignment: 0.25,
    maxCorrectionMeters: 0.20,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  bookshelf: {
    bodyRegion: 'right_hand',
    kind: 'touch',
    motionPrimitive: 'reach',
    maxDistance: 0.10,
    maxPenetration: 0.08,
    minNormalAlignment: 0.2,
    maxCorrectionMeters: 0.18,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  toy_ball: {
    bodyRegion: 'right_foot',
    kind: 'impact',
    motionPrimitive: 'kick',
    maxDistance: 0.095,
    maxPenetration: 0.11,
    minNormalAlignment: 0.2,
    maxCorrectionMeters: 0.16,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  floor_cushion: {
    bodyRegion: 'right_hand',
    kind: 'impact',
    motionPrimitive: 'push',
    maxDistance: 0.11,
    maxPenetration: 0.12,
    minNormalAlignment: 0.15,
    maxCorrectionMeters: 0.18,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
  plush_die: {
    bodyRegion: 'right_hand',
    kind: 'impact',
    motionPrimitive: 'pickup',
    maxDistance: 0.10,
    maxPenetration: 0.11,
    minNormalAlignment: 0.15,
    maxCorrectionMeters: 0.18,
    requiresSustainedContact: false,
    maxReplans: 1,
  },
};
