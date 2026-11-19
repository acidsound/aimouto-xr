import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';

/**
 * Generates a real, spec-compliant VRM 1.0 binary file (`public/models/neuro_chan_default.vrm`)
 * with:
 * - Full VRMHumanBoneName skeleton in canonical T-pose (+Z forward)
 * - Skinned torso, bolero jacket, pleated skirt, arms, legs, and flowing twintails
 * - Embedded PNG textures (anime iris, cheek blush, cyber-idol fabric)
 * - Morph target facial expressions (`aa`, `ih`, `ou`, `ee`, `oh`, `blink`, `happy`, `angry`, `sad`, `relaxed`, `surprised`)
 * - VRMC_vrm + VRMC_springBone extensions
 */

// --- Minimal Pure-Node PNG Encoder (RGBA -> PNG Buffer) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([len, payload, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const compressed = zlib.deflateSync(raw, {level: 6});
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIrisPng(): Buffer {
  const w = 128;
  const h = 128;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      const r = Math.hypot(dx, dy);

      let cr = 72;
      let cg = 148;
      let cb = 255;
      let ca = 255;

      if (r > 0.96) {
        cr = 255;
        cg = 255;
        cb = 255;
      } else if (r > 0.84) {
        cr = 20;
        cg = 26;
        cb = 64;
      } else if (r < 0.34) {
        cr = 14;
        cg = 16;
        cb = 42;
      } else {
        const t = (y / h);
        cr = Math.round(44 + t * 75);
        cg = Math.round(92 + t * 140);
        cb = 255;
      }

      // Specular anime catchlights
      const hl1 = Math.hypot(dx + 0.32, dy + 0.32);
      const hl2 = Math.hypot(dx - 0.3, dy - 0.3);
      if (hl1 < 0.2 || hl2 < 0.11) {
        cr = 255;
        cg = 255;
        cb = 255;
      }

      rgba[idx] = cr;
      rgba[idx + 1] = cg;
      rgba[idx + 2] = cb;
      rgba[idx + 3] = ca;
    }
  }
  return encodeRgbaPng(w, h, rgba);
}

function makeDressFabricPng(): Buffer {
  const w = 128;
  const h = 128;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      let cr = 27;
      let cg = 33;
      let cb = 71;
      if ((x + y) % 10 === 0) {
        cr += 8;
        cg += 8;
        cb += 12;
      }
      if (y >= 106 && y <= 112) {
        cr = 255;
        cg = 107;
        cb = 168;
      } else if (y >= 115 && y <= 120) {
        cr = 75;
        cg = 227;
        cb = 255;
      }
      rgba[idx] = cr;
      rgba[idx + 1] = cg;
      rgba[idx + 2] = cb;
      rgba[idx + 3] = 255;
    }
  }
  return encodeRgbaPng(w, h, rgba);
}

function makeBlushPng(): Buffer {
  const w = 64;
  const h = 32;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      const d = Math.hypot(dx, dy);
      const alpha = Math.max(0, 1 - d) * 0.72;
      rgba[idx] = 255;
      rgba[idx + 1] = 104;
      rgba[idx + 2] = 158;
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }
  return encodeRgbaPng(w, h, rgba);
}

// --- GLTF / GLB Binary Builder ---
interface GltfNode {
  name: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
  mesh?: number;
  skin?: number;
}

class GlbBuilder {
  nodes: GltfNode[] = [];
  meshes: Array<Record<string, unknown>> = [];
  materials: Array<Record<string, unknown>> = [];
  textures: Array<Record<string, unknown>> = [];
  images: Array<Record<string, unknown>> = [];
  samplers = [{magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497}];
  skins: Array<Record<string, unknown>> = [];
  accessors: Array<Record<string, unknown>> = [];
  bufferViews: Array<Record<string, unknown>> = [];
  binChunks: Buffer[] = [];
  binLength = 0;

