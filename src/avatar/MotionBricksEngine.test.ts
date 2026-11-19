import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {ROOM_WALK_BOUNDS, RoomObstacle} from '../scene/LofiRoomEnvironment';
import {
  DEFAULT_CONTACT_CONTRACTS,
  PropContactSurfaceLocal,
} from './motionbricks/ContactContract';
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

function createMinimalRigVrm(anchor: THREE.Group) {
  const scene = new THREE.Group();
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

test('MotionBricksEngine manages hand-hold leading and unified contact-verified prop execution', () => {
  const engine = new MotionBricksEngine(false);
  engine.setObstacles(TEST_OBSTACLES);
  const anchor = new THREE.Group();
  const mockVrm = createMinimalRigVrm(anchor);
  engine.setVRM(mockVrm as unknown as Parameters<MotionBricksEngine['setVRM']>[0]);

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

  // Execute unified declarative desk_chair command with prop-local seat surface
  const chairObj = new THREE.Group();
  chairObj.position.set(-0.62, 0, -1.36);
  chairObj.updateMatrixWorld(true);
  const chairSurface: PropContactSurfaceLocal = {
    shape: 'box',
    localCenter: [0, 0.44, 0],
    localHalfExtents: [0.22, 0.03, 0.22],
    localNormal: [0, 1, 0],
    localApproachDir: [1, 0, 0],
    localFacingDir: [-1, 0, 0],
    approachStandOff: 0.42,
  };

  let verifiedCount = 0;
  engine.executeCommand({
    propId: 'desk_chair',
    pose: 'type_desk',
    surfaceObject: chairObj,
    contactSurface: chairSurface,
    contract: DEFAULT_CONTACT_CONTRACTS.desk_chair,
    onContactVerified: () => {
      verifiedCount++;
    },
  });
  for (let i = 0; i < 220; i++) {
    engine.update(1 / 30, (46 + i) / 30, anchor);
  }
  assert.equal(verifiedCount, 1, 'Avatar should sit on desk chair and fire onContactVerified once');
  assert.equal(engine.pose, 'type_desk');
  const audit = engine.getContactAudit();
  assert.equal(audit.status, 'sustained_contact');
  assert.equal(audit.verification?.valid, true);
});
