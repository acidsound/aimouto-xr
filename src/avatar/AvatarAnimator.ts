import * as THREE from 'three';
import {EMOTION_PRESETS} from '../constants';
import {AvatarEmotion, AvatarGesture, VisemeVowel} from '../types';
import {
  applyEmotionFace,
  applyMouthViseme,
  AvatarRigHandles,
} from './HumanoidRigBuilder';

const _targetColor = new THREE.Color();

interface SpringState {
  angle: number;
  velocity: number;
}

/**
 * Coordinates keyframed THREE.AnimationClip gestures (via THREE.AnimationMixer),
 * layered procedural idle breathing, head/eye gaze tracking, second-order spring
 * physics for twintails & ahoge, automatic blinking, emotion blending, and lip-sync.
 */
export class AvatarAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly gestureActions = new Map<AvatarGesture, THREE.AnimationAction>();
  private activeGesture: AvatarGesture = AvatarGesture.IDLE;

  private currentEmotion: AvatarEmotion = AvatarEmotion.HAPPY;
  private emotionValues = {
    eyeSquint: EMOTION_PRESETS[AvatarEmotion.HAPPY].eyeSquint,
    eyeWidening: EMOTION_PRESETS[AvatarEmotion.HAPPY].eyeWidening,
    browTilt: EMOTION_PRESETS[AvatarEmotion.HAPPY].browTilt,
    browRaise: EMOTION_PRESETS[AvatarEmotion.HAPPY].browRaise,
    mouthSmile: EMOTION_PRESETS[AvatarEmotion.HAPPY].mouthSmile,
    blushIntensity: EMOTION_PRESETS[AvatarEmotion.HAPPY].blushIntensity,
    headTiltZ: EMOTION_PRESETS[AvatarEmotion.HAPPY].headTiltZ,
  };

  private elapsed = 0;
  private blinkTimer = 2.6;
  private blinkPhase = 0;

  private gazeTarget = new THREE.Vector2(0, 0);
  private gazeCurrent = new THREE.Vector2(0, 0);

  private twinSpringL: SpringState = {angle: 0, velocity: 0};
  private twinSpringR: SpringState = {angle: 0, velocity: 0};
  private ahogeSpring: SpringState = {angle: 0, velocity: 0};
  private prevHeadZ = 0;
  private prevRootY = 0;

  constructor(private readonly rig: AvatarRigHandles) {
    this.mixer = new THREE.AnimationMixer(rig.rootGroup);
    this.buildGestureClips();
    this.mixer.addEventListener('finished', () => {
      this.playGesture(AvatarGesture.IDLE);
    });
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
    if (gesture === this.activeGesture && gesture !== AvatarGesture.IDLE) {
      const existing = this.gestureActions.get(gesture);
      existing?.reset().play();
      return;
    }

    const prevAction = this.gestureActions.get(this.activeGesture);
    const nextAction = this.gestureActions.get(gesture);

    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(0.22);
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
      nextAction.fadeIn(0.18).play();
    }
  }

  private buildGestureClips(): void {
    const q = (rx: number, ry: number, rz: number) => {
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rx, ry, rz, 'XYZ')
      );
      return [quat.x, quat.y, quat.z, quat.w];
    };

    // 1. WAVE gesture
    this.gestureActions.set(
      AvatarGesture.WAVE,
      this.mixer.clipAction(
        new THREE.AnimationClip('wave', 1.8, [
          new THREE.QuaternionKeyframeTrack(
            'upperArmR.quaternion',
            [0, 0.35, 0.7, 1.05, 1.4, 1.8],
            [
              ...q(0, 0, 0.2),
              ...q(-0.25, 0, 2.35),
              ...q(-0.25, 0, 2.05),
              ...q(-0.25, 0, 2.45),
              ...q(-0.25, 0, 2.05),
              ...q(0, 0, 0.2),
            ]
          ),
          new THREE.QuaternionKeyframeTrack(
            'forearmR.quaternion',
            [0, 0.35, 0.7, 1.05, 1.4, 1.8],
            [
              ...q(0, 0, 0),
              ...q(0, 0, 0.35),
              ...q(0, 0, -0.2),
              ...q(0, 0, 0.35),
              ...q(0, 0, -0.2),
              ...q(0, 0, 0),
            ]
          ),
        ])
      )
    );

    // 2. NOD gesture
    this.gestureActions.set(
      AvatarGesture.NOD,
      this.mixer.clipAction(
        new THREE.AnimationClip('nod', 1.1, [
          new THREE.QuaternionKeyframeTrack(
            'head.quaternion',
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

    // 3. SHAKE_HEAD gesture
    this.gestureActions.set(
      AvatarGesture.SHAKE_HEAD,
      this.mixer.clipAction(
        new THREE.AnimationClip('shake_head', 1.2, [
          new THREE.QuaternionKeyframeTrack(
            'head.quaternion',
            [0, 0.24, 0.55, 0.85, 1.2],
            [
              ...q(0, 0, 0),
              ...q(0, -0.38, 0),
              ...q(0, 0.38, 0),
              ...q(0, -0.25, 0),
              ...q(0, 0, 0),
            ]
          ),
        ])
      )
    );

    // 4. SPIN_JOY gesture
    this.gestureActions.set(
      AvatarGesture.SPIN_JOY,
      this.mixer.clipAction(
        new THREE.AnimationClip('spin_joy', 1.35, [
          new THREE.QuaternionKeyframeTrack(
            'hips.quaternion',
            [0, 0.34, 0.68, 1.02, 1.35],
            [
              ...q(0, 0, 0),
              ...q(0, Math.PI * 0.5, 0),
              ...q(0, Math.PI, 0),
              ...q(0, Math.PI * 1.5, 0),
              ...q(0, Math.PI * 2, 0),
            ]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmL.quaternion',
            [0, 0.4, 1.0, 1.35],
            [...q(0, 0, -0.2), ...q(0, 0, -1.1), ...q(0, 0, -1.0), ...q(0, 0, -0.2)]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmR.quaternion',
            [0, 0.4, 1.0, 1.35],
            [...q(0, 0, 0.2), ...q(0, 0, 1.1), ...q(0, 0, 1.0), ...q(0, 0, 0.2)]
          ),
        ])
      )
    );

    // 5. THINK_POSE gesture
    this.gestureActions.set(
      AvatarGesture.THINK_POSE,
      this.mixer.clipAction(
        new THREE.AnimationClip('think_pose', 2.0, [
          new THREE.QuaternionKeyframeTrack(
            'upperArmR.quaternion',
            [0, 0.45, 1.55, 2.0],
            [...q(0, 0, 0.2), ...q(-0.75, -0.2, 0.3), ...q(-0.75, -0.2, 0.3), ...q(0, 0, 0.2)]
          ),
          new THREE.QuaternionKeyframeTrack(
            'forearmR.quaternion',
            [0, 0.45, 1.55, 2.0],
            [...q(0, 0, 0), ...q(-1.65, 0, -0.45), ...q(-1.65, 0, -0.45), ...q(0, 0, 0)]
          ),
        ])
      )
    );

    // 6. JUMP_CHEER gesture
    this.gestureActions.set(
      AvatarGesture.JUMP_CHEER,
      this.mixer.clipAction(
        new THREE.AnimationClip('jump_cheer', 1.25, [
          new THREE.VectorKeyframeTrack(
            'root.position',
            [0, 0.25, 0.55, 0.85, 1.25],
            [0, 0, 0, 0, 0.16, 0, 0, 0.02, 0, 0, 0.11, 0, 0, 0, 0]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmL.quaternion',
            [0, 0.3, 0.9, 1.25],
            [...q(0, 0, -0.2), ...q(-0.3, 0, -2.5), ...q(-0.3, 0, -2.3), ...q(0, 0, -0.2)]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmR.quaternion',
            [0, 0.3, 0.9, 1.25],
            [...q(0, 0, 0.2), ...q(-0.3, 0, 2.5), ...q(-0.3, 0, 2.3), ...q(0, 0, 0.2)]
          ),
        ])
      )
    );

    // 7. SHY_FIDGET gesture
    this.gestureActions.set(
      AvatarGesture.SHY_FIDGET,
      this.mixer.clipAction(
        new THREE.AnimationClip('shy_fidget', 1.7, [
          new THREE.QuaternionKeyframeTrack(
            'hips.quaternion',
            [0, 0.4, 0.9, 1.35, 1.7],
            [
              ...q(0, 0, 0),
              ...q(0, -0.25, 0.05),
              ...q(0, 0.22, -0.05),
              ...q(0, -0.15, 0.03),
              ...q(0, 0, 0),
            ]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmL.quaternion',
            [0, 0.4, 1.3, 1.7],
            [...q(0, 0, -0.2), ...q(-0.45, 0.2, 0.15), ...q(-0.45, 0.2, 0.15), ...q(0, 0, -0.2)]
          ),
          new THREE.QuaternionKeyframeTrack(
            'upperArmR.quaternion',
            [0, 0.4, 1.3, 1.7],
            [...q(0, 0, 0.2), ...q(-0.45, -0.2, -0.15), ...q(-0.45, -0.2, -0.15), ...q(0, 0, 0.2)]
          ),
        ])
      )
    );
  }

  private stepSpring(spring: SpringState, target: number, dt: number, k = 95, d = 8.5): number {
    const accel = -k * (spring.angle - target) - d * spring.velocity;
    spring.velocity += accel * dt;
    spring.angle += spring.velocity * dt;
    return THREE.MathUtils.clamp(spring.angle, -0.65, 0.65);
  }

  update(
    rawDt: number,
    voiceState: {mouthOpen: number; viseme: VisemeVowel; speaking: boolean}
  ): void {
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;

    // 1. Advance AnimationMixer clips
    this.mixer.update(dt);

    // 2. Smoothly damp emotional facial weights
    const preset = EMOTION_PRESETS[this.currentEmotion];
    const alpha = 1 - Math.exp(-8.5 * dt);
    this.emotionValues.eyeSquint = THREE.MathUtils.lerp(this.emotionValues.eyeSquint, preset.eyeSquint, alpha);
    this.emotionValues.eyeWidening = THREE.MathUtils.lerp(this.emotionValues.eyeWidening, preset.eyeWidening, alpha);
    this.emotionValues.browTilt = THREE.MathUtils.lerp(this.emotionValues.browTilt, preset.browTilt, alpha);
    this.emotionValues.browRaise = THREE.MathUtils.lerp(this.emotionValues.browRaise, preset.browRaise, alpha);
    this.emotionValues.mouthSmile = THREE.MathUtils.lerp(this.emotionValues.mouthSmile, preset.mouthSmile, alpha);
    this.emotionValues.blushIntensity = THREE.MathUtils.lerp(this.emotionValues.blushIntensity, preset.blushIntensity, alpha);
    this.emotionValues.headTiltZ = THREE.MathUtils.lerp(this.emotionValues.headTiltZ, preset.headTiltZ, alpha);

    // Aura color transition
    _targetColor.setHex(preset.auraColor);
    this.rig.accentMaterials.auraHalo.emissive.lerp(_targetColor, alpha);
    this.rig.accentMaterials.auraHalo.color.lerp(_targetColor, alpha);

    // 3. Natural blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkPhase += dt * 11;
      if (this.blinkPhase >= Math.PI) {
        this.blinkPhase = 0;
        this.blinkTimer = 2.4 + Math.random() * 2.8;
      }
    }
    const blinkAmount = this.blinkPhase > 0 ? Math.sin(this.blinkPhase) : 0;

    // 4. Layered procedural idol sway, breathing & gaze tracking when in IDLE
    const {bones} = this.rig;
    const breath = Math.sin(this.elapsed * 2.1);
    const sway = Math.sin(this.elapsed * 1.15);

    bones.chest.rotation.x = breath * 0.025;
    bones.spine.rotation.z = sway * 0.025;

    if (this.activeGesture === AvatarGesture.IDLE) {
      bones.hips.rotation.y = sway * 0.055;
      bones.upperArmL.rotation.set(
        0.04 * Math.sin(this.elapsed * 1.6),
        0,
        -0.22 - breath * 0.025
      );
      bones.upperArmR.rotation.set(
        -0.04 * Math.sin(this.elapsed * 1.6),
        0,
        0.22 + breath * 0.025
      );
      bones.forearmL.rotation.set(-0.22, 0, -0.08);
      bones.forearmR.rotation.set(-0.22, 0, 0.08);
    }

    // Gaze look-at damping
    this.gazeCurrent.lerp(this.gazeTarget, 1 - Math.exp(-7 * dt));
    if (
      this.activeGesture !== AvatarGesture.NOD &&
      this.activeGesture !== AvatarGesture.SHAKE_HEAD
    ) {
      const talkBob = voiceState.speaking ? Math.sin(this.elapsed * 9) * 0.035 : 0;
      bones.head.rotation.x = -this.gazeCurrent.y * 0.14 + talkBob;
      bones.head.rotation.y = this.gazeCurrent.x * 0.24;
      bones.head.rotation.z = this.emotionValues.headTiltZ + sway * 0.03;
    }

    // Iris subtle pupil tracking
    this.rig.face.irisL.position.x = this.gazeCurrent.x * 0.005;
    this.rig.face.irisL.position.y = -0.002 + this.gazeCurrent.y * 0.004;
    this.rig.face.irisR.position.x = this.gazeCurrent.x * 0.005;
    this.rig.face.irisR.position.y = -0.002 + this.gazeCurrent.y * 0.004;

    // 5. Twintail & Ahoge second-order spring physics
    const headVelZ = (bones.head.rotation.z - this.prevHeadZ) / Math.max(dt, 0.001);
    const rootVelY = (bones.root.position.y - this.prevRootY) / Math.max(dt, 0.001);
    this.prevHeadZ = bones.head.rotation.z;
    this.prevRootY = bones.root.position.y;

    const flareTarget = 0.08 + Math.abs(rootVelY) * 0.25 + sway * 0.04;
    const twinAngleL = this.stepSpring(this.twinSpringL, -flareTarget - headVelZ * 0.08, dt);
    const twinAngleR = this.stepSpring(this.twinSpringR, flareTarget - headVelZ * 0.08, dt);
    const ahogeAngle = this.stepSpring(
      this.ahogeSpring,
      Math.sin(this.elapsed * 3.4) * 0.12 - rootVelY * 0.4,
      dt,
      140,
      7
    );

    bones.twinBaseL.rotation.z = twinAngleL;
    bones.twinMidL.rotation.z = twinAngleL * 0.55;
    bones.twinBaseR.rotation.z = twinAngleR;
    bones.twinMidR.rotation.z = twinAngleR * 0.55;
    bones.ahoge.rotation.z = ahogeAngle;

    // 6. Facial expressions + Lip-Sync visemes
    applyEmotionFace(
      this.rig.face,
      this.currentEmotion,
      blinkAmount,
      this.emotionValues
    );
    applyMouthViseme(
      this.rig.face,
      voiceState.viseme,
      voiceState.mouthOpen,
      this.emotionValues.mouthSmile
    );
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