  appendBuffer(data: Uint8Array | Buffer, target?: number): number {
    const pad = (4 - (this.binLength % 4)) % 4;
    if (pad > 0) {
      this.binChunks.push(Buffer.alloc(pad));
      this.binLength += pad;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const viewIndex = this.bufferViews.length;
    const view: Record<string, unknown> = {
      buffer: 0,
      byteOffset: this.binLength,
      byteLength: buf.length,
    };
    if (target !== undefined) view.target = target;
    this.bufferViews.push(view);
    this.binChunks.push(buf);
    this.binLength += buf.length;
    return viewIndex;
  }

  addAccessor(
    bufferView: number,
    componentType: number,
    count: number,
    type: string,
    min?: number[],
    max?: number[]
  ): number {
    const idx = this.accessors.length;
    const acc: Record<string, unknown> = {
      bufferView,
      componentType,
      count,
      type,
    };
    if (min) acc.min = min;
    if (max) acc.max = max;
    this.accessors.push(acc);
    return idx;
  }

  addPngTexture(pngBuf: Buffer, name: string): number {
    const viewIdx = this.appendBuffer(pngBuf);
    const imgIdx = this.images.length;
    this.images.push({name, mimeType: 'image/png', bufferView: viewIdx});
    const texIdx = this.textures.length;
    this.textures.push({sampler: 0, source: imgIdx});
    return texIdx;
  }

  addMaterial(opts: {
    name: string;
    baseColorFactor?: [number, number, number, number];
    baseColorTexture?: number;
    emissiveFactor?: [number, number, number];
    roughnessFactor?: number;
    metallicFactor?: number;
    alphaMode?: 'OPAQUE' | 'BLEND' | 'MASK';
    doubleSided?: boolean;
  }): number {
    const idx = this.materials.length;
    const pbr: Record<string, unknown> = {
      roughnessFactor: opts.roughnessFactor ?? 0.65,
      metallicFactor: opts.metallicFactor ?? 0.04,
    };
    if (opts.baseColorFactor) pbr.baseColorFactor = opts.baseColorFactor;
    if (opts.baseColorTexture !== undefined) {
      pbr.baseColorTexture = {index: opts.baseColorTexture};
    }
    const mat: Record<string, unknown> = {
      name: opts.name,
      pbrMetallicRoughness: pbr,
    };
    if (opts.emissiveFactor) mat.emissiveFactor = opts.emissiveFactor;
    if (opts.alphaMode) mat.alphaMode = opts.alphaMode;
    if (opts.doubleSided) mat.doubleSided = true;
    this.materials.push(mat);
    return idx;
  }

  addNode(node: GltfNode, parentIndex?: number): number {
    const idx = this.nodes.length;
    this.nodes.push(node);
    if (parentIndex !== undefined) {
      const parent = this.nodes[parentIndex];
      parent.children = parent.children ?? [];
      parent.children.push(idx);
    }
    return idx;
  }

  addGeometryMesh(opts: {
    name: string;
    geometry: THREE.BufferGeometry;
    materialIndex: number;
    skinWeights?: {
      joints: Uint16Array;
      weights: Float32Array;
    };
    morphDeltas?: Array<{
      name: string;
      deltaPositions: Float32Array;
    }>;
  }): number {
    const geo = opts.geometry.index ? opts.geometry : mergeIndices(opts.geometry);
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normAttr = geo.attributes.normal as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute | undefined;

    const posArr = new Float32Array(posAttr.array);
    const normArr = new Float32Array(normAttr.array);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posAttr.count; i++) {
      const x = posArr[i * 3];
      const y = posArr[i * 3 + 1];
      const z = posArr[i * 3 + 2];
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }

    const attributes: Record<string, number> = {
      POSITION: this.addAccessor(
        this.appendBuffer(posArr, 34962),
        5126,
        posAttr.count,
        'VEC3',
        min,
        max
      ),
      NORMAL: this.addAccessor(
        this.appendBuffer(normArr, 34962),
        5126,
        normAttr.count,
        'VEC3'
      ),
    };

    if (uvAttr) {
      const uvArr = new Float32Array(uvAttr.array);
      attributes.TEXCOORD_0 = this.addAccessor(
        this.appendBuffer(uvArr, 34962),
        5126,
        uvAttr.count,
        'VEC2'
      );
    }

    if (opts.skinWeights) {
      attributes.JOINTS_0 = this.addAccessor(
        this.appendBuffer(opts.skinWeights.joints, 34962),
        5123, // UNSIGNED_SHORT
        posAttr.count,
        'VEC4'
      );
      attributes.WEIGHTS_0 = this.addAccessor(
        this.appendBuffer(opts.skinWeights.weights, 34962),
        5126,
        posAttr.count,
        'VEC4'
      );
    }

    const indexArray = new Uint16Array(geo.index!.array);
    const indicesAcc = this.addAccessor(
      this.appendBuffer(indexArray, 34963),
      5123, // UNSIGNED_SHORT
      indexArray.length,
      'SCALAR'
    );

    const primitive: Record<string, unknown> = {
      attributes,
      indices: indicesAcc,
      material: opts.materialIndex,
    };

    const extras: Record<string, unknown> = {};
    if (opts.morphDeltas && opts.morphDeltas.length > 0) {
      primitive.targets = opts.morphDeltas.map((m) => {
        const dMin = [Infinity, Infinity, Infinity];
        const dMax = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < posAttr.count; i++) {
          const x = m.deltaPositions[i * 3];
          const y = m.deltaPositions[i * 3 + 1];
          const z = m.deltaPositions[i * 3 + 2];
          if (x < dMin[0]) dMin[0] = x;
          if (y < dMin[1]) dMin[1] = y;
          if (z < dMin[2]) dMin[2] = z;
          if (x > dMax[0]) dMax[0] = x;
          if (y > dMax[1]) dMax[1] = y;
          if (z > dMax[2]) dMax[2] = z;
        }
        return {
          POSITION: this.addAccessor(
            this.appendBuffer(m.deltaPositions, 34962),
            5126,
            posAttr.count,
            'VEC3',
            dMin,
            dMax
          ),
        };
      });
      extras.targetNames = opts.morphDeltas.map((m) => m.name);
    }

    const meshIdx = this.meshes.length;
    const meshObj: Record<string, unknown> = {
      name: opts.name,
      primitives: [primitive],
    };
    if (extras.targetNames) {
      meshObj.weights = opts.morphDeltas!.map(() => 0);
      meshObj.extras = extras;
    }
    this.meshes.push(meshObj);
    return meshIdx;
  }

  toGlb(extensionsUsed: string[], extensions: Record<string, unknown>, sceneNodes: number[]): Buffer {
    const jsonObj = {
      asset: {
        version: '2.0',
        generator: 'Neuro-XR VRM 1.0 Procedural Builder',
      },
      extensionsUsed,
      extensions,
      scene: 0,
      scenes: [{name: 'NeuroChanVRM', nodes: sceneNodes}],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      textures: this.textures,
      images: this.images,
      samplers: this.samplers,
      skins: this.skins,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{byteLength: this.binLength}],
    };

    let jsonBuf = Buffer.from(JSON.stringify(jsonObj), 'utf8');
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    if (jsonPad > 0) {
      jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
    }

    const binBuf = Buffer.concat(this.binChunks);
    const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuf.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuf.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

    return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
  }
}

function mergeIndices(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function makeSkinWeights(
  geo: THREE.BufferGeometry,
  boneNodeIndices: number[],
  weightFn: (yNorm: number, pos: THREE.Vector3) => [number, number, number, number]
): {joints: Uint16Array; weights: Float32Array} {
  const posAttr = geo.attributes.position;
  const count = posAttr.count;
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);

  geo.computeBoundingBox();
  const minY = geo.boundingBox?.min.y ?? 0;
  const maxY = geo.boundingBox?.max.y ?? 1;
  const spanY = Math.max(0.0001, maxY - minY);
  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i);
    const yNorm = (v.y - minY) / spanY;
    const w = weightFn(yNorm, v);

    joints[i * 4 + 0] = boneNodeIndices[0] ?? 0;
    joints[i * 4 + 1] = boneNodeIndices[1] ?? 0;
    joints[i * 4 + 2] = boneNodeIndices[2] ?? 0;
    joints[i * 4 + 3] = boneNodeIndices[3] ?? 0;

    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    weights[i * 4 + 0] = w[0] / sum;
    weights[i * 4 + 1] = w[1] / sum;
    weights[i * 4 + 2] = w[2] / sum;
    weights[i * 4 + 3] = w[3] / sum;
  }

  return {joints, weights};
}

