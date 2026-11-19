import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import {MotionBricksEngine} from '../MotionBricksEngine';
import {
  DEFAULT_CONTACT_CONTRACTS,
  PropContactSurfaceLocal,
  WorldPoseTransform,
} from './ContactContract';
import {SomaRuntimeData} from './mbRuntime';
import {ArdyRuntimeData} from './SmartPrimitives';

const ROOT_DIR = process.cwd();
const SOMA_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/soma_runtime.json'), 'utf8')
) as SomaRuntimeData;
const ARDY_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/ardy_runtime.json'), 'utf8')
) as ArdyRuntimeData;

function createMockScaledVrm(anchor: THREE.Group, scale: number) {
  const scene = new THREE.Group();
  scene.scale.setScalar(scale);
  const bones = new Map<string, THREE.Object3D>();
  const addBone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Object3D();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    bones.set(name, b);
    return b;
  };

  const hips = addBone('hips', scene, 0, 0.86, 0);
  const spine = addBone('spine', hips, 0, 0.12, 0);
  const chest = addBone('chest', spine, 0, 0.14, 0);
  const upperChest = addBone('upperChest', chest, 0, 0.12, 0);
  const neck = addBone('neck', upperChest, 0, 0.1, 0);
  addBone('head', neck, 0, 0.08, 0);

  const lShoulder = addBone('leftShoulder', upperChest, 0.06, 0, 0);
  const lUpperArm = addBone('leftUpperArm', lShoulder, 0.08, 0, 0);
  const lLowerArm = addBone('leftLowerArm', lUpperArm, 0.24, 0, 0);
  addBone('leftHand', lLowerArm, 0.23, 0, 0);

  const rShoulder = addBone('rightShoulder', upperChest, -0.06, 0, 0);
  const rUpperArm = addBone('rightUpperArm', rShoulder, -0.08, 0, 0);
  const rLowerArm = addBone('rightLowerArm', rUpperArm, -0.24, 0, 0);
  addBone('rightHand', rLowerArm, -0.23, 0, 0);

  const lUpperLeg = addBone('leftUpperLeg', hips, 0.09, -0.04, 0);
  const lLowerLeg = addBone('leftLowerLeg', lUpperLeg, 0, -0.38, 0);
  const lFoot = addBone('leftFoot', lLowerLeg, 0, -0.37, 0);
  addBone('leftToes', lFoot, 0, -0.04, 0.1);

  const rUpperLeg = addBone('rightUpperLeg', hips, -0.09, -0.04, 0);
  const rLowerLeg = addBone('rightLowerLeg', rUpperLeg, 0, -0.38, 0);
  const rFoot = addBone('rightFoot', rLowerLeg, 0, -0.37, 0);
  addBone('rightToes', rFoot, 0, -0.04, 0.1);

  anchor.add(scene);
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (n: string) => bones.get(n) ?? null,
      getRawBoneNode: (n: string) => bones.get(n) ?? null,
    },
  };
}

const CHAIR_LOCAL_SURFACE: PropContactSurfaceLocal = {
  shape: 'box',
  localCenter: [0, 0.44, 0],
  localHalfExtents: [0.22, 0.03, 0.22],
  localNormal: [0, 1, 0],
  localApproachDir: [1, 0, 0],
  localFacingDir: [-1, 0, 0],
  approachStandOff: 0.42,
};

const BALL_LOCAL_SURFACE: PropContactSurfaceLocal = {
  shape: 'sphere',
  localCenter: [0, 0, 0],
  localHalfExtents: [0.14, 0.14, 0.14],
  localNormal: [0, 0, 1],
  localApproachDir: [0, 0, -1],
  localFacingDir: [0, 0, 1],
  approachStandOff: 0.42,
};

