export const DEFAULT_VRM_URL = '/models/VRM1_Constraint_Twist_Sample.vrm';
export const NEURO_PINK_VRM_URL = '/models/neuro_chan_default.vrm';
export const AQUA_VRM_URL = '/models/neuro_cyber_aqua.vrm';
export const TARGET_AVATAR_HEIGHT_M = 1.58;

export interface VrmPresetItem {
  id: string;
  label: string;
  url: string;
  badge: string;
}

export const VRM_PRESETS: VrmPresetItem[] = [
  {
    id: 'vrm1_twist_default',
    label: 'VRM1 Constraint Twist (Default)',
    url: DEFAULT_VRM_URL,
    badge: 'Local VRM 1.0',
  },
  {
    id: 'neuro_pink',
    label: 'Pink Twin-Tail Preset',
    url: NEURO_PINK_VRM_URL,
    badge: 'Local VRM 1.0',
  },
  {
    id: 'neuro_aqua',
    label: 'Aqua Twin-Tail Preset',
    url: AQUA_VRM_URL,
    badge: 'Local VRM 1.0',
  },
];

export interface VrmNormalizationTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

export interface VrmUrlValidationResult {
  valid: boolean;
  normalizedUrl: string;
  error?: string;
}

/**
 * Validates user-provided VRM model URLs before passing them to GLTFLoader.
 */
export function validateVrmUrlInput(rawUrl: string): VrmUrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Please enter a .vrm or .glb model URL.',
    };
  }

  if (trimmed.startsWith('models/')) {
    return {valid: true, normalizedUrl: `/${trimmed}`};
  }

  // Allow relative paths (e.g. /models/neuro_chan_default.vrm) and blob URLs
  if (trimmed.startsWith('/') || trimmed.startsWith('blob:')) {
    return {valid: true, normalizedUrl: trimmed};
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        normalizedUrl: '',
        error: `Unsupported URL protocol "${parsed.protocol}". Use https://, http://, or a local /models/... path.`,
      };
    }
    return {valid: true, normalizedUrl: parsed.toString()};
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Invalid URL format. Example: https://example.com/avatar.vrm',
    };
  }
}

/**
 * Returns the same-origin proxy URL when loading external cross-origin VRM URLs
 * so remote avatars without permissive CORS headers still load in WebGL.
 */
export function resolveVrmProxyUrl(url: string, currentOrigin?: string): string {
  if (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (currentOrigin && parsed.origin === currentOrigin) {
      return url;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `/api/proxy-vrm?url=${encodeURIComponent(parsed.toString())}`;
    }
  } catch {
    // Fall through
  }
  return url;
}

/**
 * Computes uniform scale and translation offset from a VRM bounding box so any
 * user-uploaded VRM stands cleanly centered on the stage dais at y = 0.
 */
export function computeVrmNormalization(bounds: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  targetHeight?: number;
}): VrmNormalizationTransform {
  const height = Math.max(0.01, bounds.maxY - bounds.minY);
  const targetHeight = bounds.targetHeight ?? TARGET_AVATAR_HEIGHT_M;
  const scale = THREE_CLAMP(targetHeight / height, 0.2, 4.0);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;

  return {
    scale,
    offsetX: -centerX * scale || 0,
    offsetY: -bounds.minY * scale || 0,
    offsetZ: -centerZ * scale || 0,
  };
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
