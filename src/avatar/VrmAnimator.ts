import * as THREE from 'three';
import {VRM, VRMExpressionPresetName, VRMHumanBoneName} from '@pixiv/three-vrm';
import {EMOTION_PRESETS} from '../constants';
import {AvatarEmotion, AvatarGesture, VisemeVowel} from '../types';

const _lookTargetPos = new THREE.Vector3();
const _headWorldPos = new THREE.Vector3();

/**
 * Drives any loaded VRM 0.x / 1.0 avatar using VRMHumanoid normalized bones,
 * VRMExpressionManager (emotions, auto-blink, lip-sync visemes), VRMLookAt
 * gaze tracking, keyframed AnimationMixer gestures, and VRMSpringBoneManager.
 */
export class VrmAnimator {
  private mixer: THREE.AnimationMixer | null = null;
  private gestureActions = new Map<AvatarGesture, THREE.AnimationAction>();
  private activeGesture: AvatarGesture = AvatarGesture.IDLE;
  private currentEmotion: AvatarEmotion = AvatarEmotion.NEUTRAL;

  private vrm: VRM | null = null;
  private lookAtProxy = new THREE.Object3D();

  private elapsed = 0;
  private blinkTimer = 2.4;
  private blinkPhase = 0;
  private gazeTarget = new THREE.Vector2(0, 0);
  private gazeCurrent = new THREE.Vector2(0, 0);
  private smoothedHeadTiltZ = 0;
  private physicsDrivenJump = false;
  private onFinishedHandler = () => {
    this.playGesture(AvatarGesture.IDLE);
  };

  setPhysicsDrivenJump(enabled: boolean): void {
    if (this.physicsDrivenJump === enabled) return;
    this.physicsDrivenJump = enabled;
    if (this.vrm && this.mixer) {
      const prevGesture = this.activeGesture;
      this.buildGestureClips(this.vrm);
      if (prevGesture !== AvatarGesture.IDLE) {
        this.playGesture(prevGesture);
      }
    }
  }

  setVRM(vrm: VRM): void {
    this.disposeMixer();
    this.vrm = vrm;
    this.elapsed = 0;
    this.activeGesture = AvatarGesture.IDLE;

    // Bind VRMLookAt target proxy in world space
    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookAtProxy;
    }

    // Bind AnimationMixer targeting VRMHumanoid normalized bone nodes
    if (!vrm.humanoid.normalizedHumanBonesRoot.name) {
      vrm.humanoid.normalizedHumanBonesRoot.name = 'NormalizedHumanBonesRoot';
    }
    this.mixer = new THREE.AnimationMixer(vrm.humanoid.normalizedHumanBonesRoot);
    this.mixer.addEventListener('finished', this.onFinishedHandler);
    this.buildGestureClips(vrm);

