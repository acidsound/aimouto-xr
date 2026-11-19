import * as THREE from 'three';
import {XRControllerModelFactory} from 'three/addons/webxr/XRControllerModelFactory.js';

export type VRSessionState = 'idle' | 'immersive-vr' | 'simulated-vr';

export interface VRSessionStatus {
  state: VRSessionState;
  supported: boolean;
  message: string;
  error?: boolean;
}

export interface WebXRSessionEventLike {
  type: string;
  session?: XRSession;
  error?: unknown;
}

export interface WebXRSessionManagerLike {
  currentSession?: XRSession;
  waitingForXRSession?: boolean;
  startSession(): void;
  endSession(): Promise<void>;
  isXRSupported(): boolean | undefined;
  addEventListener(
    type: string,
    listener: (event: WebXRSessionEventLike) => void
  ): void;
  removeEventListener(
    type: string,
    listener: (event: WebXRSessionEventLike) => void
  ): void;
}

export interface XRSimulatorLike {
  simulatorUpdate?: () => void;
  renderFrame?: () => void;
  getRenderCamera?: () => THREE.Camera | undefined;
}

export interface XRCoreLike {
  renderer?: {
    xr?: {
      isPresenting?: boolean;
      enabled?: boolean;
      setReferenceSpaceType?: (type: string) => void;
      getController?: (index: number) => THREE.XRTargetRaySpace;
      getControllerGrip?: (index: number) => THREE.XRGripSpace;
    };
  };
  scene?: THREE.Scene;
  camera?: THREE.Camera;
  simulatorRunning?: boolean;
  simulator?: XRSimulatorLike;
  lighting?: {simulatorRunning?: boolean};
  webXRSessionManager?: WebXRSessionManagerLike;
  renderSimulatorAndScene?: () => void;
  getFrameCamera?: () => THREE.Camera;
  renderScene?: (cameraOverride?: THREE.Camera) => void;
}

/**
 * Pure helper evaluating navigator.xr capability and producing user-facing status.
 */
