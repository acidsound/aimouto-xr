import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  correctEndpoints,
  decodeSomaFrames,
  encodeSomaFrames,
  MB_FEAT,
  MotionRecorder,
  placeTarget,
  SomaRuntimeData,
  SomaSkeleton,
  synthesizeSomaticTransition,
} from './motionbricks/mbRuntime';
import {
  ArdyRuntimeData,
  buildSitPrimitive,
  placeArdyAction,
} from './motionbricks/SmartPrimitives';
import {MotionBricksEngine} from './MotionBricksEngine';
import {
  DEFAULT_CONTACT_CONTRACTS,
  PropContactSurfaceLocal,
} from './motionbricks/ContactContract';

const ROOT_DIR = process.cwd();
const SOMA_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/soma_runtime.json'), 'utf8')
) as SomaRuntimeData;
const ARDY_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/ardy_runtime.json'), 'utf8')
) as ArdyRuntimeData;

function createHierarchicalMockVrm(anchor: THREE.Group, scale = 1) {
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

test('SomaSkeleton loads 77 joints and computes forward kinematics', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  assert.equal(sk.numJoints, 77);
  assert.equal(sk.jointNames[0], 'Hips');
  assert.ok(sk.styles.has('idle'));
  assert.ok(sk.styles.has('walk'));

  const fk = sk.fk(sk.reference);
  assert.equal(fk.wp.length, 77);
  assert.equal(fk.wq.length, 77);
  assert.ok(fk.wp[0][1] > 0.8 && fk.wp[0][1] < 1.3, `Unexpected Hips Y=${fk.wp[0][1]}`);
  // Head must be higher than Hips
  const headIdx = sk.jointNames.indexOf('Head');
  assert.ok(headIdx > 0);
  assert.ok(fk.wp[headIdx][1] > fk.wp[0][1]);
});

test('MotionRecorder maintains circular capacity and lastN padding', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  const rec = new MotionRecorder(5);
  assert.equal(rec.latest(), null);

  rec.record(sk.reference);
  const padded = rec.lastN(4);
  assert.equal(padded.length, 4);

  for (let i = 0; i < 10; i++) {
    rec.record(sk.reference);
  }
  assert.equal(rec.frames.length, 5);
});

test('encodeSomaFrames and decodeSomaFrames preserve 366-dim features and root translation', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  const idle = sk.styles.get('idle')!;
  const encoded = encodeSomaFrames(idle.window);
  assert.equal(encoded.length, idle.window.length * MB_FEAT);

  const decoded = decodeSomaFrames(sk, encoded, idle.window[0]);
  assert.equal(decoded.length, idle.window.length);
  for (let t = 0; t < decoded.length; t++) {
    assert.ok(Math.abs(decoded[t][0][0] - idle.window[t][0][0]) < 1e-5);
    assert.ok(Math.abs(decoded[t][0][1] - idle.window[t][0][1]) < 1e-5);
    assert.ok(Math.abs(decoded[t][0][2] - idle.window[t][0][2]) < 1e-5);
  }
});

test('placeTarget anchors SOMA window cleanly to world pose & yaw', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  const sitPrim = ARDY_DATA.prims.find((p) => p.name === 'ardy_sit')!;
  const sitStep = sitPrim.sequences[0].steps[1];
  const placed = placeTarget(sk, sitStep.window, [-0.65, 0, -2.02], -Math.PI / 2);
  assert.equal(placed.length, sitStep.window.length);
  // Placed Hips X/Z should be near the chair anchor
  assert.ok(Math.abs(placed[0][0][0] - -0.65) < 0.75);
  assert.ok(Math.abs(placed[0][0][2] - -2.02) < 0.75);
});

test('correctEndpoints and synthesizeSomaticTransition blend smoothly from context to target', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  const idle = sk.styles.get('idle')!.window;
  const walk = sk.styles.get('walk')!.window;
  const traj = synthesizeSomaticTransition(sk, idle.slice(-4), walk, 24);
  assert.equal(traj.length, 24);
  // Corrected endpoints should pull frame 0 close to start and last frame close to target
  const corrected = correctEndpoints(traj, idle.slice(-4), walk);
  assert.equal(corrected.length, 24);
  assert.ok(Math.hypot(corrected[0][0][1] - idle[idle.length - 1][0][1]) < 0.15);
});

