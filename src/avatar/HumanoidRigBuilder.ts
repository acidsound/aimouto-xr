import * as THREE from 'three';
import {AvatarEmotion, VisemeVowel} from '../types';

export interface AvatarRigHandles {
  rootGroup: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<string, THREE.Bone>;
  skinnedMeshes: THREE.SkinnedMesh[];
  face: {
    headGroup: THREE.Group;
    irisL: THREE.Mesh;
    irisR: THREE.Mesh;
    eyelidTopL: THREE.Mesh;
    eyelidTopR: THREE.Mesh;
    eyelidBottomL: THREE.Mesh;
    eyelidBottomR: THREE.Mesh;
    happyArcL: THREE.Mesh;
    happyArcR: THREE.Mesh;
    browL: THREE.Mesh;
    browR: THREE.Mesh;
    blushL: THREE.Mesh;
    blushR: THREE.Mesh;
    mouthCavity: THREE.Mesh;
    mouthSmileCurve: THREE.Mesh;
    mouthUpperLip: THREE.Mesh;
    mouthLowerLip: THREE.Mesh;
  };
  accentMaterials: {
    ribbonGlow: THREE.MeshStandardMaterial;
    auraHalo: THREE.MeshStandardMaterial;
    eyeIrisL: THREE.MeshBasicMaterial;
    eyeIrisR: THREE.MeshBasicMaterial;
  };
  disposables: Array<{dispose: () => void}>;
}