export async function checkImmersiveVRSupport(
  xrNavigator?: Pick<XRSystem, 'isSessionSupported'>
): Promise<boolean> {
  if (!xrNavigator || typeof xrNavigator.isSessionSupported !== 'function') {
    return false;
  }
  try {
    return await xrNavigator.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * Guards XR Blocks' Core render loop so that while a real WebXR session is
 * presenting (`renderer.xr.isPresenting === true`), the desktop Simulator's
 * update & compositor (which calls `renderer.setRenderTarget(null)`) are
 * completely bypassed, keeping Three.js's bound XR framebuffer intact.
 *
 * When the XR session ends (or fails before presenting), web-browse simulator
 * rendering is cleanly restored if it was active prior to entering XR.
 */
export class XRSimulatorRenderBridge {
  private core: XRCoreLike | null = null;
  private simulatorWasRunningBeforeXR = false;
  private origRenderSimulatorAndScene: (() => void) | null = null;
  private origGetFrameCamera: (() => THREE.Camera) | null = null;
  private guardedSimulator: XRSimulatorLike | null = null;
  private origSimulatorUpdate: (() => void) | null = null;

  private readonly onBeforeSessionStart = (): void => {
    this.suspendSimulatorForXR();
  };

  private readonly onSessionStart = (): void => {
    this.suspendSimulatorForXR();
  };

  private readonly onSessionEnd = (): void => {
    this.restoreSimulatorAfterXR();
  };

  private readonly onSessionError = (): void => {
    if (!this.core?.renderer?.xr?.isPresenting) {
      this.restoreSimulatorAfterXR();
    }
  };

  get isSimulatorSuspendedForXR(): boolean {
    return this.simulatorWasRunningBeforeXR;
  }

  attach(core: XRCoreLike): void {
    if (this.core === core) {
      this.guardSimulatorUpdate(core);
      return;
    }
    this.detach();
    this.core = core;

    const mgr = core.webXRSessionManager;
    if (mgr) {
      mgr.addEventListener('beforesessionstart', this.onBeforeSessionStart);
      mgr.addEventListener('sessionstart', this.onSessionStart);
      mgr.addEventListener('sessionend', this.onSessionEnd);
      mgr.addEventListener('sessionerror', this.onSessionError);
    }

    if (typeof core.renderSimulatorAndScene === 'function') {
      const orig = core.renderSimulatorAndScene.bind(core);
      this.origRenderSimulatorAndScene = core.renderSimulatorAndScene;
      core.renderSimulatorAndScene = () => {
        if (core.renderer?.xr?.isPresenting) {
          this.suspendSimulatorForXR();
          core.renderScene?.();
          return;
        }
        orig();
      };
    }

    if (typeof core.getFrameCamera === 'function') {
      const orig = core.getFrameCamera.bind(core);
      this.origGetFrameCamera = core.getFrameCamera;
      core.getFrameCamera = () => {
        if (core.renderer?.xr?.isPresenting && core.camera) {
          return core.camera;
        }
        return orig();
      };
    }

    this.guardSimulatorUpdate(core);
  }

  /**
   * Wraps `core.simulator.simulatorUpdate` (once the simulator is lazily loaded)
   * so it never mutates camera/input while a real WebXR session is presenting.
   */
  guardSimulatorUpdate(core: XRCoreLike): void {
    const sim = core.simulator;
    if (!sim || typeof sim.simulatorUpdate !== 'function') return;
    if (this.guardedSimulator === sim) return;

    this.restoreSimulatorUpdateHook();
    this.guardedSimulator = sim;
    this.origSimulatorUpdate = sim.simulatorUpdate;
    const orig = sim.simulatorUpdate.bind(sim);
    sim.simulatorUpdate = () => {
      if (core.renderer?.xr?.isPresenting) return;
      orig();
    };
  }

  suspendSimulatorForXR(): void {
    const core = this.core;
    if (!core) return;
    if (core.simulatorRunning) {
      this.simulatorWasRunningBeforeXR = true;
      core.simulatorRunning = false;
    }
    if (core.lighting && core.lighting.simulatorRunning) {
      core.lighting.simulatorRunning = false;
    }
  }

  restoreSimulatorAfterXR(): void {
    const core = this.core;
    if (!core) return;
    if (this.simulatorWasRunningBeforeXR) {
      this.simulatorWasRunningBeforeXR = false;
      core.simulatorRunning = true;
      if (core.lighting) {
        core.lighting.simulatorRunning = true;
      }
    }
  }

  private restoreSimulatorUpdateHook(): void {
    if (this.guardedSimulator && this.origSimulatorUpdate) {
      this.guardedSimulator.simulatorUpdate = this.origSimulatorUpdate;
    }
    this.guardedSimulator = null;
    this.origSimulatorUpdate = null;
  }

  detach(): void {
    if (!this.core) return;
    const mgr = this.core.webXRSessionManager;
    if (mgr) {
      mgr.removeEventListener('beforesessionstart', this.onBeforeSessionStart);
      mgr.removeEventListener('sessionstart', this.onSessionStart);
      mgr.removeEventListener('sessionend', this.onSessionEnd);
      mgr.removeEventListener('sessionerror', this.onSessionError);
    }
    if (this.origRenderSimulatorAndScene) {
      this.core.renderSimulatorAndScene = this.origRenderSimulatorAndScene;
      this.origRenderSimulatorAndScene = null;
    }
    if (this.origGetFrameCamera) {
      this.core.getFrameCamera = this.origGetFrameCamera;
      this.origGetFrameCamera = null;
    }
    this.restoreSimulatorUpdateHook();
    this.simulatorWasRunningBeforeXR = false;
    this.core = null;
  }
}

/**
 * Manages the Immersive VR room accent visuals, WebXR controller rig, and
 * single-path WebXR session coordination backed exclusively by XR Blocks'
 * `WebXRSessionManager` (never issuing a duplicate `navigator.xr.requestSession`).
 */
export class ImmersiveVRController {
  readonly vrEnvironmentGroup = new THREE.Group();
  readonly controllersGroup = new THREE.Group();
  readonly renderBridge = new XRSimulatorRenderBridge();

  private state: VRSessionState = 'idle';
  private starRingMesh!: THREE.Mesh;
  private arcMeshes: THREE.Mesh[] = [];
  private controllersInitialized = false;
  private readonly disposables: Array<{dispose: () => void}> = [];

  private attachedCore: XRCoreLike | null = null;
  private onStatusChangedCb: ((status: VRSessionStatus) => void) | null = null;
  private pendingStartPromise: Promise<VRSessionStatus> | null = null;

  private readonly onSdkSessionStart = (): void => {
    this.state = 'immersive-vr';
    this.setVRVisualsActive(true);
    this.onStatusChangedCb?.({
      state: 'immersive-vr',
      supported: true,
      message: 'Immersive VR WebXR session active (local-floor).',
    });
  };

  private readonly onSdkSessionEnd = (): void => {
    this.state = 'idle';
    this.setVRVisualsActive(false);
    this.onStatusChangedCb?.({
      state: 'idle',
      supported: Boolean(this.attachedCore?.webXRSessionManager?.isXRSupported()),
      message: 'Exited Immersive VR session.',
    });
  };

  private readonly onSdkSessionError = (event: WebXRSessionEventLike): void => {
    const errMsg =
      event.error instanceof Error
        ? event.error.message
        : String(event.error ?? 'Unknown WebXR session error');
    this.state = 'idle';
    this.setVRVisualsActive(false);
    this.onStatusChangedCb?.({
      state: 'idle',
      supported: Boolean(this.attachedCore?.webXRSessionManager?.isXRSupported()),
      error: true,
      message: `WebXR session failed to start: ${errMsg}`,
    });
  };

  constructor() {
    this.vrEnvironmentGroup.name = 'ImmersiveVREnvironment';
    this.vrEnvironmentGroup.visible = false;
    this.controllersGroup.name = 'WebXRControllers';
    this.controllersGroup.visible = false;
    this.buildVRDome();
  }

  get currentState(): VRSessionState {
    return this.state;
  }

  get isVRModeActive(): boolean {
    return this.state !== 'idle';
  }

  private track<T extends {dispose: () => void}>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  private buildVRDome(): void {
    // Subtle glowing VR spatial ring framing the Lo-Fi bedroom floor without occluding walls/window
    const horizonGeo = this.track(new THREE.TorusGeometry(1.45, 0.012, 8, 48));
    const horizonMat = this.track(
      new THREE.MeshBasicMaterial({color: 0x4be3ff, transparent: true, opacity: 0.45})
    );
    this.starRingMesh = new THREE.Mesh(horizonGeo, horizonMat);
    this.starRingMesh.rotation.x = Math.PI / 2;
    this.starRingMesh.position.set(0, 2.38, -1.65);
    this.vrEnvironmentGroup.add(this.starRingMesh);
  }

  /**
   * Attaches to XR Blocks' Core & WebXRSessionManager as the single source of truth
   * for both landing-page and HUD Enter VR flows, and installs the XR render bridge.
   */
  attachToCore(
    core: XRCoreLike,
    options?: {onStatusChanged?: (status: VRSessionStatus) => void}
  ): void {
    this.detachFromCore();
    this.attachedCore = core;
    this.onStatusChangedCb = options?.onStatusChanged ?? null;
    this.renderBridge.attach(core);

    const mgr = core.webXRSessionManager;
    if (mgr) {
      mgr.addEventListener('sessionstart', this.onSdkSessionStart);
      mgr.addEventListener('sessionend', this.onSdkSessionEnd);
      mgr.addEventListener('sessionerror', this.onSdkSessionError);
      if (mgr.currentSession) {
        this.state = 'immersive-vr';
        this.setVRVisualsActive(true);
      }
    }
  }

  onSimulatorStarted(core: XRCoreLike): void {
    this.renderBridge.guardSimulatorUpdate(core);
  }

  detachFromCore(): void {
    const mgr = this.attachedCore?.webXRSessionManager;
    if (mgr) {
      mgr.removeEventListener('sessionstart', this.onSdkSessionStart);
      mgr.removeEventListener('sessionend', this.onSdkSessionEnd);
      mgr.removeEventListener('sessionerror', this.onSdkSessionError);
    }
    this.renderBridge.detach();
    this.attachedCore = null;
    this.onStatusChangedCb = null;
  }

  /**
   * Initializes Three.js WebXR reference space and VR controller rays/grips.
   */
  initWebXRRig(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!renderer?.xr) return;
    renderer.xr.enabled = true;
    try {
      renderer.xr.setReferenceSpaceType('local-floor');
    } catch {
      // Ignore if an active session already locked reference space
    }

    if (this.controllersInitialized) return;
    this.controllersInitialized = true;

    const factory = new XRControllerModelFactory();
    const rayGeo = this.track(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -4),
      ])
    );

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const rayMat = this.track(
        new THREE.LineBasicMaterial({
          color: i === 0 ? 0x4be3ff : 0xff6ba8,
        })
      );
      const line = new THREE.Line(rayGeo, rayMat);
      line.name = `VRPointerRay_${i}`;
      controller.add(line);
      this.controllersGroup.add(controller);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      this.controllersGroup.add(grip);
    }

    if (!this.controllersGroup.parent) {
      scene.add(this.controllersGroup);
    }
  }

  /**
   * Unified HUD Enter/Exit VR handler:
   * - If a real WebXR session is active -> ends it via `core.webXRSessionManager.endSession()`.
   * - If WebXR is supported -> starts a session EXCLUSIVELY via `core.webXRSessionManager.startSession()`.
   * - If WebXR hardware is not available (desktop browser) -> toggles the simulated VR preview dome
   *   without ever calling `navigator.xr.requestSession`.
   */
  async toggleVRFromHud(
    core: XRCoreLike,
    scene?: THREE.Scene
  ): Promise<VRSessionStatus> {
    if (this.attachedCore !== core) {
      this.attachToCore(core);
    }

    const mgr = core.webXRSessionManager;

    if (mgr?.currentSession) {
      try {
        await mgr.endSession();
      } catch {
        // Ignore if already ended
      }
      this.state = 'idle';
      this.setVRVisualsActive(false);
      return {
        state: 'idle',
        supported: true,
        message: 'Exited Immersive VR session.',
      };
    }

    if (this.state === 'simulated-vr') {
      this.setVRVisualsActive(false);
      this.state = 'idle';
      return {
        state: 'idle',
        supported: false,
        message: 'Exited VR Concert Preview.',
      };
    }

    if (core.renderer && scene && 'setSize' in core.renderer) {
      this.initWebXRRig(core.renderer as unknown as THREE.WebGLRenderer, scene);
    }

    if (mgr && mgr.isXRSupported() === true) {
      if (this.pendingStartPromise) {
        return this.pendingStartPromise;
      }

      this.pendingStartPromise = new Promise<VRSessionStatus>((resolve) => {
        const cleanup = () => {
          mgr.removeEventListener('sessionstart', handleStart);
          mgr.removeEventListener('sessionerror', handleError);
          this.pendingStartPromise = null;
        };
        const handleStart = () => {
          cleanup();
          resolve({
            state: 'immersive-vr',
            supported: true,
            message: 'Immersive VR WebXR session active (local-floor).',
          });
        };
        const handleError = (event: WebXRSessionEventLike) => {
          cleanup();
          const errMsg =
            event.error instanceof Error
              ? event.error.message
              : String(event.error ?? 'Unknown WebXR session error');
          resolve({
            state: 'idle',
            supported: true,
            error: true,
            message: `WebXR session failed to start: ${errMsg}`,
          });
        };

        mgr.addEventListener('sessionstart', handleStart);
        mgr.addEventListener('sessionerror', handleError);

        try {
          mgr.startSession();
        } catch (err) {
          cleanup();
          const errMsg = err instanceof Error ? err.message : String(err);
          resolve({
            state: 'idle',
            supported: true,
            error: true,
            message: `WebXR session failed to start: ${errMsg}`,
          });
        }
      });

      return this.pendingStartPromise;
    }

    // Desktop browser without WebXR headset hardware -> toggle simulated VR preview dome
    this.state = 'simulated-vr';
    this.setVRVisualsActive(true);
    return {
      state: 'simulated-vr',
      supported: false,
      message:
        'Immersive VR Preview active (no hardware WebXR headset detected on desktop).',
    };
  }

  async exitVR(): Promise<void> {
    const mgr = this.attachedCore?.webXRSessionManager;
    if (mgr?.currentSession) {
      try {
        await mgr.endSession();
      } catch {
        // Ignore already-ended sessions
      }
    }
    this.state = 'idle';
    this.setVRVisualsActive(false);
  }

  setVRVisualsActive(active: boolean): void {
    this.vrEnvironmentGroup.visible = active;
    this.controllersGroup.visible = active;
  }

  update(elapsed: number): void {
    if (!this.vrEnvironmentGroup.visible) return;
    this.starRingMesh.rotation.z = elapsed * 0.15;
    for (let i = 0; i < this.arcMeshes.length; i++) {
      this.arcMeshes[i].rotation.y =
        (i - 1) * 0.42 + Math.sin(elapsed * 0.4 + i) * 0.08;
    }
  }

  dispose(): void {
    void this.exitVR();
    this.detachFromCore();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
