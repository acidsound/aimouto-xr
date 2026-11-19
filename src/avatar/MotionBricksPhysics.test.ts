import RAPIER from '@dimforge/rapier3d-simd-compat';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {RoomObstacle} from '../scene/LofiRoomEnvironment';
import {MotionBricksEngine} from './MotionBricksEngine';
import {MotionBricksPhysics} from './MotionBricksPhysics';

const ROOM_TEST_OBSTACLES: RoomObstacle[] = [
  {id: 'desk', minX: -1.52, maxX: -0.68, minZ: -1.96, maxZ: -0.78},
  {id: 'desk_chair', minX: -0.82, maxX: -0.34, minZ: -1.58, maxZ: -1.14},
  {id: 'nightstand', minX: 1.04, maxX: 1.54, minZ: -3.08, maxZ: -2.54},
  {id: 'bed', minX: 0.34, maxX: 1.54, minZ: -3.08, maxZ: -1.68},
];

test('MotionBricksPhysics initializes Rapier 46kg avatar grounded and executes real jump + landing compression', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({x: 0, y: -9.81, z: 0});
  const physics = new MotionBricksPhysics(RAPIER, world, ROOM_TEST_OBSTACLES);

  assert.equal(physics.state.weightKg, 46);
  assert.equal(physics.state.grounded, true);
  assert.ok(Math.abs(physics.state.footY) < 0.02);

  // Trigger upward jump impulse and step Rapier simulation
  const started = physics.triggerJump();
  assert.equal(started, true);

  let maxFootY = 0;
  let minCompressionY = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) {
    world.timestep = dt;
    world.step();
    const state = physics.step(dt, {
      desiredVx: 0,
      desiredVz: 0,
      yaw: 0,
      seated: false,
      ignoreObstacleId: null,
      leftHandWorld: {x: 0.15, y: 0.9, z: -1.2},
      rightHandWorld: {x: -0.3, y: 0.9, z: -1.2},
    });
    if (state.footY > maxFootY) maxFootY = state.footY;
    if (state.compressionY < minCompressionY) minCompressionY = state.compressionY;
  }

  assert.ok(maxFootY > 0.25, `Expected jump arc > 0.25m, got ${maxFootY}`);
  assert.equal(physics.state.grounded, true, 'Gravity must return 46kg avatar to floor');
  assert.ok(
    Math.abs(physics.state.footY) < 0.02,
    `Expected footY near 0 after landing, got footY=${physics.state.footY}, vv=${physics.state.verticalVelocity}`
  );
  assert.ok(
    minCompressionY < -0.01,
    `Expected negative landing weight compression, got ${minCompressionY}`
  );

  physics.dispose();
  world.free();
});

test('MotionBricksPhysics pushes dynamic toy_ball & blocks desk penetration, integrated with MotionBricksEngine', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({x: 0, y: -9.81, z: 0});
  const physics = new MotionBricksPhysics(RAPIER, world, ROOM_TEST_OBSTACLES, {
    x: -0.34,
    y: 0,
    z: -1.35,
  });

  const engine = new MotionBricksEngine();
  engine.setObstacles(ROOM_TEST_OBSTACLES);
  engine.rootPosition.set(-0.34, 0, -1.35);
  engine.attachPhysics(physics);

  const anchor = new THREE.Group();
  const initialBall = physics.getDynamicPropPosition('toy_ball');
  assert.ok(initialBall);

  // Toss plush die via dynamic impulse
  const initialDie = physics.getDynamicPropPosition('plush_die');
  assert.ok(initialDie);
  assert.equal(
    physics.applyPropImpulse('plush_die', {x: 0.24, y: 0.52, z: 0.18}),
    true
  );

  // Walk straight toward toy_ball (x = -0.34, z = -1.02)
  const dt = 1 / 60;
  for (let i = 0; i < 70; i++) {
    engine.update(dt, i * dt, anchor);
    world.timestep = dt;
    world.step();
    // Drive physics toward toy_ball directly using physics step
    physics.step(dt, {
      desiredVx: 0,
      desiredVz: 1.05,
      yaw: 0,
      seated: false,
      ignoreObstacleId: null,
      leftHandWorld: {x: physics.state.x + 0.2, y: 0.85, z: physics.state.z},
      rightHandWorld: {x: physics.state.x - 0.2, y: 0.85, z: physics.state.z},
    });
  }

  const movedBall = physics.getDynamicPropPosition('toy_ball');
  assert.ok(movedBall);
  const ballDisplacement = Math.hypot(
    movedBall.x - initialBall.x,
    movedBall.z - initialBall.z
  );
  assert.ok(
    ballDisplacement > 0.05,
    `Expected character controller impulse to push toy_ball, displacement=${ballDisplacement}`
  );

  const movedDie = physics.getDynamicPropPosition('plush_die');
  assert.ok(movedDie);
  const dieDisplacement = Math.hypot(
    movedDie.x - initialDie.x,
    movedDie.z - initialDie.z
  );
  assert.ok(
    dieDisplacement > 0.08,
    `Expected tossed plush_die to travel across room, displacement=${dieDisplacement}`
  );

  // Verify static desk collider prevents walking into desk interior
  physics.syncBodyPosition(-0.55, 0, -1.35);
  for (let i = 0; i < 60; i++) {
    world.timestep = dt;
    world.step();
    physics.step(dt, {
      desiredVx: -1.4,
      desiredVz: 0,
      yaw: -Math.PI / 2,
      seated: false,
      ignoreObstacleId: null,
      leftHandWorld: {x: -0.5, y: 0.85, z: -1.35},
      rightHandWorld: {x: -0.5, y: 0.85, z: -1.35},
    });
  }
  assert.ok(
    physics.state.x >= -0.7,
    `Expected static desk collider to block avatar at x >= -0.7, got x=${physics.state.x}`
  );

  engine.attachPhysics(null);
  physics.dispose();
  world.free();
});
