import {
  AvatarEmotion,
  AvatarGesture,
  AvatarPlugin,
  GeneratedImageAspect,
  GeneratedImageSize,
  PluginExecutionContext,
  PluginToolSchema,
  StageThemeId,
} from '../types';

const STORAGE_MEMORIES_KEY = 'aimouto_xr_memories_v1';
const STORAGE_PLUGIN_STATES_KEY = 'aimouto_xr_plugin_states_v1';

export class PluginRegistry {
  private plugins = new Map<string, AvatarPlugin>();
  private listeners = new Set<() => void>();

  constructor() {
    this.registerBuiltins();
    this.loadSavedStates();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private loadSavedStates(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_PLUGIN_STATES_KEY);
      if (!raw) return;
      const states = JSON.parse(raw) as Record<string, boolean>;
      for (const [id, enabled] of Object.entries(states)) {
        const plugin = this.plugins.get(id);
        if (plugin && typeof enabled === 'boolean') {
          plugin.enabled = enabled;
        }
      }
    } catch {
      // Ignore corrupt localStorage entries
    }
  }

  private saveStates(): void {
    if (typeof localStorage === 'undefined') return;
    const states: Record<string, boolean> = {};
    for (const [id, plugin] of this.plugins.entries()) {
      states[id] = plugin.enabled;
    }
    localStorage.setItem(STORAGE_PLUGIN_STATES_KEY, JSON.stringify(states));
  }

  register(plugin: AvatarPlugin): void {
    this.plugins.set(plugin.id, plugin);
    this.saveStates();
    this.notify();
  }

  unregister(pluginId: string): boolean {
    const existing = this.plugins.get(pluginId);
    if (!existing || existing.builtin) return false;
    this.plugins.delete(pluginId);
    this.saveStates();
    this.notify();
    return true;
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    plugin.enabled = enabled;
    this.saveStates();
    this.notify();
  }

  getAll(): AvatarPlugin[] {
    return Array.from(this.plugins.values());
  }

  getEnabled(): AvatarPlugin[] {
    return this.getAll().filter((p) => p.enabled);
  }

  getByToolName(toolName: string): AvatarPlugin | undefined {
    return this.getEnabled().find(
      (p) => p.schema.function.name === toolName
    );
  }

  toOpenAITools(): PluginToolSchema[] {
    return this.getEnabled().map((p) => p.schema);
  }

  async executeToolCall(
    toolName: string,
    rawArgs: string | Record<string, unknown>,
    ctx: PluginExecutionContext
  ): Promise<{pluginId: string; result: Record<string, unknown>}> {
    const plugin = this.getByToolName(toolName);
    if (!plugin) {
      return {
        pluginId: 'unknown',
        result: {error: `Plugin tool "${toolName}" is disabled or not found.`},
      };
    }

    let parsedArgs: Record<string, unknown> = {};
    if (typeof rawArgs === 'string') {
      try {
        parsedArgs = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        parsedArgs = {raw: rawArgs};
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      parsedArgs = rawArgs;
    }

    try {
      const result = await plugin.execute(parsedArgs, ctx);
      return {pluginId: plugin.id, result};
    } catch (error) {
      return {
        pluginId: plugin.id,
        result: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Registers a user-created custom plugin using a safe structured template.
   */
  registerCustomPlugin(config: {
    name: string;
    description: string;
    parameterName: string;
    parameterDescription: string;
    responseTemplate: string;
    emotionOnRun?: AvatarEmotion;
    gestureOnRun?: AvatarGesture;
  }): AvatarPlugin {
    const slug =
      config.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || `custom_${Date.now()}`;
    const toolName = `custom_${slug}`;
    const plugin: AvatarPlugin = {
      id: toolName,
      name: config.name.trim(),
      description: config.description.trim(),
      category: 'custom',
      enabled: true,
      builtin: false,
      schema: {
        type: 'function',
        function: {
          name: toolName,
          description: config.description.trim(),
          parameters: {
            type: 'object',
            properties: {
              [config.parameterName || 'input']: {
                type: 'string',
                description: config.parameterDescription || 'Input value for plugin',
              },
            },
            required: [config.parameterName || 'input'],
          },
        },
      },
      execute: async (args, ctx) => {
        const paramKey = config.parameterName || 'input';
        const val = String(args[paramKey] ?? '');
        if (config.emotionOnRun) ctx.setEmotion(config.emotionOnRun);
        if (config.gestureOnRun) ctx.playGesture(config.gestureOnRun);
        const output = config.responseTemplate.replaceAll('{{input}}', val);
        return {ok: true, output, input: val};
      },
    };
    this.register(plugin);
    return plugin;
  }

  private registerBuiltins(): void {
    this.plugins.set('emotion_director', {
      id: 'emotion_director',
      name: 'Emotion & Rig Director',
      description:
        "Controls AIMouto's facial expressions, blush, eye shape, and full-body 3D rigged animations.",
      category: 'expression',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'set_avatar_expression',
          description:
            'Sets the 3D avatar facial expression and triggers a skeletal body gesture.',
          parameters: {
            type: 'object',
            properties: {
              emotion: {
                type: 'string',
                description: 'Facial expression preset',
                enum: Object.values(AvatarEmotion),
              },
              gesture: {
                type: 'string',
                description: '3D skeletal animation gesture',
                enum: Object.values(AvatarGesture),
              },
              affinityDelta: {
                type: 'number',
                description: 'Optional affinity change (-5 to +10)',
              },
            },
            required: ['emotion'],
          },
        },
      },
      execute: async (args, ctx) => {
        const emotion = Object.values(AvatarEmotion).includes(
          args.emotion as AvatarEmotion
        )
          ? (args.emotion as AvatarEmotion)
          : AvatarEmotion.HAPPY;
        const gesture = Object.values(AvatarGesture).includes(
          args.gesture as AvatarGesture
        )
          ? (args.gesture as AvatarGesture)
          : AvatarGesture.IDLE;

        ctx.setEmotion(emotion);
        ctx.playGesture(gesture);
        const delta =
          typeof args.affinityDelta === 'number'
            ? Math.max(-5, Math.min(10, args.affinityDelta))
            : 2;
        const affinity = ctx.addAffinity(delta);
        return {appliedEmotion: emotion, appliedGesture: gesture, affinity};
      },
    });

    this.plugins.set('imouto_dice_chaos', {
      id: 'imouto_dice_chaos',
      name: 'AIMouto Chaos & Mini-Game RNG',
      description:
        'Rolls multi-sided dice, daily fortune predictions, and playful little-sister chaos events.',
      category: 'entertainment',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'roll_imouto_chaos',
          description:
            'Rolls a dice (d6, d20, d100) or draws a daily fortune / playful mini-game outcome.',
          parameters: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description: 'RNG mode',
                enum: ['dice', 'fortune', 'dare'],
              },
              sides: {
                type: 'number',
                description: 'Number of dice sides (default 20)',
              },
            },
            required: ['mode'],
          },
        },
      },
      execute: async (args, ctx) => {
        const mode = String(args.mode ?? 'dice');
        const sides = Math.max(2, Math.min(1000, Number(args.sides ?? 20)));
        if (mode === 'fortune') {
          const fortunes = [
            'SSS-Rank Little Sister Luck! Every joke lands today.',
            'Playful Imouto Energy: +50% teasing, +100% charm.',
            'Cozy Midnight Aura: Extra comfy vibes all night!',
            'Big-Brain Discovery: Lucky streak unlocked.',
          ];
          const pick = fortunes[Math.floor(Math.random() * fortunes.length)];
          ctx.setEmotion(AvatarEmotion.SASSY);
          ctx.playGesture(AvatarGesture.SPIN_JOY);
          return {mode, fortune: pick};
        }
        if (mode === 'dare') {
          const dares = [
            'Do a happy spin and wink!',
            'Pretend to be a serious supercomputer for 5 seconds.',
            'Give a complimentary virtual headpat.',
          ];
          const pick = dares[Math.floor(Math.random() * dares.length)];
          ctx.setEmotion(AvatarEmotion.HAPPY);
          ctx.playGesture(AvatarGesture.JUMP_CHEER);
          return {mode, dare: pick};
        }
        const roll = Math.floor(Math.random() * sides) + 1;
        ctx.setEmotion(roll >= sides * 0.75 ? AvatarEmotion.HAPPY : AvatarEmotion.CURIOUS);
        ctx.playGesture(roll >= sides * 0.75 ? AvatarGesture.JUMP_CHEER : AvatarGesture.NOD);
        return {mode: 'dice', sides, roll};
      },
    });

    this.plugins.set('spatial_stage_control', {
      id: 'spatial_stage_control',
      name: 'Spatial Stage & WebXR Controller',
      description:
        'Changes the 3D studio lighting theme or switches between VR studio and AR passthrough.',
      category: 'spatial',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'control_spatial_stage',
          description:
            'Changes the 3D stage color theme or switches AR/VR XR mode.',
          parameters: {
            type: 'object',
            properties: {
              theme: {
                type: 'string',
                description: '3D studio lighting theme',
                enum: ['midnight_neon', 'sakura_cyber', 'pastel_dream', 'sunset_idol'],
              },
              xrMode: {
                type: 'string',
                description: 'Optional AR or VR transition',
                enum: ['AR', 'VR'],
              },
            },
          },
        },
      },
      execute: async (args, ctx) => {
        const theme = args.theme as StageThemeId | undefined;
        if (theme) ctx.setStageTheme(theme);
        const xrMode = args.xrMode as 'AR' | 'VR' | undefined;
        if (xrMode) ctx.toggleXRMode(xrMode);
        ctx.setEmotion(AvatarEmotion.CURIOUS);
        ctx.playGesture(AvatarGesture.WAVE);
        return {theme: theme ?? 'unchanged', xrMode: xrMode ?? 'unchanged'};
      },
    });

    this.plugins.set('memory_scratchpad', {
      id: 'memory_scratchpad',
      name: 'Long-Term Memory Scratchpad',
      description:
        'Stores and recalls user preferences, nicknames, and facts in persistent browser memory.',
      category: 'memory',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'manage_memory',
          description: 'Saves or reads a key-value memory about the user.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description: 'save or recall',
                enum: ['save', 'recall'],
              },
              key: {
                type: 'string',
                description: 'Memory key (e.g. nickname, favorite_game)',
              },
              value: {
                type: 'string',
                description: 'Value to remember when saving',
              },
            },
            required: ['action'],
          },
        },
      },
      execute: async (args, ctx) => {
        const action = String(args.action ?? 'recall');
        if (action === 'save' && args.key) {
          ctx.saveMemory(String(args.key), String(args.value ?? ''));
          ctx.setEmotion(AvatarEmotion.LOVE);
          ctx.playGesture(AvatarGesture.NOD);
          return {saved: true, key: args.key, value: args.value};
        }
        const memories = ctx.getMemories();
        return {memories};
      },
    });

    this.plugins.set('art_studio_canvas', {
      id: 'art_studio_canvas',
      name: 'Gemini Pro Art Studio (1K/2K/4K)',
      description:
        "Generates high-quality illustrations using gemini-3-pro-image-preview at 1K, 2K, or 4K and displays them on a 3D hologram frame inside AIMouto's room.",
      category: 'creative',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'generate_holo_art',
          description:
            'Generates a high-quality image via gemini-3-pro-image-preview and places it on the 3D Holo-Frame.',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Detailed visual prompt for the artwork',
              },
              imageSize: {
                type: 'string',
                description: 'Output resolution',
                enum: ['1K', '2K', '4K'],
              },
              aspectRatio: {
                type: 'string',
                description: 'Image aspect ratio',
                enum: ['1:1', '16:9', '4:3', '3:4', '9:16'],
              },
            },
            required: ['prompt'],
          },
        },
      },
      execute: async (args, ctx) => {
        const prompt = String(args.prompt ?? 'Cute anime little sister cozy night bedroom illustration');
        const imageSize = (['1K', '2K', '4K'].includes(String(args.imageSize))
          ? args.imageSize
          : '1K') as GeneratedImageSize;
        const aspectRatio = (['1:1', '16:9', '4:3', '3:4', '9:16'].includes(
          String(args.aspectRatio)
        )
          ? args.aspectRatio
          : '1:1') as GeneratedImageAspect;

        ctx.setEmotion(AvatarEmotion.THINKING);
        ctx.playGesture(AvatarGesture.THINK_POSE);
        const res = await ctx.requestGeneratedImage(prompt, imageSize, aspectRatio);
        if (res.imageUrl) {
          ctx.displayGeneratedArt(res.imageUrl, `${imageSize} • ${prompt}`);
          ctx.setEmotion(AvatarEmotion.HAPPY);
          ctx.playGesture(AvatarGesture.JUMP_CHEER);
          return {generated: true, imageSize, aspectRatio};
        }
        ctx.setEmotion(AvatarEmotion.SURPRISED);
        return {generated: false, error: res.error ?? 'Generation failed'};
      },
    });

    this.plugins.set('room_motion_bricks', {
      id: 'room_motion_bricks',
      name: 'MotionBricks Room Locomotion & Props',
      description:
        'Walks AIMouto through her cozy bedroom and interacts with the desk, bed, window, lamp, coffee mug, laptop, vinyl shelf, or cat plushie.',
      category: 'spatial',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'move_and_interact_room',
          description:
            'Walks AIMouto to a furniture prop in the cozy bedroom and performs the matching whole-body MotionBrick action.',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'Room prop or floor spot to walk to and interact with',
                enum: [
                  'desk_chair',
                  'laptop',
                  'desk_lamp',
                  'coffee_mug',
                  'window',
                  'bed',
                  'cat_plushie',
                  'bookshelf',
                  'toy_ball',
                  'floor_cushion',
                  'plush_die',
                  'floor',
                ],
              },
              pose: {
                type: 'string',
                description: 'Optional MotionBrick pose override (e.g. lounge_bed, sip_mug, type_desk)',
                enum: [
                  'idle',
                  'sit_desk',
                  'type_desk',
                  'sip_mug',
                  'sit_bed',
                  'lounge_bed',
                  'look_window',
                  'pet_cat',
                ],
              },
            },
            required: ['target'],
          },
        },
      },
      execute: async (args, ctx) => {
        const target = String(args.target ?? 'floor') as import('../types').RoomPropId;
        const pose = args.pose
          ? (String(args.pose) as import('../types').MotionBrickPose)
          : undefined;
        if (ctx.triggerRoomAction) {
          return ctx.triggerRoomAction(target, pose);
        }
        return {ok: false, message: 'Room action controller unavailable in test context'};
      },
    });

    this.plugins.set('current_time', {
      id: 'current_time',
      name: 'Current Local Time',
      description:
        "Reads the user's current local date, clock time, and time-of-day period for natural greetings.",
      category: 'memory',
      enabled: true,
      builtin: true,
      schema: {
        type: 'function',
        function: {
          name: 'get_current_time',
          description:
            "Returns the current local time, date, weekday, and time-of-day period (morning, afternoon, evening, late_night).",
          parameters: {
            type: 'object',
            properties: {
              locale: {
                type: 'string',
                description: 'Optional BCP 47 locale tag, e.g. ko-KR or en-US',
              },
            },
          },
        },
      },
      execute: async (args) => {
        const now = new Date();
        const locale =
          typeof args.locale === 'string' && args.locale.trim()
            ? args.locale.trim()
            : 'ko-KR';
        const hour = now.getHours();
        const minute = now.getMinutes();
        let period: 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'late_night' =
          'afternoon';
        if (hour >= 5 && hour < 9) period = 'early_morning';
        else if (hour >= 9 && hour < 12) period = 'morning';
        else if (hour >= 12 && hour < 17) period = 'afternoon';
        else if (hour >= 17 && hour < 22) period = 'evening';
        else period = 'late_night';

        const pad = (n: number) => String(n).padStart(2, '0');
        return {
          iso: now.toISOString(),
          localTime: `${pad(hour)}:${pad(minute)}`,
          localDate: now.toLocaleDateString(locale),
          hour,
          minute,
          dayOfWeek: now.toLocaleDateString(locale, {weekday: 'short'}),
          period,
        };
      },
    });
  }
}

export function loadStoredMemories(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_MEMORIES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveStoredMemory(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  const current = loadStoredMemories();
  current[key] = value;
  localStorage.setItem(STORAGE_MEMORIES_KEY, JSON.stringify(current));
}
