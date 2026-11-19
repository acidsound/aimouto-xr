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

const ROOT_DIR = process.cwd();
const SOMA_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/soma_runtime.json'), 'utf8')
) as SomaRuntimeData;
const ARDY_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'public/motionbricks/ardy_runtime.json'), 'utf8')
) as ArdyRuntimeData;

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

test('MotionBricksEngine executes ardy_sit on desk_chair and contact-timed kick action on toy_ball', () => {
  const engine = new MotionBricksEngine(false);
  engine.loadRuntimeData(SOMA_DATA, ARDY_DATA);
  assert.equal(engine.hasSomaRuntime, true);

  // Enqueue desk chair right at its approach spot -> activates ardy_sit ToSit immediately
  engine.rootPosition.set(-0.65, 0, -2.02);
  engine.enqueueCommand({
    propId: 'desk_chair',
    pose: 'sit_desk',
    approachPos: new THREE.Vector3(-0.65, 0, -2.02),
    approachYaw: -Math.PI / 2,
  });

  const anchor = new THREE.Group();
  engine.update(0.016, 0.016, anchor);
  assert.equal(engine.pose, 'sit_desk');
  assert.equal(engine.activeSomaSequenceNode, 'ToSit');

  // Execute kick action against toy_ball near the avatar -> must stand first via ToStand, then kick and fire onContact
  let contactCount = 0;
  let completedCount = 0;
  engine.executePropAction({
    propId: 'toy_ball',
    pose: 'kick_ball',
    actionName: 'kick',
    propWorldPos: new THREE.Vector3(-0.62, 0.14, -1.75),
    onContact: () => {
      contactCount++;
    },
    onComplete: () => {
      completedCount++;
    },
  });

  // Should transition via Stand first since avatar was seated!
  assert.equal(engine.activeSomaSequenceNode, 'ToStand');

  // Step time forward ~6 seconds to complete stand -> walk -> kick + follow
  for (let i = 0; i < 360; i++) {
    engine.update(1 / 60, (i + 1) / 60, anchor);
  }

  assert.equal(contactCount, 1, 'Expected kick onContact callback to fire exactly once');
  assert.equal(completedCount, 1, 'Expected kick sequence to complete cleanly');
  assert.equal(engine.pose, 'idle');
});
