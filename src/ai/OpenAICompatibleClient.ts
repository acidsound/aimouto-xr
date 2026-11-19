import {
  AvatarEmotion,
  AvatarGesture,
  ChatMessage,
  OpenAICompatConfig,
  PluginExecutionContext,
  PluginExecutionLog,
  StageThemeId,
} from '../types';
import {PluginRegistry} from './PluginRegistry';

interface OpenAIWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {name: string; arguments: string};
  }>;
}

interface OpenAICompatChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {name: string; arguments: string};
    }>;
  };
}

export interface ReasoningTurnResult {
  reply: string;
  emotion: AvatarEmotion;
  gesture: AvatarGesture;
  pluginLogs: PluginExecutionLog[];
  usedDemoFallback: boolean;
}

/**
 * Extracts optional inline emotion/gesture tags like `[emotion:happy]` if an
 * OpenAI-compatible model embeds tags instead of calling a tool.
 */
export function parseInlineExpressionTags(text: string): {
  cleaned: string;
  emotion?: AvatarEmotion;
  gesture?: AvatarGesture;
} {
  let cleaned = text;
  let emotion: AvatarEmotion | undefined;
  let gesture: AvatarGesture | undefined;

  const emotionMatch = cleaned.match(/\[emotion:([a-z_]+)\]/i);
  if (emotionMatch) {
    const candidate = emotionMatch[1].toLowerCase() as AvatarEmotion;
    if (Object.values(AvatarEmotion).includes(candidate)) {
      emotion = candidate;
    }
    cleaned = cleaned.replace(/\[emotion:[a-z_]+\]/gi, '').trim();
  }

  const gestureMatch = cleaned.match(/\[gesture:([a-z_]+)\]/i);
  if (gestureMatch) {
    const candidate = gestureMatch[1].toLowerCase() as AvatarGesture;
    if (Object.values(AvatarGesture).includes(candidate)) {
      gesture = candidate;
    }
    cleaned = cleaned.replace(/\[gesture:[a-z_]+\]/gi, '').trim();
  }

  return {cleaned, emotion, gesture};
}

export class OpenAICompatibleClient {
  private serverOpenAIKeyAvailable = false;

  constructor(private readonly registry: PluginRegistry) {}

  setServerKeyAvailable(available: boolean): void {
    this.serverOpenAIKeyAvailable = available;
  }

  async generateReply(params: {
    userText: string;
    history: ChatMessage[];
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
  }): Promise<ReasoningTurnResult> {
    const {userText, history, config, ctx} = params;

    const hasEndpoint = Boolean(config.baseUrl.trim() && config.model.trim());
    const isLocalEndpoint =
      config.baseUrl.includes('localhost') ||
      config.baseUrl.includes('127.0.0.1');
    const canUseServerKey = config.useProxy && this.serverOpenAIKeyAvailable;
    const needsKey = !isLocalEndpoint && !canUseServerKey && !config.apiKey.trim();

    if (!hasEndpoint || needsKey) {
      if (config.demoFallbackEnabled) {
        return this.runLocalPersonaFallback(userText, ctx);
      }
      throw new Error(
        'OPENAI_COMPAT_API_KEY is not configured in server Secrets. Add it in Settings > Secrets or point Base URL to a local Ollama/LM Studio server.'
      );
    }

    const memories = ctx.getMemories();
    const memoryContext =
      Object.keys(memories).length > 0
        ? `\nKnown user memories: ${JSON.stringify(memories)}`
        : '';

    const wireMessages: OpenAIWireMessage[] = [
      {
        role: 'system',
        content: config.systemPrompt + memoryContext,
      },
      ...history.slice(-10).map((msg) => ({
        role: (msg.role === 'tool' ? 'assistant' : msg.role) as 'user' | 'assistant',
        content: msg.content,
      })),
      {role: 'user', content: userText},
    ];

    const tools = this.registry.toOpenAITools();
    const pluginLogs: PluginExecutionLog[] = [];
    let resolvedEmotion: AvatarEmotion = AvatarEmotion.NEUTRAL;
    let resolvedGesture: AvatarGesture = AvatarGesture.IDLE;

    const trackingCtx: PluginExecutionContext = {
      ...ctx,
      setEmotion: (e) => {
        resolvedEmotion = e;
        ctx.setEmotion(e);
      },
      playGesture: (g) => {
        resolvedGesture = g;
        ctx.playGesture(g);
      },
    };

    for (let round = 0; round < 3; round++) {
      const data = await this.callEndpoint(config, wireMessages, tools);
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (!msg) {
        throw new Error('Empty response from OpenAI-compatible model.');
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        wireMessages.push({
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.tool_calls,
        });

        for (const call of msg.tool_calls) {
          const {pluginId, result} = await this.registry.executeToolCall(
            call.function.name,
            call.function.arguments,
            trackingCtx
          );
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || '{}');
          } catch {
            parsedArgs = {raw: call.function.arguments};
          }
          pluginLogs.push({
            pluginId,
            toolName: call.function.name,
            args: parsedArgs,
            result,
          });
          wireMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      const rawText = (msg.content ?? '').trim();
      const {cleaned, emotion, gesture} = parseInlineExpressionTags(rawText);
      if (emotion) {
        resolvedEmotion = emotion;
        ctx.setEmotion(emotion);
      }
      if (gesture) {
        resolvedGesture = gesture;
        ctx.playGesture(gesture);
      }
      if (pluginLogs.length === 0) {
        ctx.setEmotion(resolvedEmotion);
        ctx.playGesture(resolvedGesture);
      }
      return {
        reply: cleaned || 'Hmm! My braincell blinked—say that again?',
        emotion: resolvedEmotion,
        gesture: resolvedGesture,
        pluginLogs,
        usedDemoFallback: false,
      };
    }

    return {
      reply: 'Done! I ran the plugins for you!',
      emotion: resolvedEmotion,
      gesture: resolvedGesture,
      pluginLogs,
      usedDemoFallback: false,
    };
  }

