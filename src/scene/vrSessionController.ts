import * as THREE from 'three';
import {XRControllerModelFactory} from 'three/addons/webxr/XRControllerModelFactory.js';

export type VRSessionState = 'idle' | 'immersive-vr' | 'simulated-vr';

export interface VRSessionStatus {
  state: VRSessionState;
  supported: boolean;
  message: string;
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
 * Builds the Three.js Immersive VR starlight cyber-concert environment
 * (360° horizon ring, concert sky dome, overhead neon light arcs, and WebXR
 * controller grips + target rays via XRControllerModelFactory).
 */
export class ImmersiveVRController {
  readonly vrEnvironmentGroup = new THREE.Group();
  readonly controllersGroup = new THREE.Group();

  private activeSession: XRSession | null = null;
  private state: VRSessionState = 'idle';
  private starRingMesh!: THREE.Mesh;
  private arcMeshes: THREE.Mesh[] = [];
  private controllersInitialized = false;
  private readonly disposables: Array<{dispose: () => void}> = [];

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
   * Attempts to initialize a real Three.js WebXR `immersive-vr` session via
   * `navigator.xr.requestSession` + `renderer.xr.setSession`, or enters the
   * immersive VR preview environment cleanly when desktop lacks XR hardware.
   */
  async enterImmersiveVR(
    renderer: THREE.WebGLRenderer | undefined,
    scene: THREE.Scene
  ): Promise<VRSessionStatus> {
    if (this.activeSession) {
      await this.exitVR(renderer);
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

    if (renderer) {
      this.initWebXRRig(renderer, scene);
    }

    const xrSystem = typeof navigator !== 'undefined' ? navigator.xr : undefined;
    const supported = await checkImmersiveVRSupport(xrSystem);

    if (supported && xrSystem && renderer?.xr) {
      try {
        const session = await xrSystem.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        this.activeSession = session;
        session.addEventListener('end', () => {
          this.activeSession = null;
          this.state = 'idle';
          this.setVRVisualsActive(false);
        });
        await renderer.xr.setSession(session);
        this.state = 'immersive-vr';
        this.setVRVisualsActive(true);
        return {
          state: 'immersive-vr',
          supported: true,
          message: 'Immersive VR WebXR session active (local-floor).',
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.state = 'simulated-vr';
        this.setVRVisualsActive(true);
        return {
          state: 'simulated-vr',
          supported: true,
          message: `VR Preview Dome active (WebXR session fallback: ${errMsg}).`,
        };
      }
    }

    // Fallback: Desktop browser without VR headset hardware -> activate VR Concert Dome + Spatial Cards
    this.state = 'simulated-vr';
    this.setVRVisualsActive(true);
    return {
      state: 'simulated-vr',
      supported: false,
      message: 'Immersive VR Preview active (no hardware WebXR headset detected on desktop).',
    };
  }

  async exitVR(renderer?: THREE.WebGLRenderer): Promise<void> {
    if (this.activeSession) {
      try {
        await this.activeSession.end();
      } catch {
        // Ignore already-ended sessions
      }
      this.activeSession = null;
    }
    if (renderer?.xr?.isPresenting) {
      try {
        await renderer.xr.setSession(null as unknown as XRSession);
      } catch {
        // Ignore
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
      this.arcMeshes[i].rotation.y = (i - 1) * 0.42 + Math.sin(elapsed * 0.4 + i) * 0.08;
    }
  }

  dispose(): void {
    void this.exitVR();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
