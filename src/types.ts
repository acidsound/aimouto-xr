export enum AvatarEmotion {
  NEUTRAL = 'neutral',
  HAPPY = 'happy',
  TSUNDERE = 'tsundere',
  CURIOUS = 'curious',
  SURPRISED = 'surprised',
  SLEEPY = 'sleepy',
  SASSY = 'sassy',
  LOVE = 'love',
  THINKING = 'thinking',
}

export enum AvatarGesture {
  IDLE = 'idle',
  WAVE = 'wave',
  NOD = 'nod',
  SHAKE_HEAD = 'shake_head',
  SPIN_JOY = 'spin_joy',
  THINK_POSE = 'think_pose',
  JUMP_CHEER = 'jump_cheer',
  SHY_FIDGET = 'shy_fidget',
}

export type VisemeVowel = 'sil' | 'A' | 'I' | 'U' | 'E' | 'O';

export type StageThemeId =
  | 'midnight_neon'
  | 'sakura_cyber'
  | 'pastel_dream'
  | 'sunset_idol';

export type GeneratedImageSize = '1K' | '2K' | '4K';

export type GeneratedImageAspect = '1:1' | '16:9' | '4:3' | '3:4' | '9:16';

export type RoomPropId =
  | 'floor'
  | 'desk_lamp'
  | 'desk_chair'
  | 'laptop'
  | 'coffee_mug'
  | 'window'
  | 'bed'
  | 'cat_plushie'
  | 'bookshelf'
  | 'toy_ball'
  | 'floor_cushion'
  | 'plush_die';

export type MotionBrickPose =
  | 'idle'
  | 'walk'
  | 'hand_hold'
  | 'sit_desk'
  | 'type_desk'
  | 'sip_mug'
  | 'sit_bed'
  | 'lounge_bed'
  | 'look_window'
  | 'reach_prop'
  | 'pet_cat'
  | 'kick_ball'
  | 'pickup_die'
  | 'push_prop';

export interface MotionBrickSnapshot {
  pose: MotionBrickPose;
  activeProp: RoomPropId | null;
  handHoldActive: boolean;
  moving: boolean;
  label: string;
  physicsActive?: boolean;
  grounded?: boolean;
  weightKg?: number;
  verticalVelocity?: number;
  motionBackend?: 'onnx_webgpu' | 'soma_runtime';
}

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  useProxy: boolean;
  demoFallbackEnabled: boolean;
  customEndpoint?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  emotion?: AvatarEmotion;
  gesture?: AvatarGesture;
  pluginCalls?: PluginExecutionLog[];
  timestamp: number;
}

export interface PluginParameterProperty {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: string[];
}

export interface PluginToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, PluginParameterProperty>;
      required?: string[];
    };
  };
}

export interface PluginExecutionContext {
  setEmotion: (emotion: AvatarEmotion) => void;
  playGesture: (gesture: AvatarGesture) => void;
  setStageTheme: (theme: StageThemeId) => void;
  toggleXRMode: (mode?: 'AR' | 'VR') => void;
  displayGeneratedArt: (imageUrl: string, caption: string) => void;
  requestGeneratedImage: (
    prompt: string,
    imageSize?: GeneratedImageSize,
    aspectRatio?: GeneratedImageAspect
  ) => Promise<{imageUrl?: string; error?: string}>;
  triggerRoomAction?: (
    target: RoomPropId,
    pose?: MotionBrickPose
  ) => {ok: boolean; message: string};
  getMemories: () => Record<string, string>;
  saveMemory: (key: string, value: string) => void;
  addAffinity: (delta: number) => number;
}

export interface AvatarPlugin {
  id: string;
  name: string;
  description: string;
  category: 'expression' | 'entertainment' | 'spatial' | 'memory' | 'creative' | 'custom';
  enabled: boolean;
  builtin: boolean;
  schema: PluginToolSchema;
  execute: (
    args: Record<string, unknown>,
    ctx: PluginExecutionContext
  ) => Promise<Record<string, unknown>>;
}

export interface PluginExecutionLog {
  pluginId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AnimeUIColorTokens {
  backdrop: string;
  panelFill: string;
  panelSurfaceRgb: string;
  outerBorderPink: string;
  innerBorderCyan: string;
  dialogueFill: string;
  dialogueText: string;
  textPrimary: string;
  textMuted: string;
  accentViolet: string;
  affinityPink: string;
  cyanGlow: string;
}

export interface AnimeUIWidgetSpec {
  id: string;
  kind: 'avatar_badge' | 'emotion_pill' | 'progress_bar' | 'equalizer' | 'button' | 'text' | 'text_input';
  label: string;
  icon?: string;
  actionId?: string;
}

export interface AnimeUIPanelSpec {
  id: 'status_card' | 'system_toolbar' | 'quick_actions' | 'dialogue_deck';
  title: string;
  region: 'top-left' | 'top-right' | 'right-rail' | 'bottom-center';
  chamferPx: number;
  screen2D: {
    anchor: 'top-left' | 'top-right' | 'center-right' | 'bottom-center';
    widthPx: number;
    maxWidthVw?: number;
  };
  spatial3D: {
    positionMeters: [number, number, number];
    rotationEuler: [number, number, number];
    sizeMeters: {width: number; height: number | 'auto'};
    pixelSize: number;
    followHeadOffset?: [number, number, number];
    manipulation: boolean;
  };
  widgets: AnimeUIWidgetSpec[];
}

export interface AnimeUISchema {
  version: string;
  sourceConceptImage: string;
  theme: AnimeUIColorTokens;
  panels: AnimeUIPanelSpec[];
}