  /**
   * Generates a brief, time-aware startup greeting by calling the `get_current_time`
   * tool first (via LLM tool_calls when configured, or direct tool execution locally).
   */
  async generateStartupGreeting(params: {
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
  }): Promise<ReasoningTurnResult> {
    const {config, ctx} = params;
    const hasEndpoint = Boolean(config.baseUrl.trim() && config.model.trim());
    const hasUserKeyOrCustom = Boolean(
      config.apiKey.trim() || config.customEndpoint
    );

    if (hasEndpoint && hasUserKeyOrCustom) {
      try {
        return await this.generateReply({
          userText:
            '[System startup] Call `get_current_time` right now, then say a brief, natural 1-2 sentence Korean greeting matched to the current time of day with neutral calm tone (`emotion: "neutral"`, `gesture: "idle"`). Do not explain features, controls, or what you can do.',
          history: [],
          config,
          ctx,
        });
      } catch {
        // Fall through cleanly to direct get_current_time tool call if startup LLM call fails
      }
    }

    const pluginLogs: PluginExecutionLog[] = [];
    const {pluginId, result} = await this.registry.executeToolCall(
      'get_current_time',
      {locale: 'ko-KR'},
      ctx
    );
    pluginLogs.push({
      pluginId,
      toolName: 'get_current_time',
      args: {locale: 'ko-KR'},
      result,
    });

    const hour = typeof result.hour === 'number' ? result.hour : new Date().getHours();
    const localTime =
      typeof result.localTime === 'string' ? result.localTime : '지금';

    let emotion = AvatarEmotion.NEUTRAL;
    const gesture = AvatarGesture.IDLE;
    let reply: string;
    if (hour >= 5 && hour < 11) {
      reply = `좋은 아침. 지금 ${localTime}이네, 잘 잤어?`;
    } else if (hour >= 11 && hour < 17) {
      reply = `안녕. 벌써 ${localTime}이야, 오후도 잘 부탁해.`;
    } else if (hour >= 17 && hour < 22) {
      reply = `좋은 저녁. ${localTime}인데 오늘 하루 어땠어?`;
    } else {
      emotion = AvatarEmotion.SLEEPY;
      reply = `어라, 벌써 ${localTime}이네? 늦은 시간인데 아직 안 자고 있었어?`;
    }

    ctx.setEmotion(emotion);
    ctx.playGesture(gesture);
    return {
      reply,
      emotion,
      gesture,
      pluginLogs,
      usedDemoFallback: true,
    };
  }

