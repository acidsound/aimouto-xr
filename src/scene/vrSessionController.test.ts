import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  checkImmersiveVRSupport,
  ImmersiveVRController,
  WebXRSessionEventLike,
  WebXRSessionManagerLike,
  XRCoreLike,
} from './vrSessionController';

class MockWebXRSession {
  ended = false;
  endCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, cb: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  async end(): Promise<void> {
    this.endCalls++;
    if (this.ended) return;
    this.ended = true;
    for (const cb of Array.from(this.listeners.get('end') ?? [])) {
      cb();
    }
  }
}

/**
 * Faithful mock of XR Blocks v0.24.0 WebXRSessionManager (single session authority,
 * closes session on renderer.xr.setSession failure, dispatches SDK lifecycle events).
 */
class MockSDKWebXRSessionManager implements WebXRSessionManagerLike {
  currentSession?: XRSession;
  waitingForXRSession = false;
  requestSessionCalls = 0;
  private listeners = new Map<string, Set<(e: WebXRSessionEventLike) => void>>();

  constructor(
    private readonly supported: boolean,
    private readonly onRequestSession: () => Promise<MockWebXRSession>,
    private readonly onSetSession: (session: MockWebXRSession) => Promise<void>
  ) {}

  isXRSupported(): boolean {
    return this.supported;
  }