test('Contact invariance: prop translation, height shift, and Y rotation resolve and verify via same executor using body underside below Hips', () => {
  const configs = [
    {label: 'default', pos: new THREE.Vector3(-0.62, 0, -1.4), rotY: 0},
    {label: 'moved+raised+rotated', pos: new THREE.Vector3(1.8, 0.08, -0.4), rotY: 1.15},
  ];

  for (const cfg of configs) {
    const engine = new MotionBricksEngine(false);
    engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
    engine.setObstacles([], null);
    const anchor = new THREE.Group();
    const vrm = createMockScaledVrm(anchor, 1.0);
    engine.setVRM(vrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

    const chair = new THREE.Group();
    chair.position.copy(cfg.pos);
    chair.rotation.y = cfg.rotY;
    chair.updateMatrixWorld(true);

    // Start within 0.9m of chair
    engine.rootPosition.set(cfg.pos.x + 0.55, 0, cfg.pos.z + 0.35);

    let verified = 0;
    engine.executeCommand({
      propId: 'desk_chair',
      pose: 'sit_desk',
      surfaceObject: chair,
      contactSurface: CHAIR_LOCAL_SURFACE,
      contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
      onContactVerified: () => {
        verified++;
      },
    });

    for (let i = 0; i < 240; i++) {
      engine.update(1 / 60, (i + 1) / 60, anchor);
    }

    const audit = engine.getContactAudit();
    const profile = engine.getBodyProfile();
    assert.equal(verified, 1, `[${cfg.label}] expected verified sit contact once`);
    assert.equal(audit.status, 'sustained_contact', `[${cfg.label}] expected sustained_contact`);
    assert.equal(audit.verification?.valid, true, `[${cfg.label}] expected valid verification`);
    assert.ok(
      (audit.verification?.gapMeters ?? 99) <= DEFAULT_CONTACT_CONTRACTS.desk_chair.maxDistance,
      `[${cfg.label}] gapMeters=${audit.verification?.gapMeters}`
    );
    assert.ok(audit.bodyRegion?.hipsOriginWorld, `[${cfg.label}] must record Hips origin`);
    const undersideDrop =
      audit.bodyRegion!.hipsOriginWorld!.y - audit.bodyRegion!.center.y;
    assert.ok(
      undersideDrop >= profile.seatedSupportOffsetBelowHips - 0.02,
      `[${cfg.label}] support patch must sit below Hips origin (drop=${undersideDrop}, expected>=${profile.seatedSupportOffsetBelowHips - 0.02})`
    );
  }
});

test('Avatar body scale invariance: 0.78x, 1.0x, and 1.28x scaled VRM rigs all achieve valid seated support contact', () => {
  const scales = [0.78, 1.0, 1.28];
  const measuredDrops: number[] = [];

  for (const scale of scales) {
    const engine = new MotionBricksEngine(false);
    engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
    engine.setObstacles([], null);
    const anchor = new THREE.Group();
    const vrm = createMockScaledVrm(anchor, scale);
    engine.setVRM(vrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

    const profile = engine.getBodyProfile();
    measuredDrops.push(profile.seatedSupportOffsetBelowHips);

    const chair = new THREE.Group();
    chair.position.set(0.2, 0, -1.2);
    chair.updateMatrixWorld(true);
    engine.rootPosition.set(0.65, 0, -1.2);

    let verified = 0;
    engine.executeCommand({
      propId: 'desk_chair',
      pose: 'sit_desk',
      surfaceObject: chair,
      contactSurface: CHAIR_LOCAL_SURFACE,
      contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
      onContactVerified: () => {
        verified++;
      },
    });

    for (let i = 0; i < 240; i++) {
      engine.update(1 / 60, (i + 1) / 60, anchor);
    }

    const audit = engine.getContactAudit();
    assert.equal(verified, 1, `scale=${scale}: expected sit verification`);
    assert.equal(audit.status, 'sustained_contact', `scale=${scale}: expected sustained_contact`);
    assert.equal(audit.verification?.valid, true, `scale=${scale}: verification must pass`);
  }

  // Larger scale avatars must have strictly larger seatedSupportOffsetBelowHips
  assert.ok(
    measuredDrops[0] < measuredDrops[1] && measuredDrops[1] < measuredDrops[2],
    `Expected strictly increasing underside offsets with avatar scale, got ${measuredDrops.join(', ')}`
  );
});

test('Unreachable target fails cleanly without entering success state or firing onContactVerified', () => {
  for (const scenario of [
    {label: 'too-high-seat', y: 1.45, rotZ: 0, expectedReason: 'unreachable'},
    {
      label: 'steeply-tilted-seat',
      y: 0,
      rotZ: THREE.MathUtils.degToRad(65),
      expectedReason: 'normal_misaligned',
    },
  ]) {
    const engine = new MotionBricksEngine(false);
    engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
    engine.setObstacles([], null);
    const anchor = new THREE.Group();
    const vrm = createMockScaledVrm(anchor, 1.0);
    engine.setVRM(vrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

    const chair = new THREE.Group();
    chair.position.set(0.2, scenario.y, -1.2);
    chair.rotation.z = scenario.rotZ;
    chair.updateMatrixWorld(true);

    let verified = 0;
    let failedReason: string | null = null;
    const result = engine.executeCommand({
      propId: 'desk_chair',
      pose: 'sit_desk',
      surfaceObject: chair,
      contactSurface: CHAIR_LOCAL_SURFACE,
      contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
      onContactVerified: () => {
        verified++;
      },
      onFailed: (reason) => {
        failedReason = reason;
      },
    });

    assert.equal(result.accepted, false, `[${scenario.label}] unreachable target must be rejected`);
    assert.equal(
      result.reason,
      scenario.expectedReason,
      `[${scenario.label}] returned reason must be ${scenario.expectedReason}`
    );
    assert.equal(verified, 0, `[${scenario.label}] must never fire onContactVerified`);
    assert.equal(
      failedReason,
      scenario.expectedReason,
      `[${scenario.label}] failure reason must be ${scenario.expectedReason}`
    );
    assert.equal(engine.pose, 'idle', `[${scenario.label}] avatar must remain idle`);
    assert.equal(engine.getContactAudit().status, 'failed');
  }
});

test('Dynamic prop moved away mid-kick never triggers contact verification or prop impulse', () => {
  const engine = new MotionBricksEngine(false);
  engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
  engine.setObstacles([], null);
  const anchor = new THREE.Group();
  const vrm = createMockScaledVrm(anchor, 1.0);
  engine.setVRM(vrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

  const ball = new THREE.Group();
  const dynamicBallPos = new THREE.Vector3(0.1, 0.14, -1.1);
  ball.position.copy(dynamicBallPos);
  ball.updateMatrixWorld(true);

  const colliderPoseProvider = (): WorldPoseTransform => ({
    position: {x: dynamicBallPos.x, y: dynamicBallPos.y, z: dynamicBallPos.z},
    quaternion: {x: 0, y: 0, z: 0, w: 1},
  });

  engine.rootPosition.set(0.1, 0, -1.52);

  let verified = 0;
  let failed = 0;
  engine.executeCommand({
    propId: 'toy_ball',
    pose: 'kick_ball',
    surfaceObject: ball,
    contactSurface: BALL_LOCAL_SURFACE,
    contract: {...DEFAULT_CONTACT_CONTRACTS.toy_ball, maxReplans: 0},
    colliderPoseProvider,
    onContactVerified: () => {
      verified++;
    },
    onFailed: () => {
      failed++;
    },
  });

  let shifted = false;
  for (let i = 0; i < 240; i++) {
    // Once kick execution begins, teleport ball 1.2m away so foot swings through empty air
    if (!shifted && engine.getContactAudit().status === 'executing') {
      dynamicBallPos.set(1.4, 0.14, -0.4);
      ball.position.copy(dynamicBallPos);
      ball.updateMatrixWorld(true);
      shifted = true;
    }
    engine.update(1 / 60, (i + 1) / 60, anchor);
  }

  assert.equal(shifted, true, 'Test must have entered executing phase before shifting ball');
  assert.equal(verified, 0, 'Missed kick must NEVER trigger onContactVerified');
  assert.ok(failed >= 1, 'Missed kick must trigger onFailed');
  assert.equal(engine.getContactAudit().status, 'failed');
});

test('Sustained seat contact detects contact loss when chair moves away after sitting', () => {
  const engine = new MotionBricksEngine(false);
  engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
  engine.setObstacles([], null);
  const anchor = new THREE.Group();
  const vrm = createMockScaledVrm(anchor, 1.0);
  engine.setVRM(vrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

  const chair = new THREE.Group();
  chair.position.set(0.0, 0, -1.2);
  chair.updateMatrixWorld(true);
  engine.rootPosition.set(0.42, 0, -1.2);

  let verified = 0;
  let lost = 0;
  engine.executeCommand({
    propId: 'desk_chair',
    pose: 'sit_desk',
    surfaceObject: chair,
    contactSurface: CHAIR_LOCAL_SURFACE,
    contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
    onContactVerified: () => {
      verified++;
    },
    onContactLost: () => {
      lost++;
    },
  });

  for (let i = 0; i < 200; i++) {
    engine.update(1 / 60, (i + 1) / 60, anchor);
  }
  assert.equal(verified, 1);
  assert.equal(engine.getContactAudit().status, 'sustained_contact');

  // Pull the chair out from underneath the seated avatar
  chair.position.set(0.95, 0, -1.2);
  chair.updateMatrixWorld(true);
  for (let i = 0; i < 10; i++) {
    engine.update(1 / 60, (201 + i) / 60, anchor);
  }

  assert.equal(lost, 1, 'Expected onContactLost to fire when chair moves away');
  assert.equal(engine.pose, 'idle', 'Avatar must leave sit state when support is lost');
  const audit = engine.getContactAudit();
  assert.equal(audit.status, 'failed');
  assert.equal(audit.failureReason, 'contact_lost');
});

test('Frame source honesty: reports motionbricks_soma with SOMA runtime and fallback_procedural without SOMA', () => {
  const chair = new THREE.Group();
  chair.position.set(0, 0, -1.2);
  chair.updateMatrixWorld(true);

  // 1) With SOMA runtime
  const somaEngine = new MotionBricksEngine(false);
  somaEngine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
  somaEngine.setObstacles([], null);
  const anchorA = new THREE.Group();
  somaEngine.setVRM(
    createMockScaledVrm(anchorA, 1.0) as unknown as Parameters<MotionBricksEngine['setVRM']>[0]
  );
  somaEngine.rootPosition.set(0.4, 0, -1.2);
  somaEngine.executeCommand({
    propId: 'desk_chair',
    pose: 'sit_desk',
    surfaceObject: chair,
    contactSurface: CHAIR_LOCAL_SURFACE,
    contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
  });
  for (let i = 0; i < 180; i++) somaEngine.update(1 / 60, (i + 1) / 60, anchorA);
  assert.equal(somaEngine.getContactAudit().frameSource, 'motionbricks_soma');

  // 2) Without SOMA runtime
  const fallbackEngine = new MotionBricksEngine(false);
  fallbackEngine.setObstacles([], null);
  const anchorB = new THREE.Group();
  fallbackEngine.setVRM(
    createMockScaledVrm(anchorB, 1.0) as unknown as Parameters<MotionBricksEngine['setVRM']>[0]
  );
  fallbackEngine.rootPosition.set(0.4, 0, -1.2);
  fallbackEngine.executeCommand({
    propId: 'desk_chair',
    pose: 'sit_desk',
    surfaceObject: chair,
    contactSurface: CHAIR_LOCAL_SURFACE,
    contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
  });
  for (let i = 0; i < 180; i++) fallbackEngine.update(1 / 60, (i + 1) / 60, anchorB);
  assert.equal(fallbackEngine.getContactAudit().frameSource, 'fallback_procedural');
});