    // Apply initial relaxed pose immediately so frame 0 isn't stuck in T-pose
    this.applyRelaxedPose(vrm, 0);
    vrm.update(0);
  }

  get emotion(): AvatarEmotion {
    return this.currentEmotion;
  }

  get gesture(): AvatarGesture {
    return this.activeGesture;
  }

  setEmotion(emotion: AvatarEmotion): void {
    this.currentEmotion = emotion;
  }

  setGazeNDC(nx: number, ny: number): void {
    this.gazeTarget.set(
      THREE.MathUtils.clamp(nx, -1, 1),
      THREE.MathUtils.clamp(ny, -1, 1)
    );
  }

  playGesture(gesture: AvatarGesture): void {
    if (!this.mixer) {
      this.activeGesture = gesture;
      return;
    }
    if (gesture === this.activeGesture && gesture !== AvatarGesture.IDLE) {
      this.gestureActions.get(gesture)?.reset().play();
      return;
    }

    const prevAction = this.gestureActions.get(this.activeGesture);
    const nextAction = this.gestureActions.get(gesture);
    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(0.2);
    }

    this.activeGesture = gesture;
    if (nextAction) {
      nextAction.reset();
      if (gesture === AvatarGesture.IDLE) {
        nextAction.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = false;
      }
      nextAction.fadeIn(0.16).play();
    }
  }

  private buildGestureClips(vrm: VRM): void {
    if (!this.mixer) return;
    this.gestureActions.clear();

    const boneName = (b: VRMHumanBoneName): string | null =>
      vrm.humanoid.getNormalizedBoneNode(b)?.name ?? null;

    const q = (rx: number, ry: number, rz: number) => {
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rx, ry, rz, 'XYZ')
      );
      return [quat.x, quat.y, quat.z, quat.w];
    };

    const hipsName = boneName(VRMHumanBoneName.Hips);
    const headName = boneName(VRMHumanBoneName.Head);
    const upperArmL = boneName(VRMHumanBoneName.LeftUpperArm);
    const upperArmR = boneName(VRMHumanBoneName.RightUpperArm);
    const lowerArmR = boneName(VRMHumanBoneName.RightLowerArm);
    const rootName = vrm.humanoid.normalizedHumanBonesRoot.name;

    // 1. WAVE (Right arm is on -X in VRM T-pose: negative rz lifts arm overhead!)
    if (upperArmR && lowerArmR) {
      this.gestureActions.set(
        AvatarGesture.WAVE,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_wave', 1.85, [
            new THREE.QuaternionKeyframeTrack(
              `${upperArmR}.quaternion`,
              [0, 0.28, 0.65, 1.02, 1.4, 1.85],
              [
                ...q(0.05, 0, 1.18),
                ...q(-0.28, 0.08, -1.05),
                ...q(-0.28, 0.08, -0.82),
                ...q(-0.28, 0.08, -1.08),
                ...q(-0.28, 0.08, -0.82),
                ...q(0.05, 0, 1.18),
              ]
            ),
            new THREE.QuaternionKeyframeTrack(
              `${lowerArmR}.quaternion`,
              [0, 0.28, 0.65, 1.02, 1.4, 1.85],
              [
                ...q(0.05, -0.16, 0.14),
                ...q(0.1, 0.2, -1.15),
                ...q(0.1, 0.2, -0.65),
                ...q(0.1, 0.2, -1.15),
                ...q(0.1, 0.2, -0.65),
                ...q(0.05, -0.16, 0.14),
              ]
            ),
          ])
        )
      );
    }

    // 2. NOD
    if (headName) {
      this.gestureActions.set(
        AvatarGesture.NOD,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_nod', 1.1, [
            new THREE.QuaternionKeyframeTrack(
              `${headName}.quaternion`,
              [0, 0.25, 0.5, 0.75, 1.1],
              [
                ...q(0, 0, 0),
                ...q(0.26, 0, 0),
                ...q(-0.04, 0, 0),
                ...q(0.22, 0, 0),
                ...q(0, 0, 0),
              ]
            ),
          ])
        )
      );

      // 3. SHAKE_HEAD
      this.gestureActions.set(
        AvatarGesture.SHAKE_HEAD,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_shake_head', 1.2, [
            new THREE.QuaternionKeyframeTrack(
              `${headName}.quaternion`,
              [0, 0.24, 0.55, 0.85, 1.2],
              [
                ...q(0, 0, 0),
                ...q(0, -0.36, 0),
                ...q(0, 0.36, 0),
                ...q(0, -0.22, 0),
                ...q(0, 0, 0),
              ]
            ),
          ])
        )
      );
    }

    // 4. SPIN_JOY
    if (hipsName) {
      const tracks: THREE.KeyframeTrack[] = [
        new THREE.QuaternionKeyframeTrack(
          `${hipsName}.quaternion`,
          [0, 0.34, 0.68, 1.02, 1.35],
          [
            ...q(0, 0, 0),
            ...q(0, Math.PI * 0.5, 0),
            ...q(0, Math.PI, 0),
            ...q(0, Math.PI * 1.5, 0),
            ...q(0, Math.PI * 2, 0),
          ]
        ),
      ];
      if (upperArmL) {
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${upperArmL}.quaternion`,
            [0, 0.4, 1.0, 1.35],
            [...q(0, 0, -1.18), ...q(0, 0, -0.3), ...q(0, 0, -0.35), ...q(0, 0, -1.18)]
          )
        );
      }
      if (upperArmR) {
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${upperArmR}.quaternion`,
            [0, 0.4, 1.0, 1.35],
            [...q(0, 0, 1.18), ...q(0, 0, 0.3), ...q(0, 0, 0.35), ...q(0, 0, 1.18)]
          )
        );
      }
      this.gestureActions.set(
        AvatarGesture.SPIN_JOY,
        this.mixer.clipAction(new THREE.AnimationClip('vrm_spin_joy', 1.35, tracks))
      );
    }

    // 5. THINK_POSE
    if (upperArmR && lowerArmR) {
      this.gestureActions.set(
        AvatarGesture.THINK_POSE,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_think_pose', 2.0, [
            new THREE.QuaternionKeyframeTrack(
              `${upperArmR}.quaternion`,
              [0, 0.45, 1.55, 2.0],
              [...q(0, 0, 1.18), ...q(0.45, 0.25, 0.72), ...q(0.45, 0.25, 0.72), ...q(0, 0, 1.18)]
            ),
            new THREE.QuaternionKeyframeTrack(
              `${lowerArmR}.quaternion`,
              [0, 0.45, 1.55, 2.0],
              [...q(0, 0, 0.15), ...q(0, 1.55, 0.65), ...q(0, 1.55, 0.65), ...q(0, 0, 0.15)]
            ),
          ])
        )
      );
    }

    // 6. JUMP_CHEER
    if (rootName && upperArmL && upperArmR) {
      const jumpTracks: THREE.KeyframeTrack[] = [];
      if (!this.physicsDrivenJump) {
        jumpTracks.push(
          new THREE.VectorKeyframeTrack(
            `${rootName}.position`,
            [0, 0.25, 0.55, 0.85, 1.25],
            [0, 0, 0, 0, 0.14, 0, 0, 0.02, 0, 0, 0.09, 0, 0, 0, 0]
          )
        );
      }
      jumpTracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${upperArmL}.quaternion`,
          [0, 0.3, 0.9, 1.25],
          [...q(0, 0, -1.18), ...q(0.15, 0, 0.65), ...q(0.15, 0, 0.55), ...q(0, 0, -1.18)]
        ),
        new THREE.QuaternionKeyframeTrack(
          `${upperArmR}.quaternion`,
          [0, 0.3, 0.9, 1.25],
          [...q(0, 0, 1.18), ...q(0.15, 0, -0.65), ...q(0.15, 0, -0.55), ...q(0, 0, 1.18)]
        )
      );
      this.gestureActions.set(
        AvatarGesture.JUMP_CHEER,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_jump_cheer', 1.25, jumpTracks)
        )
      );
    }

    // 7. SHY_FIDGET
    if (hipsName && upperArmL && upperArmR) {
      this.gestureActions.set(
        AvatarGesture.SHY_FIDGET,
        this.mixer.clipAction(
          new THREE.AnimationClip('vrm_shy_fidget', 1.7, [
            new THREE.QuaternionKeyframeTrack(
              `${hipsName}.quaternion`,
              [0, 0.4, 0.9, 1.35, 1.7],
              [
                ...q(0, 0, 0),
                ...q(0, -0.22, 0.04),
                ...q(0, 0.2, -0.04),
                ...q(0, -0.12, 0.02),
                ...q(0, 0, 0),
              ]
            ),
            new THREE.QuaternionKeyframeTrack(
              `${upperArmL}.quaternion`,
              [0, 0.4, 1.3, 1.7],
              [...q(0, 0, -1.18), ...q(0.32, 0.25, -1.1), ...q(0.32, 0.25, -1.1), ...q(0, 0, -1.18)]
            ),
            new THREE.QuaternionKeyframeTrack(
              `${upperArmR}.quaternion`,
              [0, 0.4, 1.3, 1.7],
              [...q(0, 0, 1.18), ...q(0.32, -0.25, 1.1), ...q(0.32, -0.25, 1.1), ...q(0, 0, 1.18)]
            ),
          ])
        )
      );
    }
  }

  private applyRelaxedPose(
    vrm: VRM,
    dt: number,
    bodyPoseOverridden = false,
    worldGazeTarget?: THREE.Vector3 | null
  ): void {
    const breath = Math.sin(this.elapsed * 2.1);
    const sway = Math.sin(this.elapsed * 1.15);

    const spine = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    const chest = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
    const hips = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
    const upperArmL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const upperArmR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    const lowerArmL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
    const lowerArmR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);

    if (!bodyPoseOverridden) {
      if (spine) spine.rotation.z = sway * 0.024;
      if (chest) chest.rotation.x = breath * 0.026;

      // Lower arms from canonical VRM T-pose down into a relaxed idol A-pose
      // whenever a given arm isn't explicitly animated by the current gesture
      const leftArmFree =
        this.activeGesture !== AvatarGesture.SPIN_JOY &&
        this.activeGesture !== AvatarGesture.JUMP_CHEER &&
        this.activeGesture !== AvatarGesture.SHY_FIDGET;
      const rightArmFree =
        this.activeGesture === AvatarGesture.IDLE ||
        this.activeGesture === AvatarGesture.NOD ||
        this.activeGesture === AvatarGesture.SHAKE_HEAD;

      if (this.activeGesture === AvatarGesture.IDLE && hips) {
        hips.rotation.y = sway * 0.055;
      }
      if (leftArmFree) {
        if (upperArmL) {
          upperArmL.rotation.set(
            0.04 * Math.sin(this.elapsed * 1.6),
            0.04,
            -1.18 - breath * 0.025
          );
        }
        if (lowerArmL) lowerArmL.rotation.set(0.05, 0.16, -0.14);
      }
      if (rightArmFree) {
        if (upperArmR) {
          upperArmR.rotation.set(
            -0.04 * Math.sin(this.elapsed * 1.6),
            -0.04,
            1.18 + breath * 0.025
          );
        }
        if (lowerArmR) lowerArmR.rotation.set(0.05, -0.16, 0.14);
      }
    }

    // Gaze damping on head + VRMLookAt
    this.gazeCurrent.lerp(this.gazeTarget, 1 - Math.exp(-7 * Math.max(dt, 0.016)));
    const preset = EMOTION_PRESETS[this.currentEmotion];
    this.smoothedHeadTiltZ = THREE.MathUtils.lerp(
      this.smoothedHeadTiltZ,
      preset.headTiltZ,
      1 - Math.exp(-8 * Math.max(dt, 0.016))
    );

    if (
      head &&
      this.activeGesture !== AvatarGesture.NOD &&
      this.activeGesture !== AvatarGesture.SHAKE_HEAD
    ) {
      head.rotation.x = -this.gazeCurrent.y * 0.12;
      head.rotation.y = this.gazeCurrent.x * 0.22;
      head.rotation.z = this.smoothedHeadTiltZ + sway * 0.025;
    }

    if (head && vrm.lookAt) {
      if (worldGazeTarget) {
        this.lookAtProxy.position.lerp(worldGazeTarget, 1 - Math.exp(-8 * Math.max(dt, 0.016)));
      } else {
        head.getWorldPosition(_headWorldPos);
        _lookTargetPos.set(
          _headWorldPos.x + this.gazeCurrent.x * 1.1,
          _headWorldPos.y + this.gazeCurrent.y * 0.65,
          _headWorldPos.z + 2.2
        );
        this.lookAtProxy.position.copy(_lookTargetPos);
      }
    }
  }

  private applyExpressions(
    vrm: VRM,
    dt: number,
    voiceState: {mouthOpen: number; viseme: VisemeVowel; speaking: boolean}
  ): void {
    const em = vrm.expressionManager;
    if (!em) return;

    // Blink cycle
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkPhase += dt * 11;
      if (this.blinkPhase >= Math.PI) {
        this.blinkPhase = 0;
        this.blinkTimer = 2.4 + Math.random() * 2.8;
      }
    }
    const blinkWeight = this.blinkPhase > 0 ? Math.sin(this.blinkPhase) : 0;
    em.setValue(VRMExpressionPresetName.Blink, blinkWeight);

    // Emotion mapping onto VRM 1.0 preset names
    const weights: Record<string, number> = {
      [VRMExpressionPresetName.Neutral]: 0,
      [VRMExpressionPresetName.Happy]: 0,
      [VRMExpressionPresetName.Angry]: 0,
      [VRMExpressionPresetName.Sad]: 0,
      [VRMExpressionPresetName.Relaxed]: 0,
      [VRMExpressionPresetName.Surprised]: 0,
    };

    switch (this.currentEmotion) {
      case AvatarEmotion.HAPPY:
        weights[VRMExpressionPresetName.Happy] = 0.85;
        break;
      case AvatarEmotion.LOVE:
        weights[VRMExpressionPresetName.Happy] = 1.0;
        break;
      case AvatarEmotion.TSUNDERE:
        weights[VRMExpressionPresetName.Angry] = 0.72;
        break;
      case AvatarEmotion.SASSY:
        weights[VRMExpressionPresetName.Angry] = 0.25;
        weights[VRMExpressionPresetName.Happy] = 0.45;
        break;
      case AvatarEmotion.CURIOUS:
        weights[VRMExpressionPresetName.Surprised] = 0.35;
        break;
      case AvatarEmotion.SURPRISED:
        weights[VRMExpressionPresetName.Surprised] = 0.95;
        break;
      case AvatarEmotion.SLEEPY:
        weights[VRMExpressionPresetName.Relaxed] = 0.85;
        break;
      case AvatarEmotion.THINKING:
        weights[VRMExpressionPresetName.Sad] = 0.25;
        weights[VRMExpressionPresetName.Relaxed] = 0.35;
        break;
      case AvatarEmotion.NEUTRAL:
      default:
        weights[VRMExpressionPresetName.Neutral] = 1.0;
        break;
    }

    for (const [key, val] of Object.entries(weights)) {
      em.setValue(key, val);
    }

    // Lip-sync visemes (aa / ih / ou / ee / oh)
    const visemePresets: VRMExpressionPresetName[] = [
      VRMExpressionPresetName.Aa,
      VRMExpressionPresetName.Ih,
      VRMExpressionPresetName.Ou,
      VRMExpressionPresetName.Ee,
      VRMExpressionPresetName.Oh,
    ];
    for (const vp of visemePresets) {
      em.setValue(vp, 0);
    }
    const open = voiceState.speaking
      ? Math.max(0.15, THREE.MathUtils.clamp(voiceState.mouthOpen, 0, 1))
      : THREE.MathUtils.clamp(voiceState.mouthOpen, 0, 1);

    if (open > 0.03) {
      const map: Record<VisemeVowel, VRMExpressionPresetName> = {
        sil: VRMExpressionPresetName.Aa,
        A: VRMExpressionPresetName.Aa,
        I: VRMExpressionPresetName.Ih,
        U: VRMExpressionPresetName.Ou,
        E: VRMExpressionPresetName.Ee,
        O: VRMExpressionPresetName.Oh,
      };
      const targetViseme = map[voiceState.viseme] ?? VRMExpressionPresetName.Aa;
      em.setValue(targetViseme, open);
    }
  }

  update(
    rawDt: number,
    voiceState: {mouthOpen: number; viseme: VisemeVowel; speaking: boolean},
    motionOpts?: {
      bodyPoseOverridden?: boolean;
      worldGazeTarget?: THREE.Vector3 | null;
    }
  ): void {
    if (!this.vrm) return;
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;

    const overridden = Boolean(motionOpts?.bodyPoseOverridden);
    if (!overridden) {
      this.mixer?.update(dt);
    }
    this.applyRelaxedPose(
      this.vrm,
      dt,
      overridden,
      motionOpts?.worldGazeTarget ?? null
    );
    this.applyExpressions(this.vrm, dt, voiceState);
    this.vrm.update(dt);
  }

  private disposeMixer(): void {
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onFinishedHandler);
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.gestureActions.clear();
  }

  dispose(): void {
    this.disposeMixer();
    this.vrm = null;
  }
}