type NeuroVrmVariant = 'pink' | 'aqua';

function buildDefaultNeuroVrm(variant: NeuroVrmVariant = 'pink'): Buffer {
  const builder = new GlbBuilder();
  const isAqua = variant === 'aqua';

  // --- Textures & Materials ---
  const irisTex = builder.addPngTexture(makeIrisPng(), 'iris');
  const dressTex = builder.addPngTexture(makeDressFabricPng(), 'dress_fabric');
  const blushTex = builder.addPngTexture(makeBlushPng(), 'blush');

  const mSkin = builder.addMaterial({
    name: 'Skin',
    baseColorFactor: [1.0, 0.88, 0.82, 1],
    emissiveFactor: [0.18, 0.13, 0.12],
    roughnessFactor: 0.72,
    metallicFactor: 0.01,
  });
  const mHair = builder.addMaterial({
    name: 'HairWarm',
    baseColorFactor: isAqua ? [0.35, 0.92, 0.96, 1] : [0.85, 0.56, 0.46, 1],
    emissiveFactor: isAqua ? [0.05, 0.22, 0.28] : [0.1, 0.05, 0.05],
    roughnessFactor: 0.46,
    metallicFactor: 0.04,
  });
  const mHairTip = builder.addMaterial({
    name: 'HairTip',
    baseColorFactor: isAqua ? [0.22, 0.68, 0.95, 1] : [0.74, 0.44, 0.44, 1],
    emissiveFactor: isAqua ? [0.04, 0.16, 0.28] : [0.09, 0.04, 0.05],
    roughnessFactor: 0.48,
    metallicFactor: 0.04,
  });
  const mBlouse = builder.addMaterial({
    name: 'Blouse',
    baseColorFactor: [0.96, 0.97, 1.0, 1],
    emissiveFactor: [0.14, 0.14, 0.18],
    roughnessFactor: 0.68,
    metallicFactor: 0.02,
  });
  const mDress = builder.addMaterial({
    name: 'CyberDress',
    baseColorTexture: dressTex,
    baseColorFactor: isAqua ? [0.92, 0.32, 0.68, 1] : [1, 1, 1, 1],
    emissiveFactor: isAqua ? [0.24, 0.05, 0.18] : [0.03, 0.04, 0.09],
    roughnessFactor: 0.7,
    metallicFactor: 0.06,
    doubleSided: true,
  });
  const mRibbon = builder.addMaterial({
    name: 'RibbonPink',
    baseColorFactor: isAqua ? [1.0, 0.85, 0.35, 1] : [1.0, 0.42, 0.66, 1],
    emissiveFactor: isAqua ? [0.35, 0.25, 0.05] : [0.45, 0.1, 0.28],
    roughnessFactor: 0.35,
    metallicFactor: 0.15,
  });
  const mCyberTrim = builder.addMaterial({
    name: 'CyberCyan',
    baseColorFactor: isAqua ? [1.0, 0.45, 0.82, 1] : [0.29, 0.89, 1.0, 1],
    emissiveFactor: isAqua ? [0.45, 0.1, 0.32] : [0.08, 0.42, 0.58],
    roughnessFactor: 0.28,
    metallicFactor: 0.35,
  });
  const mStocking = builder.addMaterial({
    name: 'Stocking',
    baseColorFactor: isAqua ? [0.94, 0.96, 1.0, 1] : [0.12, 0.13, 0.25, 1],
    emissiveFactor: isAqua ? [0.12, 0.13, 0.18] : [0, 0, 0],
    roughnessFactor: 0.78,
    metallicFactor: 0.05,
  });
  const mBoot = builder.addMaterial({
    name: 'Boot',
    baseColorFactor: isAqua ? [0.28, 0.12, 0.34, 1] : [0.08, 0.09, 0.17, 1],
    roughnessFactor: 0.36,
    metallicFactor: 0.2,
  });
  const mIris = builder.addMaterial({
    name: 'AnimeIris',
    baseColorTexture: irisTex,
    baseColorFactor: isAqua ? [1.0, 0.72, 0.92, 1] : [1, 1, 1, 1],
    emissiveFactor: isAqua ? [0.36, 0.14, 0.32] : [0.14, 0.28, 0.48],
    roughnessFactor: 0.25,
    metallicFactor: 0.0,
  });
  const mSclera = builder.addMaterial({
    name: 'Sclera',
    baseColorFactor: [1, 1, 1, 1],
    emissiveFactor: [0.08, 0.08, 0.1],
    roughnessFactor: 0.5,
  });
  const mLash = builder.addMaterial({
    name: 'LashDark',
    baseColorFactor: [0.12, 0.08, 0.15, 1],
    roughnessFactor: 0.55,
  });
  const mMouth = builder.addMaterial({
    name: 'MouthInterior',
    baseColorFactor: [0.62, 0.16, 0.32, 1],
    roughnessFactor: 0.5,
  });
  const mBlush = builder.addMaterial({
    name: 'CheekBlush',
    baseColorTexture: blushTex,
    baseColorFactor: [1, 1, 1, 0.75],
    alphaMode: 'BLEND',
    roughnessFactor: 0.8,
  });

  // --- Skeleton Hierarchy (VRM 1.0 T-pose, +Z forward, +X = character LEFT, -X = character RIGHT) ---
  const boneWorldPos: Record<number, [number, number, number]> = {};
  const nodeIndexByName: Record<string, number> = {};
  const jointNodes: number[] = [];

  const addBone = (
    name: string,
    parentName: string | null,
    local: [number, number, number]
  ): number => {
    const parentIdx = parentName ? nodeIndexByName[parentName] : undefined;
    const parentWorld = parentIdx !== undefined ? boneWorldPos[parentIdx] : [0, 0, 0];
    const idx = builder.addNode({name, translation: local}, parentIdx);
    nodeIndexByName[name] = idx;
    boneWorldPos[idx] = [
      parentWorld[0] + local[0],
      parentWorld[1] + local[1],
      parentWorld[2] + local[2],
    ];
    jointNodes.push(idx);
    return idx;
  };

  const rootIdx = addBone('root', null, [0, 0, 0]);
  addBone('hips', 'root', [0, 0.84, 0]);
  addBone('spine', 'hips', [0, 0.12, 0]);
  addBone('chest', 'spine', [0, 0.18, 0]);
  addBone('neck', 'chest', [0, 0.19, 0]);
  addBone('head', 'neck', [0, 0.08, 0]);

  // Eyes (+X is character left eye, -X is character right eye)
  addBone('leftEye', 'head', [0.048, 0.114, 0.12]);
  addBone('rightEye', 'head', [-0.048, 0.114, 0.12]);

  // Hair SpringBones (behind head, negative Z)
  addBone('ahogeBase', 'head', [0.02, 0.25, 0.01]);
  addBone('ahogeTip', 'ahogeBase', [0.04, 0.06, 0]);

  addBone('twinBaseL', 'head', [0.15, 0.12, -0.05]);
  addBone('twinMidL', 'twinBaseL', [0.07, -0.22, -0.03]);
  addBone('twinTipL', 'twinMidL', [0.04, -0.24, -0.02]);

  addBone('twinBaseR', 'head', [-0.15, 0.12, -0.05]);
  addBone('twinMidR', 'twinBaseR', [-0.07, -0.22, -0.03]);
  addBone('twinTipR', 'twinMidR', [-0.04, -0.24, -0.02]);

  // Left Arm (canonical T-pose extending +X)
  addBone('leftShoulder', 'chest', [0.09, 0.14, 0]);
  addBone('leftUpperArm', 'leftShoulder', [0.07, -0.01, 0]);
  addBone('leftLowerArm', 'leftUpperArm', [0.22, 0, 0]);
  addBone('leftHand', 'leftLowerArm', [0.2, 0, 0]);

  // Right Arm (canonical T-pose extending -X)
  addBone('rightShoulder', 'chest', [-0.09, 0.14, 0]);
  addBone('rightUpperArm', 'rightShoulder', [-0.07, -0.01, 0]);
  addBone('rightLowerArm', 'rightUpperArm', [-0.22, 0, 0]);
  addBone('rightHand', 'rightLowerArm', [-0.2, 0, 0]);

  // Left Leg (+X)
  addBone('leftUpperLeg', 'hips', [0.082, -0.04, 0]);
  addBone('leftLowerLeg', 'leftUpperLeg', [0, -0.37, 0]);
  addBone('leftFoot', 'leftLowerLeg', [0, -0.36, 0]);

  // Right Leg (-X)
  addBone('rightUpperLeg', 'hips', [-0.082, -0.04, 0]);
  addBone('rightLowerLeg', 'rightUpperLeg', [0, -0.37, 0]);
  addBone('rightFoot', 'rightLowerLeg', [0, -0.36, 0]);

  const jIndex = (name: string) => jointNodes.indexOf(nodeIndexByName[name]);

  // Compute inverse bind matrices for all joints
  const ibm = new Float32Array(jointNodes.length * 16);
  const mat = new THREE.Matrix4();
  for (let i = 0; i < jointNodes.length; i++) {
    const wp = boneWorldPos[jointNodes[i]];
    mat.makeTranslation(-wp[0], -wp[1], -wp[2]);
    mat.toArray(ibm, i * 16);
  }
  const ibmAcc = builder.addAccessor(
    builder.appendBuffer(ibm),
    5126,
    jointNodes.length,
    'MAT4'
  );
  const skinIdx = builder.skins.length;
  builder.skins.push({
    name: 'NeuroHumanoidSkin',
    inverseBindMatrices: ibmAcc,
    joints: jointNodes,
    skeleton: rootIdx,
  });

  // Helper to attach static geometry directly to a bone node (or skinned mesh to root)
  const attachMeshToBone = (
    boneName: string,
    meshName: string,
    geometry: THREE.BufferGeometry,
    materialIndex: number,
    translation?: [number, number, number],
    rotationEuler?: [number, number, number],
    morphDeltas?: Array<{name: string; deltaPositions: Float32Array}>
  ): number => {
    const meshIdx = builder.addGeometryMesh({
      name: meshName,
      geometry,
      materialIndex,
      morphDeltas,
    });
    const nodeOpts: GltfNode = {
      name: meshName,
      mesh: meshIdx,
    };
    if (translation) nodeOpts.translation = translation;
    if (rotationEuler) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotationEuler));
      nodeOpts.rotation = [q.x, q.y, q.z, q.w];
    }
    return builder.addNode(nodeOpts, nodeIndexByName[boneName]);
  };

  const attachSkinnedMesh = (
    meshName: string,
    geometry: THREE.BufferGeometry,
    materialIndex: number,
    skinWeights: {joints: Uint16Array; weights: Float32Array}
  ): number => {
    const meshIdx = builder.addGeometryMesh({
      name: meshName,
      geometry,
      materialIndex,
      skinWeights,
    });
    return builder.addNode(
      {name: meshName, mesh: meshIdx, skin: skinIdx},
      rootIdx
    );
  };

  // --- 1. Skinned Torso Blouse + Bolero Jacket + Pleated Skirt ---
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
  const torsoGeo = new THREE.LatheGeometry(torsoProfile, 22);
  torsoGeo.scale(1.06, 1.0, 0.78);
  attachSkinnedMesh(
    'TorsoMesh',
    torsoGeo,
    mBlouse,
    makeSkinWeights(torsoGeo, [jIndex('hips'), jIndex('spine'), jIndex('chest'), 0], (yNorm) => {
      if (yNorm < 0.35) {
        const t = yNorm / 0.35;
        return [1 - t, t, 0, 0];
      }
      const t = (yNorm - 0.35) / 0.65;
      return [0, 1 - t, t, 0];
    })
  );

  const jacketProfile = [
    new THREE.Vector2(0.102, 1.03),
    new THREE.Vector2(0.126, 1.14),
    new THREE.Vector2(0.132, 1.25),
    new THREE.Vector2(0.105, 1.31),
    new THREE.Vector2(0.068, 1.335),
  ];
  const jacketGeo = new THREE.LatheGeometry(jacketProfile, 22);
  jacketGeo.scale(1.08, 1.0, 0.81);
  attachSkinnedMesh(
    'BoleroJacketMesh',
    jacketGeo,
    mDress,
    makeSkinWeights(jacketGeo, [jIndex('spine'), jIndex('chest'), 0, 0], (yNorm) => [
      1 - yNorm,
      yNorm,
      0,
      0,
    ])
  );

  // Pleated Skirt
  const skirtGeo = new THREE.CylinderGeometry(0.108, 0.235, 0.34, 32, 6, true);
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
  attachSkinnedMesh(
    'PleatedSkirtMesh',
    skirtGeo,
    mDress,
    makeSkinWeights(
      skirtGeo,
      [jIndex('hips'), jIndex('leftUpperLeg'), jIndex('rightUpperLeg'), 0],
      (yNorm, v) => {
        const hipW = 0.45 + yNorm * 0.55;
        const legW = 1 - hipW;
        const leftBias = v.x > 0 ? 1 : 0.15;
        const rightBias = v.x <= 0 ? 1 : 0.15;
        return [hipW, legW * leftBias, legW * rightBias, 0];
      }
    )
  );

  // Waist belt & chest ribbon
  const beltGeo = new THREE.CylinderGeometry(0.104, 0.114, 0.066, 20);
  beltGeo.scale(1.06, 1.0, 0.82);
  attachMeshToBone('hips', 'WaistBelt', beltGeo, mDress, [0, 0.055, 0]);
  const beltGem = new THREE.OctahedronGeometry(0.018, 0);
  attachMeshToBone('hips', 'BeltGem', beltGem, mCyberTrim, [0, 0.055, 0.095]);

  const collarGeo = new THREE.TorusGeometry(0.072, 0.014, 8, 20);
  attachMeshToBone('chest', 'CollarTrim', collarGeo, mCyberTrim, [0, 0.17, 0.01], [Math.PI / 2 - 0.15, 0, 0]);
  const bowL = new THREE.ConeGeometry(0.024, 0.062, 5);
  attachMeshToBone('chest', 'ChestBowL', bowL, mRibbon, [0.032, 0.135, 0.095], [0, 0, -Math.PI / 2.2]);
  attachMeshToBone('chest', 'ChestBowR', bowL, mRibbon, [-0.032, 0.135, 0.095], [0, 0, Math.PI / 2.2]);

  // Neck
  attachMeshToBone('neck', 'NeckMesh', new THREE.CylinderGeometry(0.038, 0.044, 0.11, 14), mSkin, [0, 0.04, 0]);

  // --- 2. Skinned Flowing Twintails (L = +X, R = -X) ---
  for (const side of [1, -1] as const) {
    const tag = side > 0 ? 'L' : 'R';
    const profile = [
      new THREE.Vector2(0.005, -0.52),
      new THREE.Vector2(0.036, -0.4),
      new THREE.Vector2(0.06, -0.24),
      new THREE.Vector2(0.054, -0.1),
      new THREE.Vector2(0.036, 0.02),
      new THREE.Vector2(0.005, 0.05),
    ];
    const geo = new THREE.LatheGeometry(profile, 14);
    const baseX = side * 0.15;
    const baseY = 1.53;
    const baseZ = -0.05;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const t = Math.max(0, -py / 0.52);
      pos.setX(i, pos.getX(i) + baseX + side * t * 0.11);
      pos.setY(i, py + baseY);
      pos.setZ(i, pos.getZ(i) + baseZ - t * 0.05);
    }
    geo.computeVertexNormals();
    attachSkinnedMesh(
      `Twintail${tag}`,
      geo,
      mHairTip,
      makeSkinWeights(
        geo,
        [jIndex(`twinBase${tag}`), jIndex(`twinMid${tag}`), jIndex(`twinTip${tag}`), 0],
        (yNorm) => {
          const down = 1 - yNorm;
          if (down < 0.5) {
            const t = down / 0.5;
            return [1 - t, t, 0, 0];
          }
          const t = (down - 0.5) / 0.5;
          return [0, 1 - t, t, 0];
        }
      )
    );
    attachMeshToBone(
      `twinBase${tag}`,
      `HairTie${tag}`,
      new THREE.TorusGeometry(0.036, 0.011, 8, 16),
      mRibbon,
      [0, 0, 0],
      [0, Math.PI / 2, 0]
    );
  }

  // Ahoge
  const ahogeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.015, 0.045, 0.01),
    new THREE.Vector3(0.055, 0.075, 0),
    new THREE.Vector3(0.08, 0.055, -0.01),
  ]);
  attachMeshToBone('ahogeBase', 'Ahoge', new THREE.TubeGeometry(ahogeCurve, 12, 0.008, 8, false), mHair);

  // --- 3. Sculpted Anime Head & Facial Morph Target Meshes ---
  const craniumGeo = new THREE.SphereGeometry(0.132, 26, 22);
  const cPos = craniumGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i);
    const y = cPos.getY(i);
    const z = cPos.getZ(i);
    let nx = x;
    const ny = y * 1.06;
    let nz = z * 0.96;
    if (y < -0.02) {
      const chinT = Math.min(1, (-y - 0.02) / 0.11);
      nx *= 1 - chinT * 0.36;
      if (z > 0) nz *= 1 - chinT * 0.14;
    }
    cPos.setXYZ(i, nx, ny, nz);
  }
  craniumGeo.computeVertexNormals();
  attachMeshToBone('head', 'HeadCranium', craniumGeo, mSkin, [0, 0.11, 0]);
  attachMeshToBone('head', 'NoseTip', new THREE.ConeGeometry(0.008, 0.016, 8), mSkin, [0, 0.088, 0.128], [Math.PI / 2, 0, 0]);

  const hairCapGeo = new THREE.SphereGeometry(0.139, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hairCapGeo.scale(1.03, 1.06, 1.01);
  attachMeshToBone('head', 'HairCap', hairCapGeo, mHair, [0, 0.124, -0.008], [-0.22, 0, 0]);

  const hairBackGeo = new THREE.SphereGeometry(0.142, 20, 14, Math.PI * 0.68, Math.PI * 1.64, 0.25, Math.PI * 0.72);
  attachMeshToBone('head', 'HairBack', hairBackGeo, mHair, [0, 0.115, -0.01]);

  const bangGeo = new THREE.ConeGeometry(0.032, 0.115, 8);
  bangGeo.scale(1, 1, 0.35);
  for (const b of [
    {x: -0.075, y: 0.178, z: 0.118, rz: -0.22, rx: -0.26},
    {x: -0.038, y: 0.184, z: 0.128, rz: -0.08, rx: -0.22},
    {x: 0, y: 0.188, z: 0.132, rz: 0.03, rx: -0.2},
    {x: 0.038, y: 0.184, z: 0.128, rz: 0.1, rx: -0.22},
    {x: 0.075, y: 0.178, z: 0.118, rz: 0.22, rx: -0.26},
  ]) {
    attachMeshToBone('head', `Bang_${b.x}`, bangGeo, mHair, [b.x, b.y, b.z], [Math.PI + b.rx, 0, b.rz]);
  }

  const sideLockGeo = new THREE.ConeGeometry(0.025, 0.21, 8);
  sideLockGeo.scale(0.9, 1, 0.55);
  attachMeshToBone('head', 'SideLockL', sideLockGeo, mHair, [0.115, 0.07, 0.055], [Math.PI - 0.08, 0, 0.1]);
  attachMeshToBone('head', 'SideLockR', sideLockGeo, mHair, [-0.115, 0.07, 0.055], [Math.PI - 0.08, 0, -0.1]);

  // Cyber Headset
  attachMeshToBone('head', 'HeadsetBand', new THREE.TorusGeometry(0.145, 0.011, 8, 24, Math.PI * 1.05), mBoot, [0, 0.135, 0], [0, 0, -Math.PI * 0.025]);
  attachMeshToBone('head', 'HeadsetL', new THREE.CylinderGeometry(0.028, 0.028, 0.018, 16), mCyberTrim, [0.145, 0.12, -0.01], [0, 0, Math.PI / 2]);
  attachMeshToBone('head', 'HeadsetR', new THREE.CylinderGeometry(0.028, 0.028, 0.018, 16), mCyberTrim, [-0.145, 0.12, -0.01], [0, 0, Math.PI / 2]);

  // Eyes (irises on eye bones so VRMLookAt rotates them automatically!)
  const scleraGeo = new THREE.CircleGeometry(0.03, 18);
  scleraGeo.scale(0.96, 1.16, 1);
  attachMeshToBone('head', 'ScleraL', scleraGeo, mSclera, [0.048, 0.114, 0.119], [0, 0.22, 0]);
  attachMeshToBone('head', 'ScleraR', scleraGeo, mSclera, [-0.048, 0.114, 0.119], [0, -0.22, 0]);

  const irisGeo = new THREE.CircleGeometry(0.0235, 18);
  irisGeo.scale(0.92, 1.12, 1);
  attachMeshToBone('leftEye', 'IrisL', irisGeo, mIris, [0, -0.002, 0.002], [0, 0.22, 0]);
  attachMeshToBone('rightEye', 'IrisR', irisGeo, mIris, [0, -0.002, 0.002], [0, -0.22, 0]);

  const lashGeo = new THREE.TorusGeometry(0.031, 0.0052, 6, 16, Math.PI * 0.92);
  attachMeshToBone('head', 'UpperLashL', lashGeo, mLash, [0.048, 0.118, 0.125], [0, 0.22, Math.PI * 0.04]);
  attachMeshToBone('head', 'UpperLashR', lashGeo, mLash, [-0.048, 0.118, 0.125], [0, -0.22, Math.PI * 0.04]);

  // Expressive anime eyebrows
  const browGeo = new THREE.BoxGeometry(0.046, 0.0055, 0.005);
  attachMeshToBone('head', 'BrowL', browGeo, mLash, [0.048, 0.156, 0.123], [0, 0.22, -0.06]);
  attachMeshToBone('head', 'BrowR', browGeo, mLash, [-0.048, 0.156, 0.123], [0, -0.22, 0.06]);

  // Cheek blush
  const blushGeo = new THREE.PlaneGeometry(0.044, 0.022);
  attachMeshToBone('head', 'BlushL', blushGeo, mBlush, [0.065, 0.078, 0.116], [0, 0.36, 0]);
  attachMeshToBone('head', 'BlushR', blushGeo, mBlush, [-0.065, 0.078, 0.116], [0, -0.36, 0]);

  // Eyelids with Blink + Happy + Surprised + Angry + Sad morph targets!
  const buildEyelidMorphs = (geo: THREE.BufferGeometry) => {
    const count = geo.attributes.position.count;
    const basePos = geo.attributes.position.array;
    const mk = (fn: (i: number, x: number, y: number, z: number) => [number, number, number]) => {
      const d = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const [dx, dy, dz] = fn(i, basePos[i * 3], basePos[i * 3 + 1], basePos[i * 3 + 2]);
        d[i * 3] = dx;
        d[i * 3 + 1] = dy;
        d[i * 3 + 2] = dz;
      }
      return d;
    };
    return [
      {name: 'blink', deltaPositions: mk(() => [0, -0.048, 0.001])},
      {name: 'happy', deltaPositions: mk(() => [0, -0.028, 0.001])},
      {name: 'relaxed', deltaPositions: mk(() => [0, -0.032, 0.001])},
      {name: 'surprised', deltaPositions: mk(() => [0, 0.012, 0])},
      {name: 'angry', deltaPositions: mk((_i, x) => [0, -0.018 - x * 0.18, 0.001])},
      {name: 'sad', deltaPositions: mk((_i, x) => [0, -0.016 + x * 0.18, 0.001])},
    ];
  };

  const lidGeo = new THREE.PlaneGeometry(0.056, 0.048);
  const lidNodeL = attachMeshToBone(
    'head',
    'EyelidL',
    lidGeo,
    mSkin,
    [0.048, 0.158, 0.123],
    [0, 0.22, 0],
    buildEyelidMorphs(lidGeo)
  );
  const lidNodeR = attachMeshToBone(
    'head',
    'EyelidR',
    lidGeo,
    mSkin,
    [-0.048, 0.158, 0.123],
    [0, -0.22, 0],
    buildEyelidMorphs(lidGeo)
  );

  // Articulated Mouth with Viseme Morph Targets (`aa`, `ih`, `ou`, `ee`, `oh`, `happy`, `sad`, `surprised`)
  const mouthGeo = new THREE.CircleGeometry(0.015, 16);
  mouthGeo.scale(1.0, 0.15, 1.0); // Closed line by default
  const mCount = mouthGeo.attributes.position.count;
  const mBase = mouthGeo.attributes.position.array;
  const mkMouthMorph = (sx: number, sy: number, dyOffset = 0) => {
    const d = new Float32Array(mCount * 3);
    for (let i = 0; i < mCount; i++) {
      const bx = mBase[i * 3];
      const by = mBase[i * 3 + 1];
      d[i * 3] = bx * (sx - 1);
      d[i * 3 + 1] = by * (sy - 1) + dyOffset;
      d[i * 3 + 2] = 0;
    }
    return d;
  };
  const mouthNode = attachMeshToBone(
    'head',
    'MouthVisemeMesh',
    mouthGeo,
    mMouth,
    [0, 0.054, 0.125],
    [0, 0, 0],
    [
      {name: 'aa', deltaPositions: mkMouthMorph(1.15, 6.2)},
      {name: 'ih', deltaPositions: mkMouthMorph(1.42, 3.0)},
      {name: 'ou', deltaPositions: mkMouthMorph(0.65, 5.2)},
      {name: 'ee', deltaPositions: mkMouthMorph(1.32, 3.6)},
      {name: 'oh', deltaPositions: mkMouthMorph(0.9, 6.4)},
      {name: 'happy', deltaPositions: mkMouthMorph(1.25, 2.8, 0.002)},
      {name: 'sad', deltaPositions: mkMouthMorph(0.85, 1.4, -0.003)},
      {name: 'surprised', deltaPositions: mkMouthMorph(0.85, 6.0)},
    ]
  );

  // --- 4. T-Pose Arms (along +X for Left, -X for Right) ---
  for (const side of [1, -1] as const) {
    const bonePrefix = side > 0 ? 'left' : 'right';
    const rotZ = side > 0 ? -Math.PI / 2 : Math.PI / 2;

    // Shoulder cap + sleeve along ±X
    attachMeshToBone(`${bonePrefix}UpperArm`, `ShoulderCap_${bonePrefix}`, new THREE.SphereGeometry(0.037, 12, 10), mDress);
    const sleeveGeo = new THREE.CylinderGeometry(0.036, 0.031, 0.12, 12);
    attachMeshToBone(`${bonePrefix}UpperArm`, `Sleeve_${bonePrefix}`, sleeveGeo, mDress, [side * 0.06, 0, 0], [0, 0, rotZ]);
    const upperSkinGeo = new THREE.CylinderGeometry(0.025, 0.022, 0.1, 12);
    attachMeshToBone(`${bonePrefix}UpperArm`, `UpperArmSkin_${bonePrefix}`, upperSkinGeo, mSkin, [side * 0.17, 0, 0], [0, 0, rotZ]);

    attachMeshToBone(`${bonePrefix}LowerArm`, `Elbow_${bonePrefix}`, new THREE.SphereGeometry(0.022, 10, 10), mSkin);
    const forearmGeo = new THREE.CylinderGeometry(0.022, 0.018, 0.18, 12);
    attachMeshToBone(`${bonePrefix}LowerArm`, `Forearm_${bonePrefix}`, forearmGeo, mSkin, [side * 0.095, 0, 0], [0, 0, rotZ]);
    const cuffGeo = new THREE.CylinderGeometry(0.024, 0.025, 0.032, 14);
    attachMeshToBone(`${bonePrefix}LowerArm`, `Cuff_${bonePrefix}`, cuffGeo, mCyberTrim, [side * 0.185, 0, 0], [0, 0, rotZ]);

    attachMeshToBone(`${bonePrefix}Hand`, `Palm_${bonePrefix}`, new THREE.BoxGeometry(0.044, 0.022, 0.032), mSkin, [side * 0.022, 0, 0]);
    attachMeshToBone(`${bonePrefix}Hand`, `Fingers_${bonePrefix}`, new THREE.BoxGeometry(0.034, 0.018, 0.03), mSkin, [side * 0.056, 0, 0]);
  }

  // --- 5. Legs, Thigh-High Stockings & Cyber-Idol Boots (-Y) ---
  for (const side of [1, -1] as const) {
    const bonePrefix = side > 0 ? 'left' : 'right';
    attachMeshToBone(`${bonePrefix}UpperLeg`, `ThighSkin_${bonePrefix}`, new THREE.CylinderGeometry(0.052, 0.043, 0.21, 14), mSkin, [0, -0.11, 0]);
    attachMeshToBone(`${bonePrefix}UpperLeg`, `ThighSock_${bonePrefix}`, new THREE.CylinderGeometry(0.044, 0.038, 0.16, 14), mStocking, [0, -0.285, 0]);
    attachMeshToBone(`${bonePrefix}UpperLeg`, `Garter_${bonePrefix}`, new THREE.TorusGeometry(0.044, 0.006, 8, 16), mRibbon, [0, -0.21, 0], [Math.PI / 2, 0, 0]);

    attachMeshToBone(`${bonePrefix}LowerLeg`, `Knee_${bonePrefix}`, new THREE.SphereGeometry(0.037, 10, 10), mStocking);
    attachMeshToBone(`${bonePrefix}LowerLeg`, `ShinSock_${bonePrefix}`, new THREE.CylinderGeometry(0.038, 0.031, 0.22, 14), mStocking, [0, -0.11, 0]);
    attachMeshToBone(`${bonePrefix}LowerLeg`, `BootShaft_${bonePrefix}`, new THREE.CylinderGeometry(0.039, 0.036, 0.16, 14), mBoot, [0, -0.28, 0]);
    attachMeshToBone(`${bonePrefix}LowerLeg`, `BootTrim_${bonePrefix}`, new THREE.TorusGeometry(0.04, 0.0055, 8, 16), mCyberTrim, [0, -0.205, 0], [Math.PI / 2, 0, 0]);

    attachMeshToBone(`${bonePrefix}Foot`, `BootUpper_${bonePrefix}`, new THREE.BoxGeometry(0.068, 0.056, 0.14), mBoot, [0, -0.028, 0.036]);
    attachMeshToBone(`${bonePrefix}Foot`, `BootSole_${bonePrefix}`, new THREE.BoxGeometry(0.074, 0.022, 0.15), mCyberTrim, [0, -0.059, 0.036]);
  }

  // --- VRM 1.0 Extensions (`VRMC_vrm` + `VRMC_springBone`) ---
  const humanBones: Record<string, {node: number}> = {};
  for (const name of [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'leftEye',
    'rightEye',
    'leftShoulder',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightShoulder',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
  ]) {
    humanBones[name] = {node: nodeIndexByName[name]};
  }

  const vrmcVrm = {
    specVersion: '1.0',
    meta: {
      name: isAqua ? 'Neuro-XR Aqua Idol' : 'Neuro-XR Cyber Idol',
      version: '1.0.0',
      authors: ['Neuro-XR Studio'],
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      commercialUsage: 'personalNonCommercial',
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      creditNotation: 'unnecessary',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
    },
    humanoid: {humanBones},
    firstPerson: {},
    lookAt: {
      offsetFromHeadBone: [0, 0.114, 0],
      type: 'bone',
      rangeMapHorizontalInner: {inputMaxValue: 90, outputScale: 10},
      rangeMapHorizontalOuter: {inputMaxValue: 90, outputScale: 10},
      rangeMapVerticalDown: {inputMaxValue: 90, outputScale: 10},
      rangeMapVerticalUp: {inputMaxValue: 90, outputScale: 10},
    },
    expressions: {
      preset: {
        aa: {morphTargetBinds: [{node: mouthNode, index: 0, weight: 1}], overrideMouth: 'block'},
        ih: {morphTargetBinds: [{node: mouthNode, index: 1, weight: 1}], overrideMouth: 'block'},
        ou: {morphTargetBinds: [{node: mouthNode, index: 2, weight: 1}], overrideMouth: 'block'},
        ee: {morphTargetBinds: [{node: mouthNode, index: 3, weight: 1}], overrideMouth: 'block'},
        oh: {morphTargetBinds: [{node: mouthNode, index: 4, weight: 1}], overrideMouth: 'block'},
        blink: {
          morphTargetBinds: [
            {node: lidNodeL, index: 0, weight: 1},
            {node: lidNodeR, index: 0, weight: 1},
          ],
          overrideBlink: 'block',
        },
        blinkLeft: {morphTargetBinds: [{node: lidNodeL, index: 0, weight: 1}]},
        blinkRight: {morphTargetBinds: [{node: lidNodeR, index: 0, weight: 1}]},
        happy: {
          morphTargetBinds: [
            {node: lidNodeL, index: 1, weight: 1},
            {node: lidNodeR, index: 1, weight: 1},
            {node: mouthNode, index: 5, weight: 1},
          ],
        },
        angry: {
          morphTargetBinds: [
            {node: lidNodeL, index: 4, weight: 1},
            {node: lidNodeR, index: 4, weight: 1},
          ],
        },
        sad: {
          morphTargetBinds: [
            {node: lidNodeL, index: 5, weight: 1},
            {node: lidNodeR, index: 5, weight: 1},
            {node: mouthNode, index: 6, weight: 1},
          ],
        },
        relaxed: {
          morphTargetBinds: [
            {node: lidNodeL, index: 2, weight: 1},
            {node: lidNodeR, index: 2, weight: 1},
            {node: mouthNode, index: 5, weight: 0.65},
          ],
        },
        surprised: {
          morphTargetBinds: [
            {node: lidNodeL, index: 3, weight: 1},
            {node: lidNodeR, index: 3, weight: 1},
            {node: mouthNode, index: 7, weight: 1},
          ],
        },
      },
    },
  };

  const vrmcSpringBone = {
    specVersion: '1.0',
    springs: [
      {
        name: 'TwintailLeft',
        joints: [
          {node: nodeIndexByName.twinBaseL, stiffness: 0.9, gravityPower: 0.3, dragForce: 0.45, hitRadius: 0.04},
          {node: nodeIndexByName.twinMidL, stiffness: 0.75, gravityPower: 0.35, dragForce: 0.45, hitRadius: 0.04},
          {node: nodeIndexByName.twinTipL, stiffness: 0.6, gravityPower: 0.35, dragForce: 0.45, hitRadius: 0.03},
        ],
      },
      {
        name: 'TwintailRight',
        joints: [
          {node: nodeIndexByName.twinBaseR, stiffness: 0.9, gravityPower: 0.3, dragForce: 0.45, hitRadius: 0.04},
          {node: nodeIndexByName.twinMidR, stiffness: 0.75, gravityPower: 0.35, dragForce: 0.45, hitRadius: 0.04},
          {node: nodeIndexByName.twinTipR, stiffness: 0.6, gravityPower: 0.35, dragForce: 0.45, hitRadius: 0.03},
        ],
      },
      {
        name: 'Ahoge',
        joints: [
          {node: nodeIndexByName.ahogeBase, stiffness: 1.35, gravityPower: 0.05, dragForce: 0.35, hitRadius: 0.02},
          {node: nodeIndexByName.ahogeTip, stiffness: 1.1, gravityPower: 0.05, dragForce: 0.35, hitRadius: 0.02},
        ],
      },
    ],
  };

  return builder.toGlb(
    ['VRMC_vrm', 'VRMC_springBone'],
    {VRMC_vrm: vrmcVrm, VRMC_springBone: vrmcSpringBone},
    [rootIdx]
  );
}

const outDir = path.resolve(process.cwd(), 'public/models');
fs.mkdirSync(outDir, {recursive: true});

const defaultPath = path.join(outDir, 'neuro_chan_default.vrm');
const defaultGlb = buildDefaultNeuroVrm('pink');
fs.writeFileSync(defaultPath, defaultGlb);
console.log(`Generated VRM 1.0 model: ${defaultPath} (${defaultGlb.length} bytes)`);

const aquaPath = path.join(outDir, 'neuro_cyber_aqua.vrm');
const aquaGlb = buildDefaultNeuroVrm('aqua');
fs.writeFileSync(aquaPath, aquaGlb);
console.log(`Generated VRM 1.0 model: ${aquaPath} (${aquaGlb.length} bytes)`);