  addEventListener(
    type: string,
    listener: (e: WebXRSessionEventLike) => void
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: string,
    listener: (e: WebXRSessionEventLike) => void
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  private dispatch(event: WebXRSessionEventLike): void {
    for (const cb of Array.from(this.listeners.get(event.type) ?? [])) {
      cb(event);
    }
  }

  startSession(): void {
    if (!this.supported) throw new Error('WebXR not supported');
    if (this.currentSession) throw new Error('Session already started');
    if (this.waitingForXRSession) throw new Error('Waiting for session to start');
    this.waitingForXRSession = true;
    this.requestSessionCalls++;

    this.onRequestSession()
      .then(async (session) => {
        const onEnd = () => {
          session.removeEventListener('end', onEnd);
          this.currentSession = undefined;
          this.dispatch({type: 'sessionend'});
        };
        session.addEventListener('end', onEnd);
        try {
          this.dispatch({
            type: 'beforesessionstart',
            session: session as unknown as XRSession,
          });
          await this.onSetSession(session);
        } catch (err) {
          session.removeEventListener('end', onEnd);
          await session.end();
          throw err;
        }
        this.currentSession = session as unknown as XRSession;
        this.dispatch({
          type: 'sessionstart',
          session: session as unknown as XRSession,
        });
      })
      .finally(() => {
        this.waitingForXRSession = false;
      })
      .catch((error) => {
        this.dispatch({type: 'sessionerror', error});
      });
  }

  async endSession(): Promise<void> {
    const session = this.currentSession as unknown as MockWebXRSession | undefined;
    if (!session) throw new Error('No session to end');
    await session.end();
  }
}

test('checkImmersiveVRSupport returns true when navigator.xr supports immersive-vr', async () => {
  const supported = await checkImmersiveVRSupport({
    isSessionSupported: async (mode) => mode === 'immersive-vr',
  });
  assert.equal(supported, true);
});

test('checkImmersiveVRSupport returns false when navigator.xr is missing or throws', async () => {
  assert.equal(await checkImmersiveVRSupport(undefined), false);
  assert.equal(
    await checkImmersiveVRSupport({
      isSessionSupported: async () => {
        throw new Error('Not allowed');
      },
    }),
    false
  );
});

test('Web Browse -> Enter VR bypasses simulator compositor, preserves XR render target, and restores on exit + re-entry', async () => {
  const xrCamera = new THREE.PerspectiveCamera();
  const simCamera = new THREE.PerspectiveCamera();
  const xrRenderTarget = {id: 'quest-xr-framebuffer'};

  let currentRenderTarget: unknown = null;
  let setRenderTargetNullCalls = 0;
  let simulatorUpdateCalls = 0;
  let simulatorRenderFrameCalls = 0;
  const renderedTargets: unknown[] = [];

  const mockRenderer = {
    xr: {isPresenting: false},
    setRenderTarget(target: unknown) {
      currentRenderTarget = target;
      if (target === null) setRenderTargetNullCalls++;
    },
  };

  let activeSession: MockWebXRSession | null = null;
  const sessionManager = new MockSDKWebXRSessionManager(
    true,
    async () => {
      activeSession = new MockWebXRSession();
      activeSession.addEventListener('end', () => {
        mockRenderer.xr.isPresenting = false;
      });
      return activeSession;
    },
    async () => {
      mockRenderer.xr.isPresenting = true;
    }
  );

  const core: XRCoreLike = {
    renderer: mockRenderer,
    camera: xrCamera,
    simulatorRunning: true,
    lighting: {simulatorRunning: true},
    webXRSessionManager: sessionManager,
    renderScene() {
      renderedTargets.push(currentRenderTarget);
    },
    simulator: {
      simulatorUpdate() {
        simulatorUpdateCalls++;
      },
      getRenderCamera() {
        return simCamera;
      },
      renderFrame() {
        // Reproduces BaseSimulatorCompositor.ts + WebGLDirectCompositor.ts:
        // unbinds XR target via setRenderTarget(null) before rendering main scene!
        simulatorRenderFrameCalls++;
        mockRenderer.setRenderTarget(null);
        core.renderScene?.();
      },
    },
    renderSimulatorAndScene() {
      if (core.simulatorRunning && core.simulator) {
        core.simulator.renderFrame?.();
      } else {
        core.renderScene?.();
      }
    },
    getFrameCamera() {
      if (!core.simulatorRunning || !core.simulator) return xrCamera;
      return core.simulator.getRenderCamera?.() ?? xrCamera;
    },
  };

  const controller = new ImmersiveVRController();
  controller.attachToCore(core);
  controller.onSimulatorStarted(core);

  // 1. Before entering XR, web browse uses simulator camera and compositor normally
  assert.equal(core.getFrameCamera?.(), simCamera);
  core.simulator?.simulatorUpdate?.();
  core.renderSimulatorAndScene?.();
  assert.equal(simulatorUpdateCalls, 1);
  assert.equal(simulatorRenderFrameCalls, 1);
  assert.equal(renderedTargets[0], null);

  // 2. Enter VR from Web Browse via unified HUD toggle
  const enterStatus = await controller.toggleVRFromHud(core);
  assert.equal(enterStatus.state, 'immersive-vr');
  assert.equal(sessionManager.requestSessionCalls, 1);
  assert.equal(core.simulatorRunning, false);
  assert.equal(core.lighting?.simulatorRunning, false);

  // 3. First valid XR frame: Three.js binds the headset XR framebuffer before Core.update
  setRenderTargetNullCalls = 0;
  currentRenderTarget = xrRenderTarget;
  core.simulator?.simulatorUpdate?.();
  assert.equal(core.getFrameCamera?.(), xrCamera);
  core.renderSimulatorAndScene?.();

  assert.equal(
    simulatorUpdateCalls,
    1,
    'Simulator update must be skipped while presenting WebXR'
  );
  assert.equal(
    simulatorRenderFrameCalls,
    1,
    'Simulator compositor must NOT run while presenting WebXR'
  );
  assert.equal(
    setRenderTargetNullCalls,
    0,
    'setRenderTarget(null) must NEVER be called while presenting WebXR'
  );
  assert.equal(
    renderedTargets[1],
    xrRenderTarget,
    'Main scene must render directly into Three.js bound XR render target'
  );

  // Even if something externally flipped simulatorRunning=true while presenting,
  // the renderSimulatorAndScene guard must still protect the XR framebuffer!
  core.simulatorRunning = true;
  currentRenderTarget = xrRenderTarget;
  core.renderSimulatorAndScene?.();
  assert.equal(setRenderTargetNullCalls, 0);
  assert.equal(renderedTargets[2], xrRenderTarget);
  assert.equal(core.simulatorRunning, false);

  // 4. Exit VR -> web browse simulator must be cleanly restored
  await activeSession!.end();
  assert.equal(controller.currentState, 'idle');
  assert.equal(core.simulatorRunning, true);
  assert.equal(core.lighting?.simulatorRunning, true);

  currentRenderTarget = null;
  core.simulator?.simulatorUpdate?.();
  assert.equal(core.getFrameCamera?.(), simCamera);
  core.renderSimulatorAndScene?.();
  assert.equal(simulatorUpdateCalls, 2);
  assert.equal(simulatorRenderFrameCalls, 2);

  // 5. Re-enter VR a second time -> works cleanly and preserves XR target again
  const reEnterStatus = await controller.toggleVRFromHud(core);
  assert.equal(reEnterStatus.state, 'immersive-vr');
  assert.equal(sessionManager.requestSessionCalls, 2);
  assert.equal(core.simulatorRunning, false);
  currentRenderTarget = xrRenderTarget;
  setRenderTargetNullCalls = 0;
  core.renderSimulatorAndScene?.();
  assert.equal(setRenderTargetNullCalls, 0);
  assert.equal(renderedTargets[renderedTargets.length - 1], xrRenderTarget);

  controller.dispose();
});

test('Enter VR calls requestSession exactly once per attempt and cleans up leaked session on setSession error', async () => {
  const createdSessions: MockWebXRSession[] = [];
  const mockRenderer = {xr: {isPresenting: false}};

  const sessionManager = new MockSDKWebXRSessionManager(
    true,
    async () => {
      const s = new MockWebXRSession();
      createdSessions.push(s);
      return s;
    },
    async () => {
      throw new Error('XRWebGLLayer creation failed');
    }
  );

  const core: XRCoreLike = {
    renderer: mockRenderer,
    simulatorRunning: true,
    lighting: {simulatorRunning: true},
    webXRSessionManager: sessionManager,
  };

  const controller = new ImmersiveVRController();
  controller.attachToCore(core);

  // Concurrent double-invocation from rapid click must coalesce into 1 requestSession call
  const [res1, res2] = await Promise.all([
    controller.toggleVRFromHud(core),
    controller.toggleVRFromHud(core),
  ]);

  assert.equal(
    sessionManager.requestSessionCalls,
    1,
    'Clicking Enter VR must issue only a single requestSession call'
  );
  assert.equal(res1.state, 'idle');
  assert.equal(res1.error, true);
  assert.equal(res2.state, 'idle');
  assert.equal(createdSessions.length, 1);
  assert.equal(
    createdSessions[0].ended,
    true,
    'Session opened before setSession failure must be ended and never leaked'
  );
  assert.equal(createdSessions[0].endCalls, 1);
  assert.equal(
    core.simulatorRunning,
    true,
    'Web browse simulator must be restored if WebXR session fails to start'
  );
  assert.equal(controller.currentState, 'idle');

  controller.dispose();
});

test('Desktop without WebXR toggles simulated VR preview without calling requestSession', async () => {
  const sessionManager = new MockSDKWebXRSessionManager(
    false,
    async () => new MockWebXRSession(),
    async () => {}
  );

  const core: XRCoreLike = {
    simulatorRunning: true,
    webXRSessionManager: sessionManager,
  };

  const controller = new ImmersiveVRController();
  controller.attachToCore(core);

  const entered = await controller.toggleVRFromHud(core);
  assert.equal(entered.state, 'simulated-vr');
  assert.equal(entered.supported, false);
  assert.equal(sessionManager.requestSessionCalls, 0);

  const exited = await controller.toggleVRFromHud(core);
  assert.equal(exited.state, 'idle');
  assert.equal(sessionManager.requestSessionCalls, 0);

  controller.dispose();
});