test('buildSitPrimitive plans authentic ardy_sit Sit (ToSit -> Sit) & Stand (ToStand)', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  const plan = buildSitPrimitive(sk, ARDY_DATA, [-0.65, 0, -2.02], -Math.PI / 2);
  assert.equal(plan.id, 'ardy_sit');
  assert.deepEqual(
    plan.sitSteps.map((s) => s.node),
    ['ToSit', 'Sit']
  );
  assert.deepEqual(
    plan.standSteps.map((s) => s.node),
    ['ToStand']
  );
  assert.ok(plan.sitSteps[1].holdLoop);
  assert.ok(plan.sitSteps[1].targetWindow[0][0][1] < 0.7, 'Sit must lower pelvis Y');
});

test('placeArdyAction places kick, pickup, and push with valid contact offsets and timing', () => {
  const sk = new SomaSkeleton(SOMA_DATA);
  for (const actionName of ['kick', 'pickup', 'push'] as const) {
    const plan = placeArdyAction(
      sk,
      ARDY_DATA,
      actionName,
      [0.32, 0.14, -1.05],
      [-0.08, 0, -1.28]
    );
    assert.equal(plan.actionName, actionName);
    assert.ok(plan.steps.length >= 1);
    assert.ok(plan.contactDelaySec > 0.2 && plan.contactDelaySec < 3.0);
    // Approach anchor should stay near prop without teleporting far away
    const dist = Math.hypot(plan.anchorWorld[0] - 0.32, plan.anchorWorld[2] - -1.05);
    assert.ok(dist < 1.2, `Action ${actionName} anchor distance ${dist} too large`);
  }
});

