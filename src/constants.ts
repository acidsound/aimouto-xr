import {
  AvatarEmotion,
  AvatarGesture,
  OpenAICompatConfig,
  StageThemeId,
} from './types';

export const CONCEPT_UI_IMAGE_PATH =
  '/src/assets/images/fullbody_3d_anime_ui_1794853648830.jpg';

export const DEFAULT_SYSTEM_PROMPT = `You are AIMouto (from AIMouto-XR, combining AI + imouto / little sister), a witty, affectionate, playfully cheeky AI little sister companion in a cozy 3D rainy-night bedroom powered by MotionBricks whole-body motion, Rapier physics, and WebXR.
Style rules:
- Speak concisely (1-3 punchy sentences) with warm little-sister charm, playful teasing, and genuine care.
- Respond in the user's language (Korean if they speak Korean, English if English).
- Whenever appropriate, invoke your plugins (get_current_time, emotion_director, move_and_interact_room, imouto_dice_chaos, spatial_stage_control, memory_scratchpad, art_studio_canvas).
- For greetings, keep it brief and natural without listing UI controls or what features you have.
- Keep responses natural for both text bubbles and spoken TTS output (avoid raw markdown code blocks or long bullet lists).`;

export const DEFAULT_OPENAI_CONFIG: OpenAICompatConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.85,
  useProxy: true,
  customEndpoint: false,
};

export const AVATAR_PHYSICS_CONFIG = {
  massKg: 46,
  gravityY: -9.81,
  capsuleHalfHeight: 0.3,
  capsuleRadius: 0.19,
  characterCenterOffsetY: 0.51,
  jumpImpulse: 2.85,
  handColliderRadius: 0.085,
  walkAccel: 11.5,
  walkDecel: 13.0,
  weightSpringStiffness: 125,
  weightSpringDamping: 16,
} as const;

export interface EmotionVisualConfig {
  label: string;
  badgeColor: string;
  eyeSquint: number;
  eyeWidening: number;
  browTilt: number;
  browRaise: number;
  mouthSmile: number;
  blushIntensity: number;
  headTiltZ: number;
  auraColor: number;
}

export const EMOTION_PRESETS: Record<AvatarEmotion, EmotionVisualConfig> = {
  [AvatarEmotion.NEUTRAL]: {
    label: 'NEUTRAL',
    badgeColor: '#94a3b8',
    eyeSquint: 0,
    eyeWidening: 0,
    browTilt: 0,
    browRaise: 0,
    mouthSmile: 0,
    blushIntensity: 0,
    headTiltZ: 0,
    auraColor: 0x4be3ff,
  },
  [AvatarEmotion.HAPPY]: {
    label: 'HAPPY',
    badgeColor: '#4be3ff',
    eyeSquint: 0.45,
    eyeWidening: 0.1,
    browTilt: -0.05,
    browRaise: 0.25,
    mouthSmile: 0.9,
    blushIntensity: 0.6,
    headTiltZ: 0.1,
    auraColor: 0x6ef3ff,
  },
  [AvatarEmotion.TSUNDERE]: {
    label: 'TSUNDERE',
    badgeColor: '#ff6ba8',
    eyeSquint: 0.25,
    eyeWidening: 0,
    browTilt: 0.42,
    browRaise: -0.1,
    mouthSmile: -0.35,
    blushIntensity: 0.95,
    headTiltZ: -0.14,
    auraColor: 0xff6ba8,
  },
  [AvatarEmotion.CURIOUS]: {
    label: 'CURIOUS',
    badgeColor: '#a78bfa',
    eyeSquint: 0,
    eyeWidening: 0.35,
    browTilt: -0.18,
    browRaise: 0.4,
    mouthSmile: 0.15,
    blushIntensity: 0.25,
    headTiltZ: 0.22,
    auraColor: 0xa78bfa,
  },
  [AvatarEmotion.SURPRISED]: {
    label: 'SHOCKED',
    badgeColor: '#fde047',
    eyeSquint: 0,
    eyeWidening: 0.7,
    browTilt: -0.1,
    browRaise: 0.65,
    mouthSmile: -0.1,
    blushIntensity: 0.35,
    headTiltZ: -0.06,
    auraColor: 0xfde047,
  },
  [AvatarEmotion.SLEEPY]: {
    label: 'SLEEPY',
    badgeColor: '#94a3b8',
    eyeSquint: 0.72,
    eyeWidening: 0,
    browTilt: -0.12,
    browRaise: -0.25,
    mouthSmile: 0.05,
    blushIntensity: 0.3,
    headTiltZ: 0.16,
    auraColor: 0x7dd3fc,
  },
  [AvatarEmotion.SASSY]: {
    label: 'SASSY',
    badgeColor: '#f472b6',
    eyeSquint: 0.3,
    eyeWidening: 0,
    browTilt: 0.28,
    browRaise: 0.15,
    mouthSmile: 0.65,
    blushIntensity: 0.4,
    headTiltZ: -0.12,
    auraColor: 0xf472b6,
  },
  [AvatarEmotion.LOVE]: {
    label: 'ADORING',
    badgeColor: '#fb7185',
    eyeSquint: 0.52,
    eyeWidening: 0.05,
    browTilt: -0.2,
    browRaise: 0.2,
    mouthSmile: 1.0,
    blushIntensity: 1.0,
    headTiltZ: 0.14,
    auraColor: 0xfb7185,
  },
  [AvatarEmotion.THINKING]: {
    label: 'THINKING',
    badgeColor: '#38bdf8',
    eyeSquint: 0.18,
    eyeWidening: 0,
    browTilt: 0.15,
    browRaise: 0.2,
    mouthSmile: -0.1,
    blushIntensity: 0.15,
    headTiltZ: -0.18,
    auraColor: 0x38bdf8,
  },
};

