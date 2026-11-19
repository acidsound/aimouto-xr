import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {ROOM_WALK_BOUNDS, RoomObstacle} from '../scene/LofiRoomEnvironment';
import {
  clampAndAvoidObstacles,
  computeRoomPath,
  MotionBricksEngine,
  solveTwoBoneIKPosition,
} from './MotionBricksEngine';

const TEST_OBSTACLES: RoomObstacle[] = [
  {id: 'desk', minX: -1.52, maxX: -0.68, minZ: -1.96, maxZ: -0.78},
  {id: 'bed', minX: 0.34, maxX: 1.54, minZ: -3.08, maxZ: -1.68},
];

test('clampAndAvoidObstacles keeps coordinates in room bounds and pushes outside furniture AABBs', () => {
  const insideDesk = clampAndAvoidObstacles(-1.05, -1.35, TEST_OBSTACLES, 0.2);
  const eps = 1e-5;
  const insideBox =
    insideDesk.x > TEST_OBSTACLES[0].minX - 0.2 + eps &&
    insideDesk.x < TEST_OBSTACLES[0].maxX + 0.2 - eps &&
    insideDesk.z > TEST_OBSTACLES[0].minZ - 0.2 + eps &&
    insideDesk.z < TEST_OBSTACLES[0].maxZ + 0.2 - eps;
  assert.equal(insideBox, false, 'Target must be pushed out of the desk AABB');

  const outOfRoom = clampAndAvoidObstacles(-5.0, 2.0, TEST_OBSTACLES, 0.2);
  assert.ok(
    outOfRoom.x >= ROOM_WALK_BOUNDS.minX &&
      outOfRoom.x <= ROOM_WALK_BOUNDS.maxX &&
      outOfRoom.z >= ROOM_WALK_BOUNDS.minZ &&
      outOfRoom.z <= ROOM_WALK_BOUNDS.maxZ
  );
});

test('computeRoomPath routes via central rug corridor between desk and bed', () => {
  const path = computeRoomPath(
    {x: -0.52, z: -1.42},
    {x: 0.28, z: -2.18},
    TEST_OBSTACLES
  );
  assert.equal(path.length, 2, 'Cross-room deep path should include central corridor waypoint');
  assert.ok(path[0].x > -0.3 && path[0].x < 0.15);
});

test('solveTwoBoneIKPosition places elbow and end-effector at exact bone lengths', () => {
  const root = new THREE.Vector3(0, 1.3, 0);
  const target = new THREE.Vector3(0.32, 1.12, -0.25);
  const pole = new THREE.Vector3(0.3, -0.5, 0.6);
  const mid = new THREE.Vector3();
  const end = new THREE.Vector3();
  const l1 = 0.26;
  const l2 = 0.24;

  solveTwoBoneIKPosition(root, target, l1, l2, pole, mid, end);

  const upperLen = root.distanceTo(mid);
  const lowerLen = mid.distanceTo(end);
  assert.ok(Math.abs(upperLen - l1) < 1e-4, `Expected upperLen ~ ${l1}, got ${upperLen}`);
  assert.ok(Math.abs(lowerLen - l2) < 1e-4, `Expected lowerLen ~ ${l2}, got ${lowerLen}`);
});

test('MotionBricksEngine manages hand-hold leading and room prop walking', () => {
  const engine = new MotionBricksEngine();
  engine.setObstacles(TEST_OBSTACLES);
  const anchor = new THREE.Group();

  // Start hand hold and pull target across the rug
  engine.startHandHold(new THREE.Vector3(0.15, 0.9, -1.0), 'right');
  assert.equal(engine.isHandHolding, true);
  assert.equal(engine.getSnapshot().pose, 'hand_hold');

  engine.updateHandHoldTarget(new THREE.Vector3(0.42, 0.9, -0.95));
  for (let i = 0; i < 45; i++) {
    engine.update(1 / 30, i / 30, anchor);
  }
  assert.ok(
    engine.rootPosition.x > -0.05,
    `Expected avatar to follow pulled hand rightwards, x=${engine.rootPosition.x}`
  );

  engine.stopHandHold();
  assert.equal(engine.isHandHolding, false);

  // Enqueue desk interaction and step until arrival
  let arrived = false;
  engine.enqueueCommand({
    propId: 'desk_chair',
    pose: 'type_desk',
    approachPos: new THREE.Vector3(-0.5, 0, -1.36),
    approachYaw: -Math.PI * 0.5,
    onArrive: () => {
      arrived = true;
    },
  });
  for (let i = 0; i < 160; i++) {
    engine.update(1 / 30, i / 30, anchor);
  }
  assert.equal(arrived, true, 'Avatar should reach desk chair and trigger onArrive');
  assert.equal(engine.pose, 'type_desk');
});
