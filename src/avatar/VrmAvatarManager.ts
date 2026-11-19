import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRM, VRMLoaderPlugin, VRMUtils} from '@pixiv/three-vrm';
import {
  computeVrmNormalization,
  DEFAULT_VRM_URL,
  resolveVrmProxyUrl,
  validateVrmUrlInput,
} from './vrmUtils';

export interface LoadedVrmInfo {
  name: string;
  specVersion: string;
  sourceLabel: string;
  sourceUrl: string;
  expressionCount: number;
  springChainCount: number;
  humanBoneCount: number;
  isDefault: boolean;
}

export interface VrmRenderQualityOptions {
  maxAnisotropy: number;
  enableAlphaToCoverage: boolean;
}

function upgradeTextureSampling(tex: unknown, maxAnisotropy: number): void {
  if (!tex || typeof tex !== 'object') return;
  const texture = tex as THREE.Texture;
  if (!texture.isTexture) return;
  texture.anisotropy = Math.max(texture.anisotropy || 1, maxAnisotropy);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = texture.generateMipmaps
    ? THREE.LinearMipmapLinearFilter
    : THREE.LinearFilter;
  texture.needsUpdate = true;
}

/**
 * Enhances texture sampling (trilinear + max anisotropy), enables MSAA
 * alphaToCoverage on cutout materials (hair/eyelashes), and prevents blocky
 * shadow-map stair-stepping across cel-shaded VRM character surfaces.
 */
export function enhanceVrmObjectQuality(
  root: THREE.Object3D,
  opts: VrmRenderQualityOptions
): void {
  const texKeys = [
    'map',
    'normalMap',
    'emissiveMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'bumpMap',
    'shadeMultiplyTexture',
    'rimMultiplyTexture',
    'matcapTexture',
    'uvAnimationMaskTexture',
    'outlineWidthMultiplyTexture',
  ];

  root.traverse((obj) => {
    obj.frustumCulled = false;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    let allOutlineOrTransparent = materials.length > 0;
    for (const mat of materials) {
      if (!mat) continue;
      const anyMat = mat as unknown as Record<string, unknown>;
      const isOutline = Boolean(
        anyMat.isOutline ||
          (typeof mat.name === 'string' && mat.name.includes('(Outline)'))
      );
      if (!isOutline && !mat.transparent) {
        allOutlineOrTransparent = false;
      }

      if (mat.alphaTest > 0 && !mat.transparent && opts.enableAlphaToCoverage) {
        mat.alphaToCoverage = true;
        mat.needsUpdate = true;
      }

      for (const key of texKeys) {
        upgradeTextureSampling(anyMat[key], opts.maxAnisotropy);
      }

      const uniforms = anyMat.uniforms as
        | Record<string, {value?: unknown}>
        | undefined;
      if (uniforms) {
        for (const uniform of Object.values(uniforms)) {
          if (uniform && typeof uniform === 'object' && 'value' in uniform) {
            upgradeTextureSampling(uniform.value, opts.maxAnisotropy);
          }
        }
      }
    }

    // Cast crisp shadows onto the stage floor, while avoiding low-res shadow-map
    // stair-stepping ("shadow acne") directly across cel-shaded VRM skin/hair.
    mesh.castShadow = !allOutlineOrTransparent;
    mesh.receiveShadow = false;
  });
}

/**
 * Manages loading, parsing (via GLTFLoader + VRMLoaderPlugin), normalizing,
 * switching, and disposing VRM 0.x / 1.0 avatars from local files or URLs.
 */
export class VrmAvatarManager {
  readonly containerGroup = new THREE.Group();
  readonly loader: GLTFLoader;

  private activeVrm: VRM | null = null;
  private activeObjectUrl: string | null = null;
  private activeInfo: LoadedVrmInfo | null = null;
  private loadSequence = 0;
  private renderQuality: VrmRenderQualityOptions = {
    maxAnisotropy: 8,
    enableAlphaToCoverage: true,
  };

  constructor() {
    this.containerGroup.name = 'VrmAvatarContainer';
    this.loader = new GLTFLoader();
    this.loader.setCrossOrigin('anonymous');
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  setRenderQuality(opts: Partial<VrmRenderQualityOptions>): void {
    this.renderQuality = {
      ...this.renderQuality,
      ...opts,
    };
    if (this.activeVrm) {
      enhanceVrmObjectQuality(this.activeVrm.scene, this.renderQuality);
    }
  }

  get vrm(): VRM | null {
    return this.activeVrm;
  }

  get info(): LoadedVrmInfo | null {
    return this.activeInfo;
  }

  async loadDefaultVrm(): Promise<{vrm: VRM; info: LoadedVrmInfo}> {
    return this.loadFromUrl(DEFAULT_VRM_URL, {
      sourceLabel: 'Default VRM1 Constraint Twist (.vrm)',
      isDefault: true,
    });
  }

  async loadFromFile(file: File): Promise<{vrm: VRM; info: LoadedVrmInfo}> {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.vrm') && !ext.endsWith('.glb') && !ext.endsWith('.gltf')) {
      throw new Error('Please upload a .vrm (or .glb/.gltf) avatar file.');
    }
    const blobUrl = URL.createObjectURL(file);
    try {
      const result = await this.loadFromUrl(blobUrl, {
        sourceLabel: file.name,
        isDefault: false,
        keepBlobUrl: true,
      });
      return result;
    } catch (error) {
      URL.revokeObjectURL(blobUrl);
      throw error;
    }
  }