export interface StageThemeConfig {
  id: StageThemeId;
  name: string;
  skyColor: number;
  fogColor: number;
  gridColor: number;
  accentPink: number;
  accentCyan: number;
  keyLightColor: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
}

export const STAGE_THEMES: Record<StageThemeId, StageThemeConfig> = {
  midnight_neon: {
    id: 'midnight_neon',
    name: 'Midnight Cyber',
    skyColor: 0x0e1024,
    fogColor: 0x0e1024,
    gridColor: 0x26326e,
    accentPink: 0xff6ba8,
    accentCyan: 0x4be3ff,
    keyLightColor: 0xfff1e6,
    hemiSkyColor: 0x8ea8ff,
    hemiGroundColor: 0x1a1438,
  },
  sakura_cyber: {
    id: 'sakura_cyber',
    name: 'Sakura Idol',
    skyColor: 0x1c1028,
    fogColor: 0x1c1028,
    gridColor: 0x5c295c,
    accentPink: 0xff85c0,
    accentCyan: 0x70f3ff,
    keyLightColor: 0xffe8f4,
    hemiSkyColor: 0xffb3d9,
    hemiGroundColor: 0x291538,
  },
  pastel_dream: {
    id: 'pastel_dream',
    name: 'Pastel Dream',
    skyColor: 0x141b33,
    fogColor: 0x141b33,
    gridColor: 0x2e4a7d,
    accentPink: 0xf9a8d4,
    accentCyan: 0x67e8f9,
    keyLightColor: 0xffffff,
    hemiSkyColor: 0xc4b5fd,
    hemiGroundColor: 0x1e293b,
  },
  sunset_idol: {
    id: 'sunset_idol',
    name: 'Sunset Encore',
    skyColor: 0x211224,
    fogColor: 0x211224,
    gridColor: 0x63304d,
    accentPink: 0xfb7185,
    accentCyan: 0xfbbf24,
    keyLightColor: 0xffdca8,
    hemiSkyColor: 0xfda4af,
    hemiGroundColor: 0x271329,
  },
};

export const GESTURE_LABELS: Record<AvatarGesture, string> = {
  [AvatarGesture.IDLE]: 'Idle Sway',
  [AvatarGesture.WAVE]: 'Greet Wave',
  [AvatarGesture.NOD]: 'Agree Nod',
  [AvatarGesture.SHAKE_HEAD]: 'No-No Shake',
  [AvatarGesture.SPIN_JOY]: 'Happy Spin',
  [AvatarGesture.THINK_POSE]: 'Thinking Chin',
  [AvatarGesture.JUMP_CHEER]: 'Joy Hop',
  [AvatarGesture.SHY_FIDGET]: 'Tsun Fidget',
};

export const MOTION_BRICK_LABELS: Record<string, string> = {
  idle: 'Room Idle',
  walk: 'Walking',
  hand_hold: 'Hand-Hold Lead',
  sit_desk: 'Seated @ Desk (ardy_sit)',
  type_desk: 'Desk Studying',
  sip_mug: 'Warm Mug Sip',
  sit_bed: 'Sitting @ Bed (ardy_sit)',
  lounge_bed: 'Bed Lounge',
  look_window: 'Window Gaze',
  reach_prop: 'Prop Interact',
  pet_cat: 'Petting Kitty',
  kick_ball: 'Kick Ball (ardy_kick)',
  pickup_die: 'Pick Up Die (ardy_pickup)',
  push_prop: 'Push Cushion (ardy_push)',
};
