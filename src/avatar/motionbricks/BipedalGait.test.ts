import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGaitPhase,
  computeBipedalGait,
  DEFAULT_STRIDE_LENGTH_M,
} from './BipedalGait';

test('computeBipedalGait alternates left and right thighs symmetrically across full stride', () => {
  // Phase 0: Left heel strike (forward, negative rx), Right toe-off (backward, positive rx)
  const atLeftForward = computeBipedalGait(0, 1);
  assert.ok(
    atLeftForward.leftUpperLegX < -0.35,
    `Left thigh should swing forward (< -0.35), got ${atLeftForward.leftUpperLegX}`
  );
  assert.ok(
    atLeftForward.rightUpperLegX > 0.3,
    `Right thigh should extend backward (> 0.3), got ${atLeftForward.rightUpperLegX}`
  );

  // Phase PI: Right heel strike (forward, negative rx), Left toe-off (backward, positive rx)
  const atRightForward = computeBipedalGait(Math.PI, 1);
  assert.ok(
    atRightForward.rightUpperLegX < -0.35,
    `Right thigh should swing forward (< -0.35), got ${atRightForward.rightUpperLegX}`
  );
  assert.ok(
    atRightForward.leftUpperLegX > 0.3,
    `Left thigh should extend backward (> 0.3), got ${atRightForward.leftUpperLegX}`
  );

  // Exact symmetry between half-cycles
  assert.ok(
    Math.abs(atLeftForward.leftUpperLegX - atRightForward.rightUpperLegX) < 1e-6
  );
  assert.ok(
    Math.abs(atLeftForward.rightUpperLegX - atRightForward.leftUpperLegX) < 1e-6
  );
});

test('computeBipedalGait bends swinging knee cleanly higher than stance knee', () => {
  // At phase = 3*PI/2 - 0.24: Left leg is at peak mid-swing, Right leg is in mid-stance
  const leftSwing = computeBipedalGait(Math.PI * 1.5 - 0.24, 1);
  assert.ok(
    leftSwing.leftLowerLegX > 0.75,
    `Swinging left knee should bend strongly (> 0.75 rad), got ${leftSwing.leftLowerLegX}`
  );
  assert.ok(
    leftSwing.leftLowerLegX > leftSwing.rightLowerLegX + 0.5,
    `Swinging left knee (${leftSwing.leftLowerLegX}) must clear much higher than stance right knee (${leftSwing.rightLowerLegX})`
  );

  // At phase = PI/2 - 0.24: Right leg is at peak mid-swing, Left leg is in mid-stance
  const rightSwing = computeBipedalGait(Math.PI * 0.5 - 0.24, 1);
  assert.ok(
    rightSwing.rightLowerLegX > 0.75,
    `Swinging right knee should bend strongly (> 0.75 rad), got ${rightSwing.rightLowerLegX}`
  );
  assert.ok(
    rightSwing.rightLowerLegX > rightSwing.leftLowerLegX + 0.5,
    `Swinging right knee (${rightSwing.rightLowerLegX}) must clear much higher than stance left knee (${rightSwing.leftLowerLegX})`
  );
});

test('computeBipedalGait counter-swings arms and torso opposite to stepping leg', () => {
  const atLeftForward = computeBipedalGait(0, 1);
  // Left leg forward (< 0) => Right arm forward (< 0) and Left arm back (> 0)
  assert.ok(atLeftForward.rightUpperArmX < -0.3);
  assert.ok(atLeftForward.leftUpperArmX > 0.3);
  // Hips and spine counter-rotate
  assert.ok(atLeftForward.hipsYaw * atLeftForward.spineYaw < 0);
});

test('computeBipedalGait returns zeroed pose when walkFactor is 0', () => {
  const idle = computeBipedalGait(1.23, 0);
  for (const val of Object.values(idle)) {
    assert.equal(val, 0);
  }
});

test('advanceGaitPhase advances one full 2*PI cycle per stride length traveled', () => {
  const phase = advanceGaitPhase(0, DEFAULT_STRIDE_LENGTH_M, 0.5);
  assert.ok(Math.abs(phase - Math.PI) < 1e-6, `Expected PI rad after half stride, got ${phase}`);
  assert.equal(advanceGaitPhase(1.2, 0.01, 0.1), 1.2);
});