function createAnimeIrisTexture(baseHex: string, highlightHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 120, 18, 128, 128, 118);
  grad.addColorStop(0, '#0f1333');
  grad.addColorStop(0.28, '#1e2766');
  grad.addColorStop(0.62, baseHex);
  grad.addColorStop(0.88, highlightHex);
  grad.addColorStop(1, '#121536');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Inner pupil
  ctx.fillStyle = '#090b1d';
  ctx.beginPath();
  ctx.ellipse(128, 126, 36, 44, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lower crescent anime glow
  const glow = ctx.createLinearGradient(0, 145, 0, 230);
  glow.addColorStop(0, 'rgba(120, 240, 255, 0)');
  glow.addColorStop(0.7, 'rgba(140, 245, 255, 0.72)');
  glow.addColorStop(1, 'rgba(255, 160, 220, 0.45)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(128, 136, 86, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.fill();

  // Primary & secondary specular anime catchlights
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(90, 82, 22, 18, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(168, 166, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  ctx.arc(165, 92, 7, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBlushTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 32, 4, 64, 32, 54);
  grad.addColorStop(0, 'rgba(255, 98, 152, 0.92)');
  grad.addColorStop(0.6, 'rgba(255, 118, 170, 0.42)');
  grad.addColorStop(1, 'rgba(255, 118, 170, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);

  // Subtle anime blush hatch lines
  ctx.strokeStyle = 'rgba(255, 70, 130, 0.55)';
  ctx.lineWidth = 3;
  for (let x = 42; x <= 86; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x - 4, 42);
    ctx.lineTo(x + 6, 22);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createOutfitFabricTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b2147';
  ctx.fillRect(0, 0, 256, 256);

  // Subtle diagonal weave
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 2;
  for (let i = -256; i < 512; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
  }

  // Cyber-idol hem stripes
  ctx.fillStyle = '#ff6ba8';
  ctx.fillRect(0, 218, 256, 8);
  ctx.fillStyle = '#4be3ff';
  ctx.fillRect(0, 232, 256, 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function attachSkinWeights(
  geometry: THREE.BufferGeometry,
  boneIndices: number[],
  weightFn: (yNorm: number, pos: THREE.Vector3) => [number, number, number, number]
): void {
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);

  geometry.computeBoundingBox();
  const minY = geometry.boundingBox?.min.y ?? 0;
  const maxY = geometry.boundingBox?.max.y ?? 1;
  const spanY = Math.max(0.0001, maxY - minY);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i);
    const yNorm = (v.y - minY) / spanY;
    const weights = weightFn(yNorm, v);

    skinIndices[i * 4 + 0] = boneIndices[0] ?? 0;
    skinIndices[i * 4 + 1] = boneIndices[1] ?? 0;
    skinIndices[i * 4 + 2] = boneIndices[2] ?? 0;
    skinIndices[i * 4 + 3] = boneIndices[3] ?? 0;

    const sum = weights[0] + weights[1] + weights[2] + weights[3] || 1;
    skinWeights[i * 4 + 0] = weights[0] / sum;
    skinWeights[i * 4 + 1] = weights[1] / sum;
    skinWeights[i * 4 + 2] = weights[2] / sum;
    skinWeights[i * 4 + 3] = weights[3] / sum;
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
}

/**
 * Builds a complete, multi-part rigged humanoid anime avatar (`Neuro-Chan`)
 * using THREE.Bone, THREE.Skeleton, THREE.SkinnedMesh, procedural PBR textures,
 * and an articulated facial expression & viseme system.
 */
export function buildNeuroHumanoidRig(): AvatarRigHandles {
  const disposables: Array<{dispose: () => void}> = [];
  const track = <T extends {dispose: () => void}>(res: T): T => {
    disposables.push(res);
    return res;
  };

  const rootGroup = new THREE.Group();
  rootGroup.name = 'NeuroChanHumanoidAvatar';

  // --- Materials (varied roughness/metalness for crisp figure-material read) ---
  const skinMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffe4d6,
      roughness: 0.62,
      metalness: 0.02,
    })
  );
  const hairMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd8a68f, // Warm honey-brunette Neuro-style hair
      roughness: 0.36,
      metalness: 0.08,
    })
  );
  const hairTipMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc28876,
      roughness: 0.4,
      metalness: 0.06,
    })
  );
  const dressTex = track(createOutfitFabricTexture());
  const dressMat = track(
    new THREE.MeshStandardMaterial({
      map: dressTex,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.06,
    })
  );
  const blouseMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xf4f7ff,
      roughness: 0.68,
      metalness: 0.02,
    })
  );
  const ribbonGlow = track(
    new THREE.MeshStandardMaterial({
      color: 0xff6ba8,
      emissive: 0xff3b8d,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.2,
    })
  );
  const cyberTrimMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x4be3ff,
      emissive: 0x1ea8d6,
      emissiveIntensity: 0.45,
      roughness: 0.22,
      metalness: 0.55,
    })
  );
  const stockingMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e2240,
      roughness: 0.78,
      metalness: 0.05,
    })
  );
  const bootMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x14162b,
      roughness: 0.3,
      metalness: 0.25,
    })
  );
  const auraHalo = track(
    new THREE.MeshStandardMaterial({
      color: 0x4be3ff,
      emissive: 0x4be3ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.4,
    })
  );

  // --- Skeleton Bone Hierarchy (standing height ~1.58m, bottom-center pivot at y=0) ---
  const bones: Record<string, THREE.Bone> = {};
  const makeBone = (
    name: string,
    parent: THREE.Bone | null,
    x: number,
    y: number,
    z: number
  ): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones[name] = b;
    return b;
  };

  const rootBone = makeBone('root', null, 0, 0, 0);
  const hips = makeBone('hips', rootBone, 0, 0.84, 0);
  const spine = makeBone('spine', hips, 0, 0.12, 0);
  const chest = makeBone('chest', spine, 0, 0.18, 0);
  const neck = makeBone('neck', chest, 0, 0.19, 0);
  const head = makeBone('head', neck, 0, 0.08, 0);

  // Hair spring bones
  const ahoge = makeBone('ahoge', head, 0.02, 0.25, 0.01);
  const twinBaseL = makeBone('twinBaseL', head, -0.15, 0.12, -0.05);
  const twinMidL = makeBone('twinMidL', twinBaseL, -0.07, -0.22, -0.03);
  const twinTipL = makeBone('twinTipL', twinMidL, -0.04, -0.24, -0.02);

  const twinBaseR = makeBone('twinBaseR', head, 0.15, 0.12, -0.05);
  const twinMidR = makeBone('twinMidR', twinBaseR, 0.07, -0.22, -0.03);
  const twinTipR = makeBone('twinTipR', twinMidR, 0.04, -0.24, -0.02);

  // Arms
  const shoulderL = makeBone('shoulderL', chest, -0.09, 0.14, 0);
  const upperArmL = makeBone('upperArmL', shoulderL, -0.07, -0.02, 0);
  const forearmL = makeBone('forearmL', upperArmL, 0, -0.23, 0);
  const handL = makeBone('handL', forearmL, 0, -0.21, 0);

  const shoulderR = makeBone('shoulderR', chest, 0.09, 0.14, 0);
  const upperArmR = makeBone('upperArmR', shoulderR, 0.07, -0.02, 0);
  const forearmR = makeBone('forearmR', upperArmR, 0, -0.23, 0);
  const handR = makeBone('handR', forearmR, 0, -0.21, 0);

  // Legs
  const thighL = makeBone('thighL', hips, -0.082, -0.04, 0);
  const shinL = makeBone('shinL', thighL, 0, -0.37, 0);
  const footL = makeBone('footL', shinL, 0, -0.36, 0);

  const thighR = makeBone('thighR', hips, 0.082, -0.04, 0);
  const shinR = makeBone('shinR', thighR, 0, -0.37, 0);
  const footR = makeBone('footR', shinR, 0, -0.36, 0);

  rootGroup.add(rootBone);
  rootGroup.updateMatrixWorld(true);

  const boneList = Object.values(bones);
  const boneIndex = (name: string) => boneList.indexOf(bones[name]);
  const skeleton = new THREE.Skeleton(boneList);
  skeleton.calculateInverses();

  const skinnedMeshes: THREE.SkinnedMesh[] = [];

  // --- 1. Skinned Torso & Jacket Dress (bound to hips / spine / chest) ---
  const torsoProfile = [
    new THREE.Vector2(0.01, 0.80),
    new THREE.Vector2(0.115, 0.82),
    new THREE.Vector2(0.095, 0.94),
    new THREE.Vector2(0.088, 1.04),
    new THREE.Vector2(0.118, 1.15),
    new THREE.Vector2(0.125, 1.26),
    new THREE.Vector2(0.098, 1.32),
    new THREE.Vector2(0.055, 1.34),
  ];
  const torsoGeo = track(new THREE.LatheGeometry(torsoProfile, 24));
  torsoGeo.scale(1.06, 1.0, 0.78);
  attachSkinWeights(
    torsoGeo,
    [boneIndex('hips'), boneIndex('spine'), boneIndex('chest'), 0],
    (yNorm) => {
      if (yNorm < 0.35) {
        const t = yNorm / 0.35;
        return [1 - t, t, 0, 0];
      }
      const t = (yNorm - 0.35) / 0.65;
      return [0, 1 - t, t, 0];
    }
  );
  const torsoMesh = new THREE.SkinnedMesh(torsoGeo, blouseMat);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torsoMesh.bind(skeleton);
  rootGroup.add(torsoMesh);
  skinnedMeshes.push(torsoMesh);

  // Cyber-Idol Cropped Bolero Jacket overlay on chest
  const jacketProfile = [
    new THREE.Vector2(0.102, 1.03),
    new THREE.Vector2(0.126, 1.14),
    new THREE.Vector2(0.132, 1.25),
    new THREE.Vector2(0.105, 1.31),
    new THREE.Vector2(0.068, 1.335),
  ];
  const jacketGeo = track(new THREE.LatheGeometry(jacketProfile, 24));
  jacketGeo.scale(1.08, 1.0, 0.81);
  attachSkinWeights(
    jacketGeo,
    [boneIndex('spine'), boneIndex('chest'), 0, 0],
    (yNorm) => [1 - yNorm, yNorm, 0, 0]
  );
  const jacketMesh = new THREE.SkinnedMesh(jacketGeo, dressMat);
  jacketMesh.castShadow = true;
  jacketMesh.bind(skeleton);
  rootGroup.add(jacketMesh);
  skinnedMeshes.push(jacketMesh);

  // --- 2. Skinned Pleated Skirt (hips + thighL + thighR deformation) ---
  const skirtGeo = track(new THREE.CylinderGeometry(0.108, 0.235, 0.34, 36, 8, true));
  skirtGeo.translate(0, 0.72, 0);
  const skirtPos = skirtGeo.attributes.position;
  for (let i = 0; i < skirtPos.count; i++) {
    const x = skirtPos.getX(i);
    const y = skirtPos.getY(i);
    const z = skirtPos.getZ(i);
    const angle = Math.atan2(z, x);
    const pleat = Math.cos(angle * 14) * 0.016 * ((0.89 - y) / 0.34);
    const r = Math.hypot(x, z) + pleat;
    skirtPos.setX(i, Math.cos(angle) * r);
    skirtPos.setZ(i, Math.sin(angle) * r * 0.88);
  }
  skirtGeo.computeVertexNormals();
  attachSkinWeights(
    skirtGeo,
    [boneIndex('hips'), boneIndex('thighL'), boneIndex('thighR'), 0],
    (yNorm, v) => {
      const hipW = 0.45 + yNorm * 0.55;
      const legW = 1 - hipW;
      const leftBias = v.x < 0 ? 1 : 0.15;
      const rightBias = v.x >= 0 ? 1 : 0.15;
      return [hipW, legW * leftBias, legW * rightBias, 0];
    }
  );
  const skirtMat = dressMat.clone();
  skirtMat.side = THREE.DoubleSide;
  track(skirtMat);
  const skirtMesh = new THREE.SkinnedMesh(skirtGeo, skirtMat);
  skirtMesh.castShadow = true;
  skirtMesh.receiveShadow = true;
  skirtMesh.bind(skeleton);
  rootGroup.add(skirtMesh);
  skinnedMeshes.push(skirtMesh);

  // Cyber-Idol Waist Belt & Front Sash Ribbon (bridges blouse & pleated skirt)
  const beltMesh = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.104, 0.114, 0.068, 24)),
    dressMat
  );
  beltMesh.scale.set(1.06, 1.0, 0.82);
  beltMesh.position.set(0, 0.055, 0);
  const beltTrim = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.11, 0.008, 8, 28)),
    ribbonGlow
  );
  beltTrim.rotation.x = Math.PI / 2;
  beltTrim.scale.set(1.04, 0.82, 1.0);
  beltTrim.position.set(0, 0.055, 0);
  const beltGem = new THREE.Mesh(
    track(new THREE.OctahedronGeometry(0.018, 0)),
    cyberTrimMat
  );
  beltGem.position.set(0, 0.055, 0.094);
  hips.add(beltMesh, beltTrim, beltGem);

  // --- 3. Skinned Flowing Twintails (L & R) ---
  const buildTwintail = (side: -1 | 1) => {
    const b0 = side < 0 ? 'twinBaseL' : 'twinBaseR';
    const b1 = side < 0 ? 'twinMidL' : 'twinMidR';
    const b2 = side < 0 ? 'twinTipL' : 'twinTipR';

    const profile = [
      new THREE.Vector2(0.005, -0.52),
      new THREE.Vector2(0.036, -0.40),
      new THREE.Vector2(0.062, -0.24),
      new THREE.Vector2(0.056, -0.10),
      new THREE.Vector2(0.038, 0.02),
      new THREE.Vector2(0.005, 0.05),
    ];
    const geo = track(new THREE.LatheGeometry(profile, 16));
    // Shift geometry to world rest position of twinBase
    const baseX = side * 0.15;
    const baseY = 1.53;
    const baseZ = -0.05;
    // Apply slight outward flair toward tip
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const t = Math.max(0, -py / 0.52);
      pos.setX(i, pos.getX(i) + baseX + side * t * 0.11);
      pos.setY(i, py + baseY);
      pos.setZ(i, pos.getZ(i) + baseZ - t * 0.05);
    }
    geo.computeVertexNormals();
    attachSkinWeights(
      geo,
      [boneIndex(b0), boneIndex(b1), boneIndex(b2), 0],
      (yNorm) => {
        const down = 1 - yNorm;
        if (down < 0.5) {
          const t = down / 0.5;
          return [1 - t, t, 0, 0];
        }
        const t = (down - 0.5) / 0.5;
        return [0, 1 - t, t, 0];
      }
    );
    const mesh = new THREE.SkinnedMesh(geo, hairTipMat);
    mesh.castShadow = true;
    mesh.bind(skeleton);
    rootGroup.add(mesh);
    skinnedMeshes.push(mesh);

    // Cyber ribbon & hair tie attached directly to twinBase bone
    const clipGroup = new THREE.Group();
    const ring = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.038, 0.011, 10, 20)),
      ribbonGlow
    );
    ring.rotation.y = Math.PI / 2;
    const bowWingA = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.028, 0.07, 4)),
      ribbonGlow
    );
    bowWingA.rotation.z = side * 0.9;
    bowWingA.position.set(side * 0.02, 0.025, 0.02);
    const bowWingB = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.024, 0.06, 4)),
      cyberTrimMat
    );
    bowWingB.rotation.z = side * 1.4;
    bowWingB.position.set(side * 0.02, -0.02, 0.02);
    clipGroup.add(ring, bowWingA, bowWingB);
    bones[b0].add(clipGroup);
  };
  buildTwintail(-1);
  buildTwintail(1);

  // --- Chest Collar, Cyber Ribbon & Glowing Heart Crest ---
  const collarRing = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.072, 0.014, 10, 24)),
    cyberTrimMat
  );
  collarRing.rotation.x = Math.PI / 2 - 0.15;
  collarRing.position.set(0, 0.17, 0.01);
  chest.add(collarRing);

  const chestBow = new THREE.Group();
  chestBow.position.set(0, 0.135, 0.095);
  const knot = new THREE.Mesh(
    track(new THREE.OctahedronGeometry(0.022, 1)),
    cyberTrimMat
  );
  const bowL = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.024, 0.065, 5)),
    ribbonGlow
  );
  bowL.rotation.z = Math.PI / 2.2;
  bowL.position.x = -0.034;
  const bowR = bowL.clone();
  bowR.rotation.z = -Math.PI / 2.2;
  bowR.position.x = 0.034;
  chestBow.add(knot, bowL, bowR);
  chest.add(chestBow);

  // Neck cylinder
  const neckMesh = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.038, 0.044, 0.11, 16)),
    skinMat
  );
  neckMesh.position.y = 0.04;
  neck.add(neckMesh);

  // --- 4. Detailed Anime Head & Expressive Face ---
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.11, 0);
  head.add(headGroup);

  const craniumGeo = track(new THREE.SphereGeometry(0.132, 32, 26));
  // Taper slightly toward chin for anime jawline
  const cPos = craniumGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i);
    const y = cPos.getY(i);
    const z = cPos.getZ(i);
    let nx = x;
    let ny = y * 1.06;
    let nz = z * 0.96;
    if (y < -0.02) {
      const chinT = Math.min(1, (-y - 0.02) / 0.11);
      nx *= 1 - chinT * 0.36;
      if (z > 0) nz *= 1 - chinT * 0.14;
    }
    cPos.setXYZ(i, nx, ny, nz);
  }
  craniumGeo.computeVertexNormals();
  const craniumMesh = new THREE.Mesh(craniumGeo, skinMat);
  craniumMesh.castShadow = true;
  headGroup.add(craniumMesh);

  // Subtle cute nose tip
  const noseMesh = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.008, 0.016, 8)),
    skinMat
  );
  noseMesh.rotation.x = Math.PI / 2;
  noseMesh.position.set(0, -0.022, 0.128);
  headGroup.add(noseMesh);

  // Ears
  const earGeo = track(new THREE.SphereGeometry(0.022, 12, 12));
  earGeo.scale(0.55, 1.1, 0.65);
  const earL = new THREE.Mesh(earGeo, skinMat);
  earL.position.set(-0.125, -0.015, -0.01);
  const earR = new THREE.Mesh(earGeo, skinMat);
  earR.position.set(0.125, -0.015, -0.01);
  headGroup.add(earL, earR);

  // Hair Crown + Side Locks + Layered Bangs
  const hairCapGeo = track(
    new THREE.SphereGeometry(0.139, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62)
  );
  hairCapGeo.scale(1.03, 1.06, 1.01);
  const hairCap = new THREE.Mesh(hairCapGeo, hairMat);
  hairCap.rotation.x = -0.22;
  hairCap.position.set(0, 0.014, -0.008);
  hairCap.castShadow = true;
  headGroup.add(hairCap);

  // Back hair shell
  const hairBackGeo = track(
    new THREE.SphereGeometry(0.142, 24, 18, Math.PI * 0.68, Math.PI * 1.64, 0.25, Math.PI * 0.72)
  );
  const hairBack = new THREE.Mesh(hairBackGeo, hairMat);
  hairBack.position.set(0, 0.005, -0.01);
  headGroup.add(hairBack);

  // Forehead Bangs (5 sculpted curved locks)
  const bangGeo = track(new THREE.ConeGeometry(0.032, 0.115, 8));
  bangGeo.scale(1.0, 1.0, 0.35);
  const bangConfigs = [
    {x: -0.075, y: 0.068, z: 0.118, rz: -0.22, rx: -0.26},
    {x: -0.038, y: 0.074, z: 0.128, rz: -0.08, rx: -0.22},
    {x: 0.0, y: 0.078, z: 0.132, rz: 0.03, rx: -0.2},
    {x: 0.038, y: 0.074, z: 0.128, rz: 0.1, rx: -0.22},
    {x: 0.075, y: 0.068, z: 0.118, rz: 0.22, rx: -0.26},
  ];
  for (const cfg of bangConfigs) {
    const bang = new THREE.Mesh(bangGeo, hairMat);
    bang.position.set(cfg.x, cfg.y, cfg.z);
    bang.rotation.set(Math.PI + cfg.rx, 0, cfg.rz);
    headGroup.add(bang);
  }

  // Side face-framing hair locks
  const sideLockGeo = track(new THREE.ConeGeometry(0.026, 0.22, 10));
  sideLockGeo.scale(0.9, 1.0, 0.55);
  const sideLockL = new THREE.Mesh(sideLockGeo, hairMat);
  sideLockL.position.set(-0.115, -0.04, 0.055);
  sideLockL.rotation.set(Math.PI - 0.08, 0, -0.1);
  const sideLockR = new THREE.Mesh(sideLockGeo, hairMat);
  sideLockR.position.set(0.115, -0.04, 0.055);
  sideLockR.rotation.set(Math.PI - 0.08, 0, 0.1);
  headGroup.add(sideLockL, sideLockR);

  // Cyber-Idol Headset Band & Glowing Ear Nodes
  const headsetBand = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.145, 0.011, 10, 28, Math.PI * 1.05)),
    bootMat
  );
  headsetBand.rotation.z = -Math.PI * 0.025;
  headsetBand.position.set(0, 0.025, 0.0);
  const earNodeGeo = track(new THREE.CylinderGeometry(0.028, 0.028, 0.018, 18));
  const earNodeL = new THREE.Mesh(earNodeGeo, cyberTrimMat);
  earNodeL.rotation.z = Math.PI / 2;
  earNodeL.position.set(-0.145, 0.01, -0.01);
  const earNodeR = new THREE.Mesh(earNodeGeo, cyberTrimMat);
  earNodeR.rotation.z = Math.PI / 2;
  earNodeR.position.set(0.145, 0.01, -0.01);
  headGroup.add(headsetBand, earNodeL, earNodeR);

  // Ahoge on ahoge bone
  const ahogeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.015, 0.045, 0.01),
    new THREE.Vector3(0.055, 0.075, 0.0),
    new THREE.Vector3(0.08, 0.055, -0.01),
  ]);
  const ahogeMesh = new THREE.Mesh(
    track(new THREE.TubeGeometry(ahogeCurve, 14, 0.008, 8, false)),
    hairMat
  );
  ahoge.add(ahogeMesh);

  // --- Facial Features (Eyes, Eyelids, Brows, Blush, Multi-Viseme Mouth) ---
  const scleraMat = track(
    new THREE.MeshBasicMaterial({color: 0xffffff})
  );
  const irisTex = track(createAnimeIrisTexture('#3c6eff', '#5ef2ff'));
  const eyeIrisL = track(new THREE.MeshBasicMaterial({map: irisTex}));
  const eyeIrisR = track(new THREE.MeshBasicMaterial({map: irisTex}));
  const lashMat = track(new THREE.MeshBasicMaterial({color: 0x24172a}));
  const eyelidSkinMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xfad7c5,
      roughness: 0.62,
      metalness: 0.02,
    })
  );

  const buildEye = (side: -1 | 1, irisMat: THREE.MeshBasicMaterial) => {
    const xPos = side * 0.048;
    const yPos = 0.004;
    const zPos = 0.118;

    const eyeAnchor = new THREE.Group();
    eyeAnchor.position.set(xPos, yPos, 0.12);
    eyeAnchor.rotation.y = side * 0.22;
    headGroup.add(eyeAnchor);

    const sclera = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.029, 24)),
      scleraMat
    );
    sclera.scale.set(0.95, 1.15, 1);
    eyeAnchor.add(sclera);

    const iris = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.021, 24)),
      irisMat
    );
    iris.scale.set(0.9, 1.14, 1);
    iris.position.set(0, -0.002, 0.002);
    eyeAnchor.add(iris);

    // Upper Eyelash arch
    const upperLash = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.031, 0.004, 8, 20, Math.PI * 0.92)),
      lashMat
    );
    upperLash.rotation.z = Math.PI * 0.04;
    upperLash.position.set(0, 0.004, 0.004);
    eyeAnchor.add(upperLash);

    // Top Eyelid (slides down for blinking & sleepy)
    const eyelidTop = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.058, 0.046)),
      eyelidSkinMat
    );
    eyelidTop.position.set(0, 0.048, 0.005);
    eyeAnchor.add(eyelidTop);

    // Bottom Eyelid (slides up for squinting / tsundere)
    const eyelidBottom = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.056, 0.028)),
      eyelidSkinMat
    );
    eyelidBottom.position.set(0, -0.046, 0.005);
    eyeAnchor.add(eyelidBottom);

    // Happy "^ ^" curved eye line shown when smiling brightly
    const happyArc = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.022, 0.0038, 8, 18, Math.PI * 0.85)),
      lashMat
    );
    happyArc.rotation.z = Math.PI * 0.075;
    happyArc.position.set(0, -0.002, 0.007);
    happyArc.visible = false;
    eyeAnchor.add(happyArc);

    // Eyebrow
    const brow = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.044, 0.006, 0.006)),
      lashMat
    );
    brow.position.set(0, 0.046, 0.006);
    eyeAnchor.add(brow);

    return {iris, eyelidTop, eyelidBottom, happyArc, brow};
  };

  const leftEye = buildEye(-1, eyeIrisL);
  const rightEye = buildEye(1, eyeIrisR);

  // Cheek Blush
  const blushTex = track(createBlushTexture());
  const blushMat = track(
    new THREE.MeshBasicMaterial({
      map: blushTex,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
  );
  const blushGeo = track(new THREE.PlaneGeometry(0.046, 0.024));
  const blushL = new THREE.Mesh(blushGeo, blushMat);
  blushL.position.set(-0.065, -0.032, 0.114);
  blushL.rotation.y = -0.38;
  const blushR = new THREE.Mesh(blushGeo, blushMat);
  blushR.position.set(0.065, -0.032, 0.114);
  blushR.rotation.y = 0.38;
  headGroup.add(blushL, blushR);

  // Articulated Mouth (cavity + tongue + upper/lower lips + smile curve)
  const mouthAnchor = new THREE.Group();
  mouthAnchor.position.set(0, -0.056, 0.123);
  headGroup.add(mouthAnchor);

  const mouthCavity = new THREE.Mesh(
    track(new THREE.CircleGeometry(0.015, 18)),
    track(new THREE.MeshBasicMaterial({color: 0x7c1f3e}))
  );
  mouthCavity.scale.set(1.1, 0.05, 1);
  mouthAnchor.add(mouthCavity);

  const mouthSmileCurve = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.017, 0.0022, 6, 16, Math.PI * 0.8)),
    lashMat
  );
  mouthSmileCurve.rotation.z = Math.PI * 1.1;
  mouthSmileCurve.position.set(0, 0.005, 0.002);
  mouthAnchor.add(mouthSmileCurve);

  const lipMat = track(new THREE.MeshBasicMaterial({color: 0xd96b86}));
  const mouthUpperLip = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.026, 0.003, 0.003)),
    lipMat
  );
  mouthUpperLip.position.set(0, 0.004, 0.002);
  const mouthLowerLip = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.022, 0.003, 0.003)),
    lipMat
  );
  mouthLowerLip.position.set(0, -0.004, 0.002);
  mouthAnchor.add(mouthUpperLip, mouthLowerLip);

  // --- 5. Articulated Arms, Sleeve Cuffs & Hands ---
  const buildArm = (side: -1 | 1) => {
    const uBone = side < 0 ? upperArmL : upperArmR;
    const fBone = side < 0 ? forearmL : forearmR;
    const hBone = side < 0 ? handL : handR;

    // Shoulder cap + puff sleeve
    const shoulderCap = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.037, 14, 12)),
      dressMat
    );
    shoulderCap.position.set(0, 0.004, 0);
    shoulderCap.castShadow = true;
    uBone.add(shoulderCap);

    const sleeve = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.036, 0.031, 0.14, 14)),
      dressMat
    );
    sleeve.position.y = -0.07;
    sleeve.castShadow = true;
    uBone.add(sleeve);

    const upperSkin = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.026, 0.023, 0.11, 14)),
      skinMat
    );
    upperSkin.position.y = -0.175;
    upperSkin.castShadow = true;
    uBone.add(upperSkin);

    const elbowJoint = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.023, 12, 12)),
      skinMat
    );
    fBone.add(elbowJoint);

    const forearmMesh = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.023, 0.019, 0.18, 14)),
      skinMat
    );
    forearmMesh.position.y = -0.095;
    forearmMesh.castShadow = true;
    fBone.add(forearmMesh);

    // Glowing idol wrist cuff
    const cuff = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.024, 0.025, 0.034, 16)),
      cyberTrimMat
    );
    cuff.position.y = -0.185;
    fBone.add(cuff);

    // Sculpted hand (palm + thumb + fingers)
    const palm = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.032, 0.044, 0.022)),
      skinMat
    );
    palm.position.y = -0.025;
    const fingers = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.03, 0.034, 0.018)),
      skinMat
    );
    fingers.position.set(0, -0.056, 0.002);
    const thumb = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.006, 0.007, 0.026, 8)),
      skinMat
    );
    thumb.position.set(-side * 0.02, -0.028, 0.006);
    thumb.rotation.z = side * 0.55;
    hBone.add(palm, fingers, thumb);
  };
  buildArm(-1);
  buildArm(1);

  // --- 6. Articulated Legs, Thigh-High Stockings & Cyber-Idol Boots ---
  const buildLeg = (side: -1 | 1) => {
    const tBone = side < 0 ? thighL : thighR;
    const sBone = side < 0 ? shinL : shinR;
    const fBone = side < 0 ? footL : footR;

    const thighSkin = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.052, 0.043, 0.21, 16)),
      skinMat
    );
    thighSkin.position.y = -0.11;
    thighSkin.castShadow = true;
    tBone.add(thighSkin);

    const thighSock = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.044, 0.038, 0.16, 16)),
      stockingMat
    );
    thighSock.position.y = -0.285;
    thighSock.castShadow = true;
    tBone.add(thighSock);

    // Pink cyber garter band
    const garter = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.044, 0.006, 8, 20)),
      ribbonGlow
    );
    garter.rotation.x = Math.PI / 2;
    garter.position.y = -0.21;
    tBone.add(garter);

    const kneeJoint = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.037, 12, 12)),
      stockingMat
    );
    sBone.add(kneeJoint);

    const shinSock = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.038, 0.031, 0.22, 16)),
      stockingMat
    );
    shinSock.position.y = -0.11;
    shinSock.castShadow = true;
    sBone.add(shinSock);

    const bootShaft = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.039, 0.036, 0.16, 16)),
      bootMat
    );
    bootShaft.position.y = -0.28;
    bootShaft.castShadow = true;
    const bootTrim = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.04, 0.0055, 8, 18)),
      cyberTrimMat
    );
    bootTrim.rotation.x = Math.PI / 2;
    bootTrim.position.y = -0.205;
    sBone.add(bootShaft, bootTrim);

    // Boot foot + sole flush at y=0
    const bootUpper = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.068, 0.056, 0.14)),
      bootMat
    );
    bootUpper.position.set(0, -0.028, 0.036);
    bootUpper.castShadow = true;
    const bootSole = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.074, 0.022, 0.15)),
      cyberTrimMat
    );
    bootSole.position.set(0, -0.059, 0.036);
    fBone.add(bootUpper, bootSole);
  };
  buildLeg(-1);
  buildLeg(1);

  // Floating cyber halo ring behind head for idol silhouette
  const haloMesh = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.22, 0.008, 10, 36)),
    auraHalo
  );
  haloMesh.position.set(0, 0.12, -0.18);
  head.add(haloMesh);

  return {
    rootGroup,
    skeleton,
    bones,
    skinnedMeshes,
    face: {
      headGroup,
      irisL: leftEye.iris,
      irisR: rightEye.iris,
      eyelidTopL: leftEye.eyelidTop,
      eyelidTopR: rightEye.eyelidTop,
      eyelidBottomL: leftEye.eyelidBottom,
      eyelidBottomR: rightEye.eyelidBottom,
      happyArcL: leftEye.happyArc,
      happyArcR: rightEye.happyArc,
      browL: leftEye.brow,
      browR: rightEye.brow,
      blushL,
      blushR,
      mouthCavity,
      mouthSmileCurve,
      mouthUpperLip,
      mouthLowerLip,
    },
    accentMaterials: {
      ribbonGlow,
      auraHalo,
      eyeIrisL,
      eyeIrisR,
    },
    disposables,
  };
}

