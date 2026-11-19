import * as THREE from 'three';
import {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';
import {
  quatInv,
  quatMul,
  SomaPose,
  SomaSkeleton,
} from './mbRuntime';

interface SomaToVrmMapping {
  somaIdx: number;
  vrmBone: VRMHumanBoneName;
  vrmParent: VRMHumanBoneName | null;
}

// Authoritative SOMA 77-joint -> VRMHumanoid normalized bone mapping
const SOMA_VRM_MAP: SomaToVrmMapping[] = [
  {somaIdx: 0, vrmBone: VRMHumanBoneName.Hips, vrmParent: null},
  {somaIdx: 1, vrmBone: VRMHumanBoneName.Spine, vrmParent: VRMHumanBoneName.Hips},
  {somaIdx: 3, vrmBone: VRMHumanBoneName.Chest, vrmParent: VRMHumanBoneName.Spine},
  {somaIdx: 5, vrmBone: VRMHumanBoneName.Neck, vrmParent: VRMHumanBoneName.Chest},
  {somaIdx: 6, vrmBone: VRMHumanBoneName.Head, vrmParent: VRMHumanBoneName.Neck},
  {somaIdx: 11, vrmBone: VRMHumanBoneName.LeftShoulder, vrmParent: VRMHumanBoneName.Chest},
  {somaIdx: 12, vrmBone: VRMHumanBoneName.LeftUpperArm, vrmParent: VRMHumanBoneName.LeftShoulder},
  {somaIdx: 13, vrmBone: VRMHumanBoneName.LeftLowerArm, vrmParent: VRMHumanBoneName.LeftUpperArm},
  {somaIdx: 14, vrmBone: VRMHumanBoneName.LeftHand, vrmParent: VRMHumanBoneName.LeftLowerArm},
  {somaIdx: 39, vrmBone: VRMHumanBoneName.RightShoulder, vrmParent: VRMHumanBoneName.Chest},
  {somaIdx: 40, vrmBone: VRMHumanBoneName.RightUpperArm, vrmParent: VRMHumanBoneName.RightShoulder},
  {somaIdx: 41, vrmBone: VRMHumanBoneName.RightLowerArm, vrmParent: VRMHumanBoneName.RightUpperArm},
  {somaIdx: 42, vrmBone: VRMHumanBoneName.RightHand, vrmParent: VRMHumanBoneName.RightLowerArm},
  {somaIdx: 67, vrmBone: VRMHumanBoneName.LeftUpperLeg, vrmParent: VRMHumanBoneName.Hips},
  {somaIdx: 68, vrmBone: VRMHumanBoneName.LeftLowerLeg, vrmParent: VRMHumanBoneName.LeftUpperLeg},
  {somaIdx: 69, vrmBone: VRMHumanBoneName.LeftFoot, vrmParent: VRMHumanBoneName.LeftLowerLeg},
  {somaIdx: 70, vrmBone: VRMHumanBoneName.LeftToes, vrmParent: VRMHumanBoneName.LeftFoot},
  {somaIdx: 72, vrmBone: VRMHumanBoneName.RightUpperLeg, vrmParent: VRMHumanBoneName.Hips},
  {somaIdx: 73, vrmBone: VRMHumanBoneName.RightLowerLeg, vrmParent: VRMHumanBoneName.RightUpperLeg},
  {somaIdx: 74, vrmBone: VRMHumanBoneName.RightFoot, vrmParent: VRMHumanBoneName.RightLowerLeg},
  {somaIdx: 75, vrmBone: VRMHumanBoneName.RightToes, vrmParent: VRMHumanBoneName.RightFoot},
];

const _qTarget = new THREE.Quaternion();

/**
 * Exact SOMA 77-joint -> VRMHumanoid normalized bone retargeter.
 * Computes world-space delta orientations W_vrm(b) = W_soma(i) * W_soma_ref(i)^-1
 * and resolves local VRM normalized quaternions across arbitrary optional bones
 * (e.g. missing Shoulders, Neck, or Toes).
 */
export class SomaVrmRetargeter {
  private readonly somaRefWqInv: Array<[number, number, number, number]>;
  private readonly somaRefHipsY: number;
  private vrmRestHipsLocalY = 0;
  private vrmScale = 1;
  private boundVrm: VRM | null = null;

  constructor(private readonly sk: SomaSkeleton) {
    this.somaRefWqInv = sk.refFk.wq.map((q) => quatInv(q));
    this.somaRefHipsY = Math.max(0.2, sk.reference[0][1]);
  }

  bindVRM(vrm: VRM): void {
    this.boundVrm = vrm;
    const hips = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hips) {
      this.vrmRestHipsLocalY = hips.position.y;
      hips.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3();
      hips.getWorldPosition(wp);
      // Compare VRM rest pelvis height against SOMA reference hips height (1.012m)
      const rootWorld = new THREE.Vector3();
      vrm.scene.getWorldPosition(rootWorld);
      const vrmHipHeight = Math.max(0.45, Math.abs(wp.y - rootWorld.y) || 0.88);
      this.vrmScale = vrmHipHeight / this.somaRefHipsY;
    } else {
      this.vrmRestHipsLocalY = 0;
      this.vrmScale = 0.88;
    }
  }

  get retargetScale(): number {
    return this.vrmScale;
  }

  /**
   * Applies a SOMA 77-joint pose onto the bound VRM rig.
   * Extracts SOMA Hips world XZ/Y delta separately so `avatarAnchor` / Rapier
   * keeps authoritative room coordinates without double-translating.
   */
  applyPose(
    pose: SomaPose,
    options?: {
      blendAlpha?: number;
      skipHipsPositionXZ?: boolean;
      overrideYawOnly?: boolean;
    }
  ): {hipsDeltaY: number; rootWorldX: number; rootWorldZ: number} {
    const vrm = this.boundVrm;
    const fk = this.sk.fk(pose);
    const deltaY = (pose[0][1] - this.somaRefHipsY) * this.vrmScale;
    const rootWorldX = pose[0][0] * this.vrmScale;
    const rootWorldZ = pose[0][2] * this.vrmScale;

    if (!vrm) {
      return {hipsDeltaY: deltaY, rootWorldX, rootWorldZ};
    }

    const alpha = options?.blendAlpha ?? 1;
    const worldDeltaByBone = new Map<VRMHumanBoneName, [number, number, number, number]>();

    for (const entry of SOMA_VRM_MAP) {
      const node = vrm.humanoid.getNormalizedBoneNode(entry.vrmBone);
      const dw = quatMul(fk.wq[entry.somaIdx], this.somaRefWqInv[entry.somaIdx]);
      worldDeltaByBone.set(entry.vrmBone, dw);
      if (!node) continue;

      let parentWorld: [number, number, number, number] = [0, 0, 0, 1];
      let pBone = entry.vrmParent;
      while (pBone) {
        if (vrm.humanoid.getNormalizedBoneNode(pBone) && worldDeltaByBone.has(pBone)) {
          parentWorld = worldDeltaByBone.get(pBone)!;
          break;
        }
        const parentEntry = SOMA_VRM_MAP.find((m) => m.vrmBone === pBone);
        pBone = parentEntry ? parentEntry.vrmParent : null;
      }

      const localQ = quatMul(quatInv(parentWorld), dw);
      _qTarget.set(localQ[0], localQ[1], localQ[2], localQ[3]).normalize();
      if (alpha >= 0.999) {
        node.quaternion.copy(_qTarget);
      } else {
        node.quaternion.slerp(_qTarget, alpha);
      }

      if (entry.vrmBone === VRMHumanBoneName.Hips) {
        if (options?.skipHipsPositionXZ !== false) {
          node.position.x = 0;
          node.position.z = 0;
        } else {
          node.position.x = rootWorldX;
          node.position.z = rootWorldZ;
        }
        node.position.y = THREE.MathUtils.lerp(
          node.position.y,
          this.vrmRestHipsLocalY + deltaY,
          alpha
        );
      }
    }

    return {hipsDeltaY: deltaY, rootWorldX, rootWorldZ};
  }
}