  async loadFromUrl(
    rawUrl: string,
    opts?: {sourceLabel?: string; isDefault?: boolean; keepBlobUrl?: boolean}
  ): Promise<{vrm: VRM; info: LoadedVrmInfo}> {
    const validation = validateVrmUrlInput(rawUrl);
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid VRM URL.');
    }

    const requestId = ++this.loadSequence;
    const normalizedUrl = validation.normalizedUrl;

    let gltf;
    try {
      gltf = await this.loader.loadAsync(normalizedUrl);
    } catch (directError) {
      // Retry via server CORS proxy if this was a cross-origin http(s) URL
      const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
      const proxiedUrl = resolveVrmProxyUrl(normalizedUrl, origin);
      if (proxiedUrl !== normalizedUrl) {
        gltf = await this.loader.loadAsync(proxiedUrl);
      } else {
        throw directError;
      }
    }

    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm || !vrm.humanoid) {
      throw new Error(
        'Loaded GLTF/GLB does not contain valid VRM humanoid data (VRMC_vrm or VRM0).'
      );
    }

    // If a newer load superseded this one, dispose and abort swap
    if (requestId !== this.loadSequence) {
      VRMUtils.deepDispose(vrm.scene);
      throw new Error('Superseded by a newer VRM load request.');
    }

    // Optimize & normalize VRM0 -> +Z facing
    try {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
    } catch {
      // Some external VRMs skip combineSkeletons cleanly without issue
    }
    const metaVersion = String((vrm.meta as {metaVersion?: string})?.metaVersion ?? '1');
    if (metaVersion === '0') {
      VRMUtils.rotateVRM0(vrm);
    }

    enhanceVrmObjectQuality(vrm.scene, this.renderQuality);

    // Normalize scale & ground avatar boots flush at y = 0
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const norm = computeVrmNormalization({
      minX: box.min.x,
      maxX: box.max.x,
      minY: box.min.y,
      maxY: box.max.y,
      minZ: box.min.z,
      maxZ: box.max.z,
    });
    vrm.scene.scale.setScalar(norm.scale);
    vrm.scene.position.set(norm.offsetX, norm.offsetY, norm.offsetZ);
    vrm.scene.updateMatrixWorld(true);

    // Swap out previous VRM cleanly
    this.disposeActiveVrm();
    if (opts?.keepBlobUrl) {
      this.activeObjectUrl = normalizedUrl;
    }

    this.activeVrm = vrm;
    this.containerGroup.add(vrm.scene);

    const metaName =
      (vrm.meta as {name?: string; title?: string})?.name ||
      (vrm.meta as {name?: string; title?: string})?.title ||
      opts?.sourceLabel ||
      'Custom VRM Avatar';
    const expressionCount = Object.keys(
      vrm.expressionManager?.expressionMap ?? {}
    ).length;
    const springChainCount = vrm.springBoneManager?.joints?.size ?? 0;
    const humanBoneCount = Object.keys(vrm.humanoid.humanBones ?? {}).length;

    const info: LoadedVrmInfo = {
      name: String(metaName),
      specVersion: metaVersion === '0' ? 'VRM 0.x' : 'VRM 1.0',
      sourceLabel: opts?.sourceLabel ?? normalizedUrl,
      sourceUrl: opts?.keepBlobUrl ? '(Local File)' : normalizedUrl,
      expressionCount,
      springChainCount,
      humanBoneCount,
      isDefault: Boolean(opts?.isDefault),
    };
    this.activeInfo = info;

    return {vrm, info};
  }

  private disposeActiveVrm(): void {
    if (this.activeVrm) {
      this.activeVrm.scene.removeFromParent();
      VRMUtils.deepDispose(this.activeVrm.scene);
      this.activeVrm = null;
    }
    while (this.containerGroup.children.length > 0) {
      const child = this.containerGroup.children[0];
      child.removeFromParent();
    }
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
  }

  dispose(): void {
    this.disposeActiveVrm();
  }
}
