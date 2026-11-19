import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRM, VRMExpressionPresetName, VRMHumanBoneName, VRMLoaderPlugin} from '@pixiv/three-vrm';
import {enhanceVrmObjectQuality} from './VrmAvatarManager';
import {
  computeVrmNormalization,
  DEFAULT_VRM_URL,
  resolveVrmProxyUrl,
  VRM_PRESETS,
  validateVrmUrlInput,
} from './vrmUtils';

test('DEFAULT_VRM_URL points to /models/VRM1_Constraint_Twist_Sample.vrm and VRM_PRESETS includes local models', () => {
  assert.equal(DEFAULT_VRM_URL, '/models/VRM1_Constraint_Twist_Sample.vrm');
  assert.ok(VRM_PRESETS.some((p) => p.url === '/models/VRM1_Constraint_Twist_Sample.vrm'));
  assert.ok(VRM_PRESETS.some((p) => p.url === '/models/neuro_chan_default.vrm'));
  assert.ok(VRM_PRESETS.some((p) => p.url === '/models/neuro_cyber_aqua.vrm'));
});

test('validateVrmUrlInput accepts https, http, blob, and relative paths and rejects unsafe schemes', () => {
  assert.equal(validateVrmUrlInput('/models/VRM1_Constraint_Twist_Sample.vrm').valid, true);
  assert.equal(
    validateVrmUrlInput('models/neuro_cyber_aqua.vrm').normalizedUrl,
    '/models/neuro_cyber_aqua.vrm'
  );
  assert.equal(validateVrmUrlInput('https://example.com/avatar.vrm').valid, true);
  assert.equal(validateVrmUrlInput('http://cdn.example.com/model.vrm').valid, true);
  assert.equal(validateVrmUrlInput('blob:http://localhost:3000/123').valid, true);

  assert.equal(validateVrmUrlInput('').valid, false);
  assert.equal(validateVrmUrlInput('javascript:alert(1)').valid, false);
  assert.equal(validateVrmUrlInput('not-a-url').valid, false);
});

test('resolveVrmProxyUrl routes external origins through /api/proxy-vrm and keeps same-origin direct', () => {
  assert.equal(
    resolveVrmProxyUrl('/models/VRM1_Constraint_Twist_Sample.vrm', 'http://localhost:3000'),
    '/models/VRM1_Constraint_Twist_Sample.vrm'
  );
  assert.equal(
    resolveVrmProxyUrl('http://localhost:3000/models/a.vrm', 'http://localhost:3000'),
    'http://localhost:3000/models/a.vrm'
  );
  assert.equal(
    resolveVrmProxyUrl('https://hub.vroid.com/sample.vrm', 'http://localhost:3000'),
    '/api/proxy-vrm?url=https%3A%2F%2Fhub.vroid.com%2Fsample.vrm'
  );
});

test('computeVrmNormalization scales and grounds any avatar height cleanly onto y=0', () => {
  const tall = computeVrmNormalization({
    minX: -0.5,
    maxX: 0.5,
    minY: -1.0,
    maxY: 2.16,
    minZ: -0.3,
    maxZ: 0.3,
  });
  assert.ok(Math.abs(tall.scale - 0.5) < 0.001);
  assert.ok(Math.abs(tall.offsetY - 0.5) < 0.001);
  assert.equal(tall.offsetX, 0);
  assert.equal(tall.offsetZ, 0);
});

test('enhanceVrmObjectQuality upgrades texture filtering, anisotropy, alphaToCoverage, and shadow flags', () => {
  const tex = new THREE.Texture();
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.anisotropy = 1;
  tex.generateMipmaps = true;

  const cutoutMat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.5,
    transparent: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cutoutMat);
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  enhanceVrmObjectQuality(group, {maxAnisotropy: 16, enableAlphaToCoverage: true});

  assert.equal(tex.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(tex.magFilter, THREE.LinearFilter);
  assert.equal(tex.anisotropy, 16);
  assert.equal(cutoutMat.alphaToCoverage, true);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, false);
});

async function parseVrmFromDisk(relPath: string): Promise<VRM> {
  const vrmPath = path.resolve(process.cwd(), relPath);
  assert.ok(fs.existsSync(vrmPath), `VRM binary should exist at ${relPath}`);

  const bytes = fs.readFileSync(vrmPath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const g = globalThis as Record<string, unknown>;
  const origSelf = g.self;
  const origCreateImageBitmap = g.createImageBitmap;
  g.self = globalThis;
  g.createImageBitmap = async () => ({
    width: 64,
    height: 64,
    close() {},
  });

  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await new Promise<{userData: Record<string, unknown>}>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const vrm = gltf.userData.vrm as VRM | undefined;
    assert.ok(vrm, 'Parsed GLTF should populate gltf.userData.vrm');
    assert.ok(vrm.humanoid, 'VRM must include VRMHumanoid');
    assert.ok(vrm.expressionManager, 'VRM must include VRMExpressionManager');
    assert.ok(vrm.springBoneManager, 'VRM must include VRMSpringBoneManager');
    return vrm;
  } finally {
    if (origSelf === undefined) {
      delete g.self;
    } else {
      g.self = origSelf;
    }
    if (origCreateImageBitmap === undefined) {
      delete g.createImageBitmap;
    } else {
      g.createImageBitmap = origCreateImageBitmap;
    }
  }
}

test('public/models/VRM1_Constraint_Twist_Sample.vrm and neuro_chan_default.vrm parse cleanly with GLTFLoader + VRMLoaderPlugin', async () => {
  for (const relPath of [
    'public/models/VRM1_Constraint_Twist_Sample.vrm',
    'public/models/neuro_chan_default.vrm',
  ]) {
    const vrm = await parseVrmFromDisk(relPath);
    for (const requiredBone of [
      VRMHumanBoneName.Hips,
      VRMHumanBoneName.Spine,
      VRMHumanBoneName.Head,
      VRMHumanBoneName.LeftUpperArm,
      VRMHumanBoneName.LeftLowerArm,
      VRMHumanBoneName.LeftHand,
      VRMHumanBoneName.RightUpperArm,
      VRMHumanBoneName.RightLowerArm,
      VRMHumanBoneName.RightHand,
      VRMHumanBoneName.LeftUpperLeg,
      VRMHumanBoneName.LeftLowerLeg,
      VRMHumanBoneName.LeftFoot,
      VRMHumanBoneName.RightUpperLeg,
      VRMHumanBoneName.RightLowerLeg,
      VRMHumanBoneName.RightFoot,
    ]) {
      assert.ok(
        vrm.humanoid.getNormalizedBoneNode(requiredBone),
        `Missing required humanoid bone (${requiredBone}) in ${relPath}`
      );
    }

    for (const preset of [
      VRMExpressionPresetName.Aa,
      VRMExpressionPresetName.Ih,
      VRMExpressionPresetName.Ou,
      VRMExpressionPresetName.Ee,
      VRMExpressionPresetName.Oh,
      VRMExpressionPresetName.Blink,
      VRMExpressionPresetName.Happy,
      VRMExpressionPresetName.Angry,
      VRMExpressionPresetName.Sad,
      VRMExpressionPresetName.Relaxed,
      VRMExpressionPresetName.Surprised,
    ]) {
      assert.ok(
        vrm.expressionManager?.getExpression(preset),
        `Missing VRM expression preset (${preset}) in ${relPath}`
      );
    }

    assert.ok(
      (vrm.springBoneManager?.joints.size ?? 0) >= 5,
      `Should include SpringBone chains in ${relPath}`
    );
  }
});
