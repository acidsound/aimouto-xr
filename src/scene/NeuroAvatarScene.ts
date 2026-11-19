import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';
import {MotionBricksEngine} from '../avatar/MotionBricksEngine';
import {DynamicPropId, MotionBricksPhysics} from '../avatar/MotionBricksPhysics';
import {VrmAnimator} from '../avatar/VrmAnimator';
import {LoadedVrmInfo, VrmAvatarManager} from '../avatar/VrmAvatarManager';
import {EMOTION_PRESETS, MOTION_BRICK_LABELS} from '../constants';
import {
  AvatarEmotion,
  AvatarGesture,
  MotionBrickPose,
  MotionBrickSnapshot,
  RoomPropId,
  StageThemeId,
  VisemeVowel,
} from '../types';
import {
  ANIME_UI_BLUEPRINT,
  blueprintToSpatialCardConfigs,
  blueprintToXBThemeUpdate,
} from '../ui/animeUiBlueprint';
import {
  InteractiveRoomProp,
  LofiRoomEnvironment,
} from './LofiRoomEnvironment';
import {
  ImmersiveVRController,
  VRSessionStatus,
} from './vrSessionController';

export interface SceneHoverHint {
  text: string;
  screenX: number;
  screenY: number;
  isHandHold?: boolean;
}

export interface SceneHooks {
  onAvatarPoke?: () => void;
  onPropInteracted?: (
    propId: RoomPropId,
    pose: MotionBrickPose,
    reactionText: string
  ) => void;
  onHandHoldChanged?: (active: boolean) => void;
  onMotionStateChanged?: (snapshot: MotionBrickSnapshot) => void;
  onHoverHintChanged?: (hint: SceneHoverHint | null) => void;
  onSpatialChatSubmit?: (text: string) => void;
  onSpatialQuickAction?: (actionId: string) => void;
  onXRModeChanged?: (inXR: boolean) => void;
  onVrmLoaded?: (info: LoadedVrmInfo) => void;
  onVrmError?: (error: string) => void;
  onVRStatusChanged?: (status: VRSessionStatus) => void;
}

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _handPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.92);
const _planeHit = new THREE.Vector3();
const _gazeTargetWorld = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _handWorld = new THREE.Vector3();
const _xrOrigin = new THREE.Vector3();
const _xrDir = new THREE.Vector3();
const _xrRotMat = new THREE.Matrix4();
const _xrCtrlWorld = new THREE.Vector3();

const PROP_REACTIONS: Record<
  RoomPropId,
  {emotion: AvatarEmotion; line: string}
> = {
  floor: {
    emotion: AvatarEmotion.HAPPY,
    line: '총총총~ 여기로 걸어왔어!',
  },
  desk_lamp: {
    emotion: AvatarEmotion.CURIOUS,
    line: '딸깍! 책상 스탠드 조명을 조절했어.',
  },
  desk_chair: {
    emotion: AvatarEmotion.HAPPY,
    line: '책상 앞에 앉으니까 비 오는 밤 감성이 확 올라오네~',
  },
  laptop: {
    emotion: AvatarEmotion.THINKING,
    line: '타닥타닥... 노트북 화면 바꾸고 작업 모드 시작!',
  },
  coffee_mug: {
    emotion: AvatarEmotion.HAPPY,
    line: '후우~ 따뜻한 커피 한 모금 마시니까 잠이 싹 달아난다!',
  },
  window: {
    emotion: AvatarEmotion.CURIOUS,
    line: '창밖 밤하늘이랑 빗방울이 너무 운치 있지 않아?',
  },
  bed: {
    emotion: AvatarEmotion.SLEEPY,
    line: '푹신한 침대 걸터앉기~ 여기서 같이 쉴래?',
  },
  cat_plushie: {
    emotion: AvatarEmotion.LOVE,
    line: '쓰담쓰담~ 우리 방 고양이 인형 너무 귀엽지?',
  },
  bookshelf: {
    emotion: AvatarEmotion.HAPPY,
    line: '바이닐 턴테이블 체크! 잔잔한 음악이 계속 돌고 있어~',
  },
  toy_ball: {
    emotion: AvatarEmotion.HAPPY,
    line: '통통! 별빛 공이 방 안을 데굴데굴 굴러가네!',
  },
  floor_cushion: {
    emotion: AvatarEmotion.HAPPY,
    line: '폭신한 방석을 툭 밀었어~ 여기 앉아서 쉴까?',
  },
  plush_die: {
    emotion: AvatarEmotion.CURIOUS,
    line: '데구르르! 플러시 주사위가 굴러갔어~ 몇이 나왔을까?',
  },
} as Record<RoomPropId, {emotion: AvatarEmotion; line: string}>;

export class NeuroAvatarScene extends xb.Script {
  private readonly vrmManager = new VrmAvatarManager();
  private readonly animator = new VrmAnimator();
  private readonly motionBricks = new MotionBricksEngine();
  private readonly vrController = new ImmersiveVRController();
  private physicsSim: MotionBricksPhysics | null = null;
  private room!: LofiRoomEnvironment;
  private orbitControls: OrbitControls | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private avatarRoot = new THREE.Group();

  // Invisible generous raycast hitboxes for hand-holding & body poke
  private avatarHitGroup = new THREE.Group();
  private leftHandHitMesh!: THREE.Mesh;
  private rightHandHitMesh!: THREE.Mesh;
  private torsoHitMesh!: THREE.Mesh;

  // Visual hand-hold ring & tether line
  private handHoldRingMesh!: THREE.Mesh;
  private handTetherLine!: THREE.Line;
  private handTetherPositions = new Float32Array(6);