test('MotionBricksEngine executes ardy_sit on desk_chair and contact-verified kick action on toy_ball', () => {
  const engine = new MotionBricksEngine(false);
  engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
  assert.equal(engine.hasSomaRuntime, true);

  const anchor = new THREE.Group();
  const mockVrm = createHierarchicalMockVrm(anchor, 1.0);
  engine.setVRM(mockVrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

  const chairObj = new THREE.Group();
  chairObj.position.set(-0.65, 0, -2.02);
  chairObj.updateMatrixWorld(true);
  const chairSurface: PropContactSurfaceLocal = {
    shape: 'box',
    localCenter: [0, 0.44, 0],
    localHalfExtents: [0.22, 0.03, 0.22],
    localNormal: [0, 1, 0],
    localApproachDir: [1, 0, 0],
    localFacingDir: [-1, 0, 0],
    approachStandOff: 0.36,
  };

  // Start near chair approach spot -> activates ardy_sit ToSit immediately
  engine.rootPosition.set(-0.29, 0, -2.02);
  let sitVerified = 0;
  engine.executeCommand({
    propId: 'desk_chair',
    pose: 'sit_desk',
    surfaceObject: chairObj,
    contactSurface: chairSurface,
    contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
    onContactVerified: () => {
      sitVerified++;
    },
  });

  // Step through approach + ToSit -> Sit verified sustained contact
  let sawToSit = false;
  for (let i = 0; i < 180; i++) {
    engine.update(1 / 60, (i + 1) / 60, anchor);
    if (engine.activeSomaSequenceNode === 'ToSit') sawToSit = true;
  }
  assert.equal(sawToSit, true, 'Expected ardy_sit ToSit transition node');
  assert.equal(engine.pose, 'sit_desk');
  assert.equal(sitVerified, 1, 'Expected chair sit contact to be verified');
  assert.equal(engine.getContactAudit().status, 'sustained_contact');
  assert.equal(engine.getContactAudit().frameSource, 'motionbricks_soma');

  // Execute kick action against toy_ball near the avatar -> must stand first via ToStand, then kick and verify contact
  const ballObj = new THREE.Group();
  ballObj.position.set(-0.25, 0.14, -1.55);
  ballObj.updateMatrixWorld(true);
  const ballSurface: PropContactSurfaceLocal = {
    shape: 'sphere',
    localCenter: [0, 0, 0],
    localHalfExtents: [0.14, 0.14, 0.14],
    localNormal: [0, 0, 1],
    localApproachDir: [0, 0, -1],
    localFacingDir: [0, 0, 1],
    approachStandOff: 0.42,
  };

  let contactCount = 0;
  let completedCount = 0;
  engine.executeCommand({
    propId: 'toy_ball',
    pose: 'kick_ball',
    surfaceObject: ballObj,
    contactSurface: ballSurface,
    contract: DEFAULT_CONTACT_CONTRACTS.toy_ball,
    onContactVerified: () => {
      contactCount++;
    },
    onComplete: () => {
      completedCount++;
    },
  });

  // Should transition via Stand first since avatar was seated!
  assert.equal(engine.activeSomaSequenceNode, 'ToStand');

  // Step time forward ~7 seconds to complete stand -> walk -> kick + follow
  for (let i = 0; i < 420; i++) {
    engine.update(1 / 60, (181 + i) / 60, anchor);
  }

  assert.equal(contactCount, 1, 'Expected kick onContactVerified callback to fire exactly once');
  assert.equal(completedCount, 1, 'Expected kick sequence to complete cleanly');
  assert.equal(engine.pose, 'idle');
  assert.equal(engine.getContactAudit().frameSource, 'motionbricks_soma');
});

test('MotionBricksEngine alternates left and right legs (no single-foot sliding) when walking with SOMA runtime loaded', () => {
  const engine = new MotionBricksEngine(false);
  engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);

  // Create a minimal mock VRM humanoid with normalized bones to observe real bone rotations
  const boneMap = new Map<string, THREE.Object3D>();
  for (const name of [
    'hips',
    'spine',
    'chest',
    'leftUpperLeg',
    'rightUpperLeg',
    'leftLowerLeg',
    'rightLowerLeg',
    'leftFoot',
    'rightFoot',
    'leftUpperArm',
    'rightUpperArm',
    'leftLowerArm',
    'rightLowerArm',
  ]) {
    boneMap.set(name, new THREE.Object3D());
  }
  const mockVrm = {
    scene: new THREE.Group(),
    humanoid: {
      getNormalizedBoneNode: (n: string) => boneMap.get(n) ?? null,
    },
  };
  engine.setVRM(mockVrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

  engine.rootPosition.set(-1.1, 0, -1.2);
  engine.walkToFloor(1.1, -1.2, 0);

  const anchor = new THREE.Group();
  let minLeftX = Infinity;
  let maxLeftX = -Infinity;
  let minRightX = Infinity;
  let maxRightX = -Infinity;
  let oppositeSignFrames = 0;

  const eulerL = new THREE.Euler();
  const eulerR = new THREE.Euler();
  for (let i = 0; i < 120; i++) {
    engine.update(1 / 60, (i + 1) / 60, anchor);
    eulerL.setFromQuaternion(boneMap.get('leftUpperLeg')!.quaternion, 'XYZ');
    eulerR.setFromQuaternion(boneMap.get('rightUpperLeg')!.quaternion, 'XYZ');
    minLeftX = Math.min(minLeftX, eulerL.x);
    maxLeftX = Math.max(maxLeftX, eulerL.x);
    minRightX = Math.min(minRightX, eulerR.x);
    maxRightX = Math.max(maxRightX, eulerR.x);
    if (eulerL.x * eulerR.x < -0.02) {
      oppositeSignFrames++;
    }
  }

  // Both legs must sweep significantly forward (< -0.25) AND backward (> +0.20)
  assert.ok(minLeftX < -0.25 && maxLeftX > 0.2, `Left leg did not alternate: [${minLeftX}, ${maxLeftX}]`);
  assert.ok(minRightX < -0.25 && maxRightX > 0.2, `Right leg did not alternate: [${minRightX}, ${maxRightX}]`);
  assert.ok(oppositeSignFrames > 30, `Expected legs to cross in opposite directions, got ${oppositeSignFrames} frames`);
});