export function applyMouthViseme(
  face: AvatarRigHandles['face'],
  viseme: VisemeVowel,
  mouthOpen: number,
  smileFactor: number
): void {
  const open = THREE.MathUtils.clamp(mouthOpen, 0, 1);

  // Smile curve curvature
  const smileVisible = open < 0.25;
  face.mouthSmileCurve.visible = smileVisible;
  face.mouthSmileCurve.rotation.z =
    smileFactor >= 0 ? Math.PI * 1.1 : Math.PI * 0.1;
  face.mouthSmileCurve.position.y = smileFactor >= 0 ? 0.004 : -0.008;

  // Viseme cavity dimensions
  let width = 1.0;
  let height = 0.08 + open * 0.95;
  switch (viseme) {
    case 'A':
      width = 1.18;
      height = 0.35 + open * 0.85;
      break;
    case 'I':
      width = 1.45;
      height = 0.2 + open * 0.4;
      break;
    case 'U':
      width = 0.62;
      height = 0.32 + open * 0.55;
      break;
    case 'E':
      width = 1.3;
      height = 0.28 + open * 0.6;
      break;
    case 'O':
      width = 0.85;
      height = 0.45 + open * 0.78;
      break;
    default:
      width = smileFactor > 0.3 ? 1.15 : 0.8;
      height = 0.05;
      break;
  }

  face.mouthCavity.visible = open > 0.08;
  face.mouthCavity.scale.set(width, height, 1);
  face.mouthUpperLip.position.y = 0.003 + height * 0.012;
  face.mouthLowerLip.position.y = -0.003 - height * 0.012;
}