  private spatialCardsGroup = new THREE.Group();
  private spatialStatusText?: xb.UIText;
  private spatialDialogueText?: xb.UIText;
  private spatialInput?: xb.UITextInput;
  private spatialCardsVisible = false;
  private inXRSession = false;

  private pointerDownState: {
    active: boolean;
    x: number;
    y: number;
    hitAvatar: boolean;
    hitSide?: 'left' | 'right';
    hitProp: InteractiveRoomProp | null;
    hitPoint: THREE.Vector3 | null;
    dragStarted: boolean;
  } = {
    active: false,
    x: 0,
    y: 0,
    hitAvatar: false,
    hitProp: null,
    hitPoint: null,
    dragStarted: false,
  };
  private handHoldModePinned = false;
  private activeXrGrabController: THREE.Object3D | null = null;
  private lastHoverCheckMs = 0;
  private lastSnapshotKey = '';

  private elapsed = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private domElement: HTMLElement | null = null;
  private voiceState: {
    mouthOpen: number;
    viseme: VisemeVowel;
    speaking: boolean;
  } = {
    mouthOpen: 0,
    viseme: 'sil',
    speaking: false,
  };

  constructor(
    private readonly isSoftwareGl: boolean,
    private readonly hooks: SceneHooks = {}
  ) {
    super();
  }

  init(): void {
    const scene = xb.core.scene;
    const renderer = xb.core.renderer;

    if (renderer && 'toneMapping' in renderer) {
      const webglRenderer = renderer as THREE.WebGLRenderer;
      webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      webglRenderer.toneMappingExposure = 1.02;
      webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
      if (this.isSoftwareGl) {
        webglRenderer.setPixelRatio(1);
        webglRenderer.shadowMap.enabled = false;
        this.vrmManager.setRenderQuality({
          maxAnisotropy: 1,
          enableAlphaToCoverage: false,
        });
      } else {
        const targetPixelRatio = Math.min(
          Math.max(window.devicePixelRatio || 1, 1.5),
          2
        );
        webglRenderer.setPixelRatio(targetPixelRatio);
        webglRenderer.setSize(window.innerWidth, window.innerHeight);
        webglRenderer.shadowMap.enabled = true;
        webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.vrmManager.setRenderQuality({
          maxAnisotropy: webglRenderer.capabilities.getMaxAnisotropy(),
          enableAlphaToCoverage: true,
        });
        try {
          const pmrem = new THREE.PMREMGenerator(webglRenderer);
          this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
          scene.environment = this.envRT.texture;
          pmrem.dispose();
        } catch {
          // Ignore if renderer does not support PMREM
        }
      }
      this.vrController.initWebXRRig(webglRenderer, scene);

      // Attach desktop OrbitControls + unified room/avatar pointer listeners
      this.domElement = webglRenderer.domElement;
      if (xb.core.camera && this.domElement) {
        this.orbitControls = new OrbitControls(xb.core.camera, this.domElement);
        this.orbitControls.enableDamping = !this.isSoftwareGl;
        this.orbitControls.dampingFactor = 0.08;
        this.orbitControls.enablePan = false;
        this.orbitControls.minDistance = 0.85;
        this.orbitControls.maxDistance = 3.85;
        this.orbitControls.minPolarAngle = 0.1;
        this.orbitControls.maxPolarAngle = Math.PI * 0.49;
        this.orbitControls.minAzimuthAngle = -Math.PI * 0.85;
        this.orbitControls.maxAzimuthAngle = Math.PI * 0.85;
        this.orbitControls.target.set(-0.08, 0.92, -1.78);
        this.orbitControls.update();

        this.domElement.addEventListener('pointerdown', this.onCanvasPointerDown);
        window.addEventListener('pointermove', this.onWindowPointerMove);
        window.addEventListener('pointerup', this.onWindowPointerUp);
      }
    }

    // Build compact, high-density rainy-night bedroom environment
    this.room = new LofiRoomEnvironment(this.isSoftwareGl);
    this.room.applyTheme('midnight_neon', scene);
    this.add(this.room.group);
    this.motionBricks.setObstacles(this.room.obstacles);

    // Avatar root sits directly on the bedroom floor (y = 0) and moves via MotionBricks
    this.avatarRoot.name = 'AIMoutoAvatarAnchor';
    this.avatarRoot.position.copy(this.motionBricks.rootPosition);
    this.avatarRoot.add(this.vrmManager.containerGroup);
    this.buildAvatarHitboxesAndTether();
    this.add(this.avatarRoot);
    this.add(this.vrController.vrEnvironmentGroup);

    // Build WebXR Spatial UI Cards
    this.buildSpatialUICards();
    this.spatialCardsGroup.visible = false;
    this.add(this.spatialCardsGroup);

    // Load default VRM 1.0 model in NEUTRAL pose/expression via GLTFLoader + VRMLoaderPlugin
    this.animator.setEmotion(AvatarEmotion.NEUTRAL);
    this.animator.playGesture(AvatarGesture.IDLE);
    void this.resetDefaultVrm();
  }

  initPhysics(physics: xb.Physics): void {
    if (this.physicsSim) {
      this.motionBricks.attachPhysics(null);
      this.physicsSim.dispose();
    }
    this.physicsSim = new MotionBricksPhysics(
      physics.RAPIER,
      physics.blendedWorld,
      this.room.obstacles,
      this.motionBricks.rootPosition
    );
    this.motionBricks.attachPhysics(this.physicsSim);
    this.animator.setPhysicsDrivenJump(true);
  }