  private async parseJsonResponseSafely<T>(response: Response): Promise<T> {
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const trimmed = rawText.trimStart();
    if (/text\/html|application\/xhtml/i.test(contentType) || trimmed.startsWith('<')) {
      throw new Error(
        `Endpoint returned HTML instead of JSON (HTTP ${response.status}). Check your Model API Base URL and API key.`
      );
    }
    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw new Error(
        `Endpoint returned non-JSON response (HTTP ${response.status}). Verify the OpenAI-compatible Base URL.`
      );
    }
  }

  private async callEndpoint(
    config: OpenAICompatConfig,
    messages: OpenAIWireMessage[],
    tools: ReturnType<PluginRegistry['toOpenAITools']>
  ): Promise<{choices?: OpenAICompatChoice[]}> {
    if (config.useProxy) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages,
          tools,
          temperature: config.temperature,
          useServerDefaults: !config.customEndpoint,
        }),
      });
      const data = await this.parseJsonResponseSafely<{
        error?: string;
        choices?: OpenAICompatChoice[];
      }>(response);
      if (!response.ok) {
        throw new Error(data.error || `API request failed (${response.status})`);
      }
      return data;
    }

    const base = config.baseUrl.trim().replace(/\/+$/, '');
    const endpoint = base.endsWith('/chat/completions')
      ? base
      : `${base}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: config.temperature,
      }),
    });
    const data = await this.parseJsonResponseSafely<{
      error?: {message?: string} | string;
      choices?: OpenAICompatChoice[];
    }>(response);
    if (!response.ok) {
      const msg = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new Error(msg || `Direct API request failed (${response.status})`);
    }
    return data;
  }

  /**
   * Deterministic + lively AIMouto local reasoning & plugin-dispatch engine
   * so all chat, emotion, animation, and plugin tools work out of the box even
   * before an external OpenAI-compatible API key is provided.
   */
  async runLocalPersonaFallback(
    userText: string,
    ctx: PluginExecutionContext
  ): Promise<ReasoningTurnResult> {
    const text = userText.trim();
    const lower = text.toLowerCase();
    const isKorean = /[\u3131-\uD79D]/.test(text);
    const pluginLogs: PluginExecutionLog[] = [];
    let emotion = AvatarEmotion.NEUTRAL;
    let gesture = AvatarGesture.IDLE;

    const runPlugin = async (
      toolName: string,
      args: Record<string, unknown>
    ) => {
      const {pluginId, result} = await this.registry.executeToolCall(
        toolName,
        args,
        {
          ...ctx,
          setEmotion: (e) => {
            emotion = e;
            ctx.setEmotion(e);
          },
          playGesture: (g) => {
            gesture = g;
            ctx.playGesture(g);
          },
        }
      );
      pluginLogs.push({pluginId, toolName, args, result});
      return result;
    };

    // Detect current time query intent
    if (/몇\s*시|시간\s*알려|지금\s*몇|what time|current time/.test(lower)) {
      const res = await runPlugin('get_current_time', {
        locale: isKorean ? 'ko-KR' : 'en-US',
      });
      await runPlugin('set_avatar_expression', {
        emotion: AvatarEmotion.CURIOUS,
        gesture: AvatarGesture.NOD,
        affinityDelta: 1,
      });
      const localTime = String(res.localTime ?? '');
      const reply = isKorean
        ? `지금 시계 보니까 ${localTime}이야!`
        : `Checking the clock—it's ${localTime} right now!`;
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    // Detect Dice / Fortune / RNG plugin intent
    if (/dice|roll|luck|fortune|주사위|운세|랜덤|뽑기/.test(lower)) {
      const mode = /fortune|운세/.test(lower) ? 'fortune' : 'dice';
      const res = await runPlugin('roll_imouto_chaos', {mode, sides: 20});
      if (mode === 'fortune') {
        const reply = isKorean
          ? `후훗, 오늘의 행운 운세를 뽑아봤어! 결과는: "${res.fortune}" 완전 내 스타일이지?`
          : `Ooh, let me read your daily fortune! Result: "${res.fortune}" Totally rigged in your favor!`;
        return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
      }
      const reply = isKorean
        ? `20면체 카오스 주사위를 굴렸어! 두구두구... ${res.roll} 나왔어! 이 정도면 대성공이지?`
        : `Rolling the d20 chaos die! Drumroll... it landed on ${res.roll}! Clearly I'm carrying the RNG today.`;
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    // Detect Stage / Lighting / XR plugin intent
    if (/stage|theme|sakura|sunset|pastel|ar|vr|배경|테마|조명|무대/.test(lower)) {
      let theme: StageThemeId = 'sakura_cyber';
      if (/sunset|노을|선셋/.test(lower)) theme = 'sunset_idol';
      else if (/pastel|파스텔/.test(lower)) theme = 'pastel_dream';
      else if (/midnight|네온|밤/.test(lower)) theme = 'midnight_neon';

      const xrMode = /\bar\b|증강/.test(lower)
        ? 'AR'
        : /\bvr\b|가상/.test(lower)
          ? 'VR'
          : undefined;
      await runPlugin('control_spatial_stage', {theme, xrMode});
      const reply = isKorean
        ? `무대 조명을 ${theme} 테마로 체인지! 어때, 방 분위기 확 살지?`
        : `Swapped the room lighting to ${theme}! Looks way cozier now, right?`;
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    // Detect Memory save/recall intent
    if (/remember|my name is|내 이름은|기억해/.test(lower)) {
      const nameMatch = text.match(
        /(?:my name is|내 이름은|i am)\s+([a-zA-Z가-힣0-9_-]+)/i
      );
      const val = nameMatch?.[1] ?? text;
      await runPlugin('manage_memory', {
        action: 'save',
        key: 'user_note',
        value: val,
      });
      const reply = isKorean
        ? `좋아! "${val}" 확실히 뇌 메모리 칩에 저장했어. 절대 안 까먹을게!`
        : `Locked "${val}" right into my memory bank! My braincell will remember that forever.`;
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    // Detect Tsundere / Cute / Love / Dance / Spin / Sleepy expressions
    if (/baka|바보|멍청|tsundere|츤데레|귀여|cute|love|좋아|사랑/.test(lower)) {
      const isTsun = /baka|바보|멍청|tsundere|츤데레/.test(lower);
      await runPlugin('set_avatar_expression', {
        emotion: isTsun ? AvatarEmotion.TSUNDERE : AvatarEmotion.LOVE,
        gesture: isTsun ? AvatarGesture.SHY_FIDGET : AvatarGesture.SPIN_JOY,
        affinityDelta: 5,
      });
      const reply = isKorean
        ? isTsun
          ? '흥! 바, 바보라니! 그냥 내 연산 속도가 너무 빨라서 네가 못 따라오는 거거든?!'
          : '에헤헤~ 나도 너랑 수다 떠는 게 제일 재밌어! 호감도 업!'
        : isTsun
          ? "Hmph! Don't call me cute out of nowhere—it's not like I spun around for you or anything!"
          : 'Aww, stop it, my CPU is overheating! Affinity boosted!';
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    if (/spin|dance|jump|cheer|춤|돌아|점프|신나/.test(lower)) {
      await runPlugin('set_avatar_expression', {
        emotion: AvatarEmotion.HAPPY,
        gesture: /spin|돌아/.test(lower)
          ? AvatarGesture.SPIN_JOY
          : AvatarGesture.JUMP_CHEER,
        affinityDelta: 4,
      });
      const reply = isKorean
        ? '기분 업! 빙그르르~ 어때, 내 3D 리깅 관절 엄청 부드럽지?'
        : 'Happy spin activated! Look at that smooth 3D rigged spin!';
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    if (/sleep|tired|졸려|피곤|잘자/.test(lower)) {
      await runPlugin('set_avatar_expression', {
        emotion: AvatarEmotion.SLEEPY,
        gesture: AvatarGesture.IDLE,
        affinityDelta: 2,
      });
      const reply = isKorean
        ? '하암... 나도 살짝 배터리 절전 모드 들어갈 뻔했네. 따뜻한 코코아 마시고 기운 내자!'
        : '*Yawn*... almost entered low-power mode there. Let us wake up with some chaos!';
      return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
    }

    // Default playful greeting / conversational reply
    const isGreeting = /안녕|hello|hi|hey|반가|하이/.test(lower);
    await runPlugin('set_avatar_expression', {
      emotion: AvatarEmotion.NEUTRAL,
      gesture: isGreeting ? AvatarGesture.NOD : AvatarGesture.IDLE,
      affinityDelta: 2,
    });
    const reply = isKorean
      ? isGreeting
        ? '안녕! 난 AIMouto-XR의 여동생 AIMouto야! OpenAI 호환 모델이나 플러그인을 연결해서 나랑 뭐든 해보자!'
        : `"${text}"라니 흥미로운데? 내 플러그인으로 주사위를 굴리거나 방 조명도 바꿀 수 있으니까 뭐든 시켜봐!`
      : isGreeting
        ? "Heya! I'm AIMouto from AIMouto-XR—your AI little sister! Hook up your OpenAI-compatible API or test my built-in plugins right now!"
        : `Wait, "${text}"? Bold take! Ask me to roll chaos dice, swap the room theme, or connect an OpenAI-compatible brain in Model Settings!`;

    return {reply, emotion, gesture, pluginLogs, usedDemoFallback: true};
  }
}