export function applyEmotionFace(
  face: AvatarRigHandles['face'],
  emotion: AvatarEmotion,
  blinkAmount: number,
  params: {
    eyeSquint: number;
    eyeWidening: number;
    browTilt: number;
    browRaise: number;
    blushIntensity: number;
  }
): void {
  const topDrop = Math.max(blinkAmount, params.eyeSquint * 0.65);
  const bottomLift = params.eyeSquint * 0.45;

  const isBrightHappy =
    (emotion === AvatarEmotion.HAPPY || emotion === AvatarEmotion.LOVE) &&
    blinkAmount < 0.2;

  face.happyArcL.visible = isBrightHappy;
  face.happyArcR.visible = isBrightHappy;
  face.irisL.visible = !isBrightHappy;
  face.irisR.visible = !isBrightHappy;

  face.eyelidTopL.position.y = THREE.MathUtils.lerp(0.052, 0.012, topDrop);
  face.eyelidTopR.position.y = THREE.MathUtils.lerp(0.052, 0.012, topDrop);
  face.eyelidBottomL.position.y = THREE.MathUtils.lerp(-0.046, -0.02, bottomLift);
  face.eyelidBottomR.position.y = THREE.MathUtils.lerp(-0.046, -0.02, bottomLift);

  const irisScale = 1 + params.eyeWidening * 0.16;
  face.irisL.scale.set(0.9 * irisScale, 1.14 * irisScale, 1);
  face.irisR.scale.set(0.9 * irisScale, 1.14 * irisScale, 1);

  face.browL.rotation.z = -params.browTilt;
  face.browR.rotation.z = params.browTilt;
  face.browL.position.y = 0.046 + params.browRaise * 0.012;
  face.browR.position.y = 0.046 + params.browRaise * 0.012;

  (face.blushL.material as THREE.MeshBasicMaterial).opacity = params.blushIntensity * 0.85;
  (face.blushR.material as THREE.MeshBasicMaterial).opacity = params.blushIntensity * 0.85;
}