  physicsStep(): void {
    if (!this.physicsSim) return;
    const stepDt = xb.core.physics?.timestep || 1 / 60;
    this.motionBricks.stepPhysics(stepDt);
    const dynamicIds: DynamicPropId[] = ['toy_ball', 'floor_cushion', 'plush_die'];
    for (const id of dynamicIds) {
      const pose = this.physicsSim.getDynamicPropPose(id);
      if (pose) {
        this.room.syncDynamicPropPose(id, pose);
      }
    }
  }

  private buildAvatarHitboxesAndTether(): void {
    const hitMat = new THREE.MeshBasicMaterial({visible: false});
    this.leftHandHitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      hitMat
    );
    this.rightHandHitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      hitMat
    );
    this.torsoHitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 1.38, 10),
      hitMat
    );
    this.torsoHitMesh.position.set(0, 0.78, 0);
    this.avatarHitGroup.add(
      this.leftHandHitMesh,
      this.rightHandHitMesh,
      this.torsoHitMesh
    );
    this.add(this.avatarHitGroup);

    this.handHoldRingMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.012, 10, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff6ba8,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.handHoldRingMesh.visible = false;
    this.add(this.handHoldRingMesh);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.handTetherPositions, 3)
    );
    this.handTetherLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0x4be3ff,
        transparent: true,
        opacity: 0.85,
      })
    );
    this.handTetherLine.frustumCulled = false;
    this.handTetherLine.visible = false;
    this.add(this.handTetherLine);
  }

  private updateAvatarHitboxes(): void {
    this.motionBricks.getHandWorldPosition('left', _handWorld);
    this.leftHandHitMesh.position.copy(_handWorld);
    this.motionBricks.getHandWorldPosition('right', _handWorld);
    this.rightHandHitMesh.position.copy(_handWorld);
    this.torsoHitMesh.position.set(
      this.motionBricks.rootPosition.x,
      this.avatarRoot.position.y + 0.78,
      this.motionBricks.rootPosition.z
    );
  }

  private rebuildSkeletonHelper(rootObj: THREE.Object3D): void {
    const wasVisible = Boolean(this.skeletonHelper?.visible);
    if (this.skeletonHelper) {
      this.skeletonHelper.removeFromParent();
      this.skeletonHelper.dispose();
      this.skeletonHelper = null;
    }
    this.skeletonHelper = new THREE.SkeletonHelper(rootObj);
    this.skeletonHelper.visible = wasVisible;
    this.avatarRoot.add(this.skeletonHelper);
  }

  async resetDefaultVrm(): Promise<LoadedVrmInfo | null> {
    try {
      const {vrm, info} = await this.vrmManager.loadDefaultVrm();
      this.animator.setVRM(vrm);
      this.motionBricks.setVRM(vrm);
      this.animator.setEmotion(this.animator.emotion);
      this.animator.playGesture(AvatarGesture.IDLE);
      this.rebuildSkeletonHelper(vrm.scene);
      this.hooks.onVrmLoaded?.(info);
      this.syncSpatialStatus();
      return info;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hooks.onVrmError?.(msg);
      return null;
    }
  }

  async loadVrmFromUrl(url: string): Promise<LoadedVrmInfo> {
    const {vrm, info} = await this.vrmManager.loadFromUrl(url, {
      sourceLabel: url,
      isDefault: false,
    });
    this.animator.setVRM(vrm);
    this.motionBricks.setVRM(vrm);
    this.animator.playGesture(AvatarGesture.IDLE);
    this.rebuildSkeletonHelper(vrm.scene);
    this.hooks.onVrmLoaded?.(info);
    this.syncSpatialStatus();
    return info;
  }

  async loadVrmFromFile(file: File): Promise<LoadedVrmInfo> {
    const {vrm, info} = await this.vrmManager.loadFromFile(file);
    this.animator.setVRM(vrm);
    this.motionBricks.setVRM(vrm);
    this.animator.playGesture(AvatarGesture.IDLE);
    this.rebuildSkeletonHelper(vrm.scene);
    this.hooks.onVrmLoaded?.(info);
    this.syncSpatialStatus();
    return info;
  }

  get vrmInfo(): LoadedVrmInfo | null {
    return this.vrmManager.info;
  }

  /**
   * Public room interaction API (callable from mouse clicks, WebXR rays, HUD chips, and AI plugins).
   */
  interactWithProp(
    propId: RoomPropId,
    clickPoint?: THREE.Vector3,
    poseOverride?: MotionBrickPose
  ): {ok: boolean; message: string} {
    this.handHoldModePinned = false;
    this.hooks.onHandHoldChanged?.(false);

    if (propId === 'floor') {
      const tx = clickPoint?.x ?? -0.08;
      const tz = clickPoint?.z ?? -1.28;
      this.room.showFloorDestinationMarker(tx, tz);
      this.motionBricks.walkToFloor(tx, tz, 0);
      this.animator.setEmotion(AvatarEmotion.NEUTRAL);
      return {ok: true, message: `Walking to (${tx.toFixed(2)}, ${tz.toFixed(2)})`};
    }

    const prop = this.room.interactiveProps.get(propId);
    if (!prop) {
      return {ok: false, message: `Unknown room prop: ${propId}`};
    }

    if (this.physicsSim?.isDynamicProp(propId)) {
      const pos = this.physicsSim.getDynamicPropPosition(propId) ?? prop.reachTargetWorld;
      const actionName =
        propId === 'toy_ball'
          ? 'kick'
          : propId === 'plush_die'
            ? 'pickup'
            : 'push';
      const motionPose =
        propId === 'toy_ball'
          ? 'kick_ball'
          : propId === 'plush_die'
            ? 'pickup_die'
            : 'push_prop';
      const propWorldVec = new THREE.Vector3(pos.x, pos.y, pos.z);
      this.room.showFloorDestinationMarker(pos.x, pos.z);

      this.motionBricks.executePropAction({
        propId,
        pose: motionPose,
        actionName,
        propWorldPos: propWorldVec,
        lookAtWorld: propWorldVec,
        onContact: () => {
          const livePos =
            this.physicsSim?.getDynamicPropPosition(propId) ?? pos;
          let dx = livePos.x - this.motionBricks.rootPosition.x;
          let dz = livePos.z - this.motionBricks.rootPosition.z;
          const len = Math.hypot(dx, dz);
          if (len > 0.02) {
            dx /= len;
            dz /= len;
          } else {
            dx = 0.28;
            dz = -0.96;
          }

          const impulse =
            propId === 'toy_ball'
              ? {x: dx * 0.34, y: 0.48, z: dz * 0.34}
              : propId === 'plush_die'
                ? {x: dx * 0.24, y: 0.56, z: dz * 0.24}
                : {x: dx * 0.42, y: 0.16, z: dz * 0.42};
          const torque =
            propId === 'plush_die'
              ? {
                  x: (Math.random() - 0.5) * 0.16,
                  y: (Math.random() - 0.5) * 0.18,
                  z: (Math.random() - 0.5) * 0.16,
                }
              : undefined;

          this.physicsSim?.applyPropImpulse(propId, impulse, torque);
          const meta = PROP_REACTIONS[propId];
          this.animator.setEmotion(meta.emotion);
          this.hooks.onPropInteracted?.(propId, motionPose, meta.line);
          this.syncSpatialStatus();
        },
        onComplete: () => {
          this.syncSpatialStatus();
        },
      });
      return {
        ok: true,
        message: `Running MotionBricks ${actionName} on ${propId}`,
      };
    }

    let nextPose: MotionBrickPose = poseOverride ?? prop.targetPose;
    // Toggle between sitting upright and lounging on repeated Bed click!
    if (
      propId === 'bed' &&
      !poseOverride &&
      this.motionBricks.pose === 'sit_bed'
    ) {
      nextPose = 'lounge_bed';
    }

    this.room.showFloorDestinationMarker(prop.approachPos.x, prop.approachPos.z);
    this.motionBricks.enqueueCommand({
      propId,
      pose: nextPose,
      approachPos: prop.approachPos,
      approachYaw: prop.approachYaw,
      reachTargetWorld: prop.reachTargetWorld,
      lookAtWorld: prop.lookAtWorld,
      onArrive: () => {
        const propNote = this.room.triggerPropEffect(propId);
        const meta = PROP_REACTIONS[propId];
        const finalEmotion =
          nextPose === 'lounge_bed' ? AvatarEmotion.SLEEPY : meta.emotion;
        this.animator.setEmotion(finalEmotion);
        const text = propNote || meta.line;
        this.hooks.onPropInteracted?.(propId, nextPose, text);
        this.syncSpatialStatus();
      },
    });

    return {
      ok: true,
      message: `Moving to ${propId} (${nextPose})`,
    };
  }

  togglePinnedHandHoldMode(): boolean {
    this.handHoldModePinned = !this.handHoldModePinned;
    if (this.handHoldModePinned) {
      this.motionBricks.getHandWorldPosition('right', _handWorld);
      this.motionBricks.startHandHold(_handWorld, 'right');
      this.animator.setEmotion(AvatarEmotion.LOVE);
      if (this.orbitControls) this.orbitControls.enabled = false;
    } else {
      this.motionBricks.stopHandHold();
      this.animator.setEmotion(AvatarEmotion.NEUTRAL);
      if (this.orbitControls) this.orbitControls.enabled = !this.inXRSession;
    }
    this.hooks.onHandHoldChanged?.(this.handHoldModePinned);
    return this.handHoldModePinned;
  }

  get isHandHoldPinned(): boolean {
    return this.handHoldModePinned;
  }

  /**
   * 'XRButton' click handler: initializes Three.js WebXR `immersive-vr` session
   * or toggles the Immersive VR room preview on desktop.
   */
  async handleXRButtonClick(): Promise<VRSessionStatus> {
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const status = await this.vrController.enterImmersiveVR(renderer, xb.core.scene);
    const vrActive = status.state !== 'idle';

    if (xb.core.transition?.currentMode === 'VR') {
      xb.core.transition.toAR();
    }

    this.spatialCardsGroup.visible = vrActive || this.spatialCardsVisible;
    if (this.orbitControls) {
      this.orbitControls.enabled = status.state !== 'immersive-vr';
    }

    if (vrActive) {
      if (status.state === 'simulated-vr' && xb.core.camera) {
        if (xb.core.camera instanceof THREE.PerspectiveCamera) {
          xb.core.camera.fov = 62;
          xb.core.camera.updateProjectionMatrix();
        }
        xb.core.camera.position.set(0.18, 1.32, 0.05);
        this.orbitControls?.target.set(-0.08, 0.92, -1.78);
        this.orbitControls?.update();
      }
    } else if (xb.core.camera) {
      if (xb.core.camera instanceof THREE.PerspectiveCamera) {
        xb.core.camera.fov = 56;
        xb.core.camera.updateProjectionMatrix();
      }
      xb.core.camera.position.set(0.22, 1.38, 0.25);
      this.orbitControls?.target.set(-0.08, 0.92, -1.78);
      this.orbitControls?.update();
    }

    this.hooks.onVRStatusChanged?.(status);
    return status;
  }

  get vrModeActive(): boolean {
    return this.vrController.isVRModeActive;
  }

  // ---- Desktop Pointer Events for Hand-Hold Drag + Prop Clicking ----

  private setRayFromClient(clientX: number, clientY: number): boolean {
    const camera = xb.core.camera;
    const el = this.domElement;
    if (!camera || !el) return false;
    const rect = el.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    _raycaster.setFromCamera(_ndc, camera);
    return true;
  }

  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.inXRSession) return;
    if (!this.setRayFromClient(e.clientX, e.clientY)) return;

    this.updateAvatarHitboxes();
    const avatarHits = _raycaster.intersectObjects(
      [this.leftHandHitMesh, this.rightHandHitMesh, this.torsoHitMesh],
      false
    );

    if (avatarHits.length > 0) {
      const hitObj = avatarHits[0].object;
      const side: 'left' | 'right' =
        hitObj === this.leftHandHitMesh ? 'left' : 'right';
      this.pointerDownState = {
        active: true,
        x: e.clientX,
        y: e.clientY,
        hitAvatar: true,
        hitSide: side,
        hitProp: null,
        hitPoint: avatarHits[0].point.clone(),
        dragStarted: false,
      };
      if (this.orbitControls) this.orbitControls.enabled = false;
      return;
    }

    const propHits = _raycaster.intersectObjects(this.room.getAllHitMeshes(), false);
    const prop = propHits.length > 0 ? this.room.findPropByMesh(propHits[0].object) : null;
    this.pointerDownState = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      hitAvatar: false,
      hitProp: prop,
      hitPoint: propHits[0]?.point.clone() ?? null,
      dragStarted: false,
    };
  };

  private onWindowPointerMove = (e: PointerEvent): void => {
    if (this.inXRSession) return;

    // 1. Pinned Hand-Hold mode follows cursor smoothly across room
    if (this.handHoldModePinned && !this.pointerDownState.active) {
      if (this.setRayFromClient(e.clientX, e.clientY)) {
        if (_raycaster.ray.intersectPlane(_handPlane, _planeHit)) {
          this.motionBricks.updateHandHoldTarget(_planeHit);
        }
      }
      return;
    }

    // 2. Active drag on Avatar -> Hand-Hold Leading MotionBrick
    if (this.pointerDownState.active) {
      const distPx = Math.hypot(
        e.clientX - this.pointerDownState.x,
        e.clientY - this.pointerDownState.y
      );
      if (this.pointerDownState.hitAvatar && distPx > 6) {
        if (!this.pointerDownState.dragStarted) {
          this.pointerDownState.dragStarted = true;
          this.setRayFromClient(e.clientX, e.clientY);
          const got = _raycaster.ray.intersectPlane(_handPlane, _planeHit);
          if (got) {
            this.motionBricks.startHandHold(
              _planeHit,
              this.pointerDownState.hitSide
            );
            this.animator.setEmotion(AvatarEmotion.LOVE);
            this.hooks.onHandHoldChanged?.(true);
          }
        } else if (this.setRayFromClient(e.clientX, e.clientY)) {
          if (_raycaster.ray.intersectPlane(_handPlane, _planeHit)) {
            this.motionBricks.updateHandHoldTarget(_planeHit);
          }
        }
        return;
      } else if (distPx > 8) {
        this.pointerDownState.dragStarted = true;
      }
      return;
    }

    // 3. Throttled hover raycast for prop/hand highlight & floating hint
    const now = performance.now();
    if (now - this.lastHoverCheckMs < 48) return;
    this.lastHoverCheckMs = now;

    // Ignore hover raycast when pointer is over HUD overlay elements
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && this.domElement && targetEl !== this.domElement) {
      this.room.setHoveredProp(null);
      this.hooks.onHoverHintChanged?.(null);
      if (this.domElement) this.domElement.style.cursor = 'default';
      return;
    }

    if (!this.setRayFromClient(e.clientX, e.clientY)) return;
    this.updateAvatarHitboxes();

    const avatarHits = _raycaster.intersectObjects(
      [this.leftHandHitMesh, this.rightHandHitMesh, this.torsoHitMesh],
      false
    );
    if (avatarHits.length > 0) {
      this.room.setHoveredProp(null);
      if (this.domElement) this.domElement.style.cursor = 'grab';
      this.hooks.onHoverHintChanged?.({
        text: '🤝 드래그해서 손잡고 끌기 (또는 클릭: 쓰담)',
        screenX: e.clientX,
        screenY: e.clientY - 26,
        isHandHold: true,
      });
      return;
    }

    const propHits = _raycaster.intersectObjects(this.room.getAllHitMeshes(), false);
    const prop = propHits.length > 0 ? this.room.findPropByMesh(propHits[0].object) : null;
    if (prop) {
      this.room.setHoveredProp(prop, propHits[0].point);
      if (this.domElement) this.domElement.style.cursor = 'pointer';
      this.hooks.onHoverHintChanged?.({
        text: prop.label,
        screenX: e.clientX,
        screenY: e.clientY - 26,
      });
    } else {
      this.room.setHoveredProp(null);
      if (this.domElement) this.domElement.style.cursor = 'default';
      this.hooks.onHoverHintChanged?.(null);
    }
  };

  private onWindowPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDownState.active) return;

    const wasAvatar = this.pointerDownState.hitAvatar;
    const wasDrag = this.pointerDownState.dragStarted;
    const hitProp = this.pointerDownState.hitProp;
    const hitPoint = this.pointerDownState.hitPoint;

    this.pointerDownState.active = false;
    if (this.orbitControls && !this.handHoldModePinned) {
      this.orbitControls.enabled = !this.inXRSession;
    }

    if (wasAvatar) {
      if (wasDrag) {
        if (!this.handHoldModePinned) {
          this.motionBricks.stopHandHold();
          this.animator.setEmotion(AvatarEmotion.HAPPY);
          this.hooks.onHandHoldChanged?.(false);
        }
      } else {
        // Short click on AIMouto -> friendly poke/headpat reaction
        this.hooks.onAvatarPoke?.();
      }
      return;
    }

    // Clean click (without orbit drag) on any interactive prop or floor
    if (!wasDrag && hitProp) {
      this.interactWithProp(hitProp.id, hitPoint ?? undefined);
    } else if (!wasDrag && e.target === this.domElement) {
      // Fallback: raycast floor directly
      if (this.setRayFromClient(e.clientX, e.clientY)) {
        const floorProp = this.room.interactiveProps.get('floor');
        if (floorProp) {
          const hits = _raycaster.intersectObjects(floorProp.hitMeshes, false);
          if (hits.length > 0) {
            this.interactWithProp('floor', hits[0].point);
          }
        }
      }
    }
  };

  // ---- WebXR Controller Hand-Hold & Prop Raycast ----

  private raycastFromXRController(controller: THREE.Object3D): void {
    controller.getWorldPosition(_xrOrigin);
    _xrRotMat.identity().extractRotation(controller.matrixWorld);
    _xrDir.set(0, 0, -1).applyMatrix4(_xrRotMat).normalize();
    _raycaster.set(_xrOrigin, _xrDir);
  }

  onSelectStart(event: xb.SelectEvent): void {
    const ctrl = event.source?.controller;
    if (!ctrl) return;

    this.updateAvatarHitboxes();
    ctrl.getWorldPosition(_xrCtrlWorld);

    // Check direct hand proximity grab in WebXR OR controller ray hitting avatar
    this.motionBricks.getHandWorldPosition('right', _handWorld);
    const distR = _xrCtrlWorld.distanceTo(_handWorld);
    this.motionBricks.getHandWorldPosition('left', _handWorld);
    const distL = _xrCtrlWorld.distanceTo(_handWorld);

    this.raycastFromXRController(ctrl);
    const avatarHits = _raycaster.intersectObjects(
      [this.leftHandHitMesh, this.rightHandHitMesh, this.torsoHitMesh],
      false
    );

    if (distR < 0.55 || distL < 0.55 || avatarHits.length > 0) {
      this.activeXrGrabController = ctrl;
      const side: 'left' | 'right' = distL < distR ? 'left' : 'right';
      this.motionBricks.startHandHold(_xrCtrlWorld, side);
      this.animator.setEmotion(AvatarEmotion.LOVE);
      this.hooks.onHandHoldChanged?.(true);
      return;
    }

    // Otherwise raycast room furniture / floor
    const propHits = _raycaster.intersectObjects(this.room.getAllHitMeshes(), false);
    if (propHits.length > 0) {
      const prop = this.room.findPropByMesh(propHits[0].object);
      if (prop) {
        this.interactWithProp(prop.id, propHits[0].point);
      }
    }
  }

  onSelectEnd(event: xb.SelectEndEvent): void {
    if (
      this.activeXrGrabController &&
      event.source?.controller === this.activeXrGrabController
    ) {
      this.activeXrGrabController = null;
      this.motionBricks.stopHandHold();
      this.animator.setEmotion(AvatarEmotion.NEUTRAL);
      this.hooks.onHandHoldChanged?.(false);
    }
  }

  onSqueezeStart(event: xb.SelectEvent): void {
    const ctrl = event.source?.controller;
    if (!ctrl) return;
    ctrl.getWorldPosition(_xrCtrlWorld);
    this.activeXrGrabController = ctrl;
    this.motionBricks.startHandHold(_xrCtrlWorld);
    this.animator.setEmotion(AvatarEmotion.LOVE);
    this.hooks.onHandHoldChanged?.(true);
  }

  onSqueezeEnd(event: xb.SelectEvent): void {
    if (
      this.activeXrGrabController &&
      event.source?.controller === this.activeXrGrabController
    ) {
      this.activeXrGrabController = null;
      this.motionBricks.stopHandHold();
      this.animator.setEmotion(AvatarEmotion.NEUTRAL);
      this.hooks.onHandHoldChanged?.(false);
    }
  }

  // ---- Spatial UI & Public Accessors ----

  private buildSpatialUICards(): void {
    xb.ui.setTheme(blueprintToXBThemeUpdate(ANIME_UI_BLUEPRINT));
    const cardConfigs = blueprintToSpatialCardConfigs(ANIME_UI_BLUEPRINT);

    const statusCfg = cardConfigs.find((c) => c.id === 'status_card')!;
    this.spatialStatusText = new xb.UIText({
      text: 'EMOTION: NEUTRAL\nPOSE: Room Idle',
      style: {fontSize: 18, lineHeight: 1.35, color: '#4be3ff'},
    });
    const statusCard = new xb.UICard({
      size: statusCfg.size,
      pixelSize: statusCfg.pixelSize,
      manipulation: statusCfg.manipulation,
      edge: true,
      style: statusCfg.cardStyle,
      children: [
        new xb.UIText({
          text: 'AIMOUTO-XR',
          style: {fontSize: 22, fontWeight: 'bold', color: '#ffffff'},
        }),
        this.spatialStatusText,
      ],
    });
    statusCard.position.set(...statusCfg.position);
    statusCard.rotation.set(...statusCfg.rotation);
    this.spatialCardsGroup.add(statusCard);

    const quickCfg = cardConfigs.find((c) => c.id === 'quick_actions')!;
    const quickCard = new xb.UICard({
      size: quickCfg.size,
      pixelSize: quickCfg.pixelSize,
      manipulation: quickCfg.manipulation,
      edge: true,
      style: quickCfg.cardStyle,
      children: [
        new xb.UIText({
          text: 'MOTIONBRICKS',
          style: {fontSize: 18, fontWeight: 'bold', color: '#ff6ba8'},
        }),
        new xb.UIButton({
          label: 'Sit Desk',
          icon: 'chair',
          onClick: () => this.interactWithProp('desk_chair'),
        }),
        new xb.UIButton({
          label: 'Rest Bed',
          icon: 'bed',
          onClick: () => this.interactWithProp('bed'),
        }),
        new xb.UIButton({
          label: 'Window',
          icon: 'window',
          onClick: () => this.interactWithProp('window'),
        }),
        new xb.UIButton({
          label: 'Chaos Dice',
          icon: 'casino',
          onClick: () => this.hooks.onSpatialQuickAction?.('trigger_chaos'),
        }),
      ],
    });
    quickCard.position.set(...quickCfg.position);
    quickCard.rotation.set(...quickCfg.rotation);
    this.spatialCardsGroup.add(quickCard);

    const dlgCfg = cardConfigs.find((c) => c.id === 'dialogue_deck')!;
    this.spatialDialogueText = new xb.UIText({
      text: '...',
      style: {
        width: '100%',
        fontSize: 18,
        lineHeight: 1.35,
        color: '#eef7ff',
        whiteSpace: 'pre-line',
      },
    });
    this.spatialInput = new xb.UITextInput({
      ariaLabel: 'Spatial chat message',
      placeholder: 'Say something to AIMouto...',
      style: {width: '100%', height: 42},
      onSubmit: (val) => {
        if (val.trim()) {
          this.hooks.onSpatialChatSubmit?.(val.trim());
          if (this.spatialInput) this.spatialInput.value = '';
        }
      },
    });
    const dlgCard = new xb.UICard({
      size: dlgCfg.size,
      pixelSize: dlgCfg.pixelSize,
      manipulation: dlgCfg.manipulation,
      edge: true,
      style: dlgCfg.cardStyle,
      children: [
        this.spatialDialogueText,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 10, alignItems: 'center'},
          children: [
            this.spatialInput,
            new xb.UIButton({
              label: 'Send',
              icon: 'send',
              onClick: () => {
                const val = this.spatialInput?.value?.trim();
                if (val) {
                  this.hooks.onSpatialChatSubmit?.(val);
                  if (this.spatialInput) this.spatialInput.value = '';
                }
              },
            }),
          ],
        }),
      ],
    });
    dlgCard.position.set(...dlgCfg.position);
    dlgCard.rotation.set(...dlgCfg.rotation);
    this.spatialCardsGroup.add(dlgCard);
  }

  setSpatialCardsVisible(visible: boolean): void {
    this.spatialCardsVisible = visible;
    this.spatialCardsGroup.visible =
      visible || this.inXRSession || this.vrController.isVRModeActive;
  }

  get spatialCardsEnabled(): boolean {
    return this.spatialCardsGroup.visible;
  }

  setSkeletonVisible(visible: boolean): void {
    if (this.skeletonHelper) {
      this.skeletonHelper.visible = visible;
    }
  }

  get skeletonVisible(): boolean {
    return Boolean(this.skeletonHelper?.visible);
  }

  setEmotion(emotion: AvatarEmotion): void {
    this.animator.setEmotion(emotion);
    this.syncSpatialStatus();
  }

  playGesture(gesture: AvatarGesture): void {
    if (gesture !== AvatarGesture.IDLE && this.motionBricks.pose !== 'idle') {
      // Return to relaxed standing idle briefly when an explicit emote gesture is fired
      this.motionBricks.walkToFloor(
        this.motionBricks.rootPosition.x,
        this.motionBricks.rootPosition.z,
        0
      );
    }
    if (gesture === AvatarGesture.JUMP_CHEER) {
      this.motionBricks.triggerJump();
    }
    this.animator.playGesture(gesture);
    this.syncSpatialStatus();
  }

  setStageTheme(theme: StageThemeId): void {
    this.room?.applyTheme(
      theme,
      this.inXRSession && xb.core.transition?.currentMode === 'AR'
        ? undefined
        : xb.core.scene
    );
  }

  get stageTheme(): StageThemeId {
    return this.room?.themeId ?? 'midnight_neon';
  }

  showGeneratedArt(imageUrl: string): void {
    this.room?.showGeneratedArt(imageUrl);
  }

  setDialogueSubtitle(text: string): void {
    if (this.spatialDialogueText) {
      this.spatialDialogueText.text = text;
    }
  }

  setVoiceState(state: {
    mouthOpen: number;
    viseme: VisemeVowel;
    speaking: boolean;
  }): void {
    this.voiceState = state;
  }

  setGazeNDC(nx: number, ny: number): void {
    this.animator.setGazeNDC(nx, ny);
  }

  toggleARVR(target?: 'AR' | 'VR'): 'AR' | 'VR' {
    const transition = xb.core.transition;
    if (!transition) return 'VR';
    const next = target ?? (transition.currentMode === 'AR' ? 'VR' : 'AR');
    if (next === 'AR') {
      transition.toAR();
    } else {
      transition.toVR({color: 0x0e1024});
    }
    return next;
  }

  private syncSpatialStatus(): void {
    if (!this.spatialStatusText) return;
    const emo = EMOTION_PRESETS[this.animator.emotion]?.label ?? 'READY';
    const brickLabel = MOTION_BRICK_LABELS[this.motionBricks.pose] ?? 'Room Idle';
    const vrmName = this.vrmManager.info?.name ?? 'VRM Rig';
    this.spatialStatusText.text = `${vrmName}\nEMOTION: ${emo}\nMOTION: ${brickLabel}`;
  }

  onXRSessionStarted(): void {
    this.inXRSession = true;
    if (this.orbitControls) this.orbitControls.enabled = false;
    this.vrController.setVRVisualsActive(true);
    this.spatialCardsGroup.visible = true;
    this.hooks.onXRModeChanged?.(true);
  }

  onXRSessionEnded(): void {
    this.inXRSession = false;
    this.activeXrGrabController = null;
    if (this.orbitControls) this.orbitControls.enabled = true;
    this.vrController.setVRVisualsActive(false);
    this.spatialCardsGroup.visible = this.spatialCardsVisible;
    this.hooks.onXRModeChanged?.(false);
  }

  onSimulatorStarted(): void {
    // Clear any stray XR Blocks default simulator room meshes (couch/apartment)
    (
      xb.core as unknown as {
        simulator?: {simulatorScene?: {clearEnvironment?: () => void}};
      }
    )?.simulator?.simulatorScene?.clearEnvironment?.();

    this.room?.applyTheme(this.stageTheme, xb.core.scene);
    if (xb.core.camera) {
      if (xb.core.camera instanceof THREE.PerspectiveCamera) {
        xb.core.camera.fov = 56;
        xb.core.camera.updateProjectionMatrix();
      }
      // Cozy 3/4 bedroom perspective showing left window + desk, center rug + avatar, and bed behind
      xb.core.camera.position.set(0.22, 1.38, 0.25);
      if (this.orbitControls) {
        this.orbitControls.target.set(-0.08, 0.92, -1.78);
        this.orbitControls.update();
      } else {
        xb.core.camera.lookAt(-0.08, 0.92, -1.78);
      }
      this.room?.updateCameraCulling(xb.core.camera);
    }
  }

  update(): void {
    const dt = xb.getDeltaTime() || 0.016;
    this.elapsed += dt;

    // Live WebXR controller hand-hold tracking
    if (this.activeXrGrabController && this.motionBricks.isHandHolding) {
      this.activeXrGrabController.getWorldPosition(_xrCtrlWorld);
      this.motionBricks.updateHandHoldTarget(_xrCtrlWorld);
    }

    // Update MotionBricks whole-body synthesis & room navigation
    this.motionBricks.update(dt, this.elapsed, this.avatarRoot);

    // Update visual hand-hold ring & tether line
    if (this.motionBricks.isHandHolding) {
      this.motionBricks.getHandWorldPosition(
        this.motionBricks.heldHandSide,
        _handWorld
      );
      this.handHoldRingMesh.position.copy(_handWorld);
      this.handHoldRingMesh.rotation.y = this.elapsed * 2.5;
      this.handHoldRingMesh.visible = true;

      if (this.activeXrGrabController) {
        this.activeXrGrabController.getWorldPosition(_projVec);
      } else {
        _projVec.copy(_planeHit);
      }
      this.handTetherPositions[0] = _handWorld.x;
      this.handTetherPositions[1] = _handWorld.y;
      this.handTetherPositions[2] = _handWorld.z;
      this.handTetherPositions[3] = _projVec.x;
      this.handTetherPositions[4] = _projVec.y;
      this.handTetherPositions[5] = _projVec.z;
      this.handTetherLine.geometry.attributes.position.needsUpdate = true;
      this.handTetherLine.visible = true;
    } else {
      this.handHoldRingMesh.visible = false;
      this.handTetherLine.visible = false;
    }

    const hasWorldGaze =
      this.motionBricks.getActiveGazeTargetWorld(_gazeTargetWorld);
    this.animator.update(dt, this.voiceState, {
      bodyPoseOverridden: this.motionBricks.isDrivingBodyPose,
      worldGazeTarget: hasWorldGaze ? _gazeTargetWorld : null,
    });

    this.room?.update(this.elapsed, dt);
    this.vrController.update(this.elapsed);
    this.orbitControls?.update();
    if (xb.core.camera) {
      this.room?.updateCameraCulling(xb.core.camera);
    }

    // Emit MotionBrick + Rapier physics snapshot change notifications cleanly
    const snap = this.motionBricks.getSnapshot();
    const key = `${snap.pose}|${snap.activeProp ?? ''}|${snap.handHoldActive}|${snap.physicsActive ? 1 : 0}|${snap.grounded ? 1 : 0}|${snap.motionBackend ?? ''}`;
    if (key !== this.lastSnapshotKey) {
      this.lastSnapshotKey = key;
      this.hooks.onMotionStateChanged?.(snap);
      this.syncSpatialStatus();
    }
  }

  dispose(): void {
    this.motionBricks.dispose();
    this.domElement?.removeEventListener('pointerdown', this.onCanvasPointerDown);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    this.motionBricks.attachPhysics(null);
    this.physicsSim?.dispose();
    this.physicsSim = null;
    this.leftHandHitMesh?.geometry.dispose();
    this.rightHandHitMesh?.geometry.dispose();
    this.torsoHitMesh?.geometry.dispose();
    if (this.torsoHitMesh?.material instanceof THREE.Material) {
      this.torsoHitMesh.material.dispose();
    }
    this.handHoldRingMesh?.geometry.dispose();
    if (this.handHoldRingMesh?.material instanceof THREE.Material) {
      this.handHoldRingMesh.material.dispose();
    }
    this.handTetherLine?.geometry.dispose();
    if (this.handTetherLine?.material instanceof THREE.Material) {
      this.handTetherLine.material.dispose();
    }
    this.orbitControls?.dispose();
    this.animator.dispose();
    this.vrmManager.dispose();
    this.vrController.dispose();
    this.room?.dispose();
    this.skeletonHelper?.dispose();
    this.envRT?.dispose();
  }
}
