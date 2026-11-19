import {
  AvatarEmotion,
  AvatarGesture,
  ChatMessage,
  OpenAICompatConfig,
  PluginExecutionContext,
  PluginExecutionLog,
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

  isEndpointConfigured(config: OpenAICompatConfig): boolean {
    const hasEndpoint = Boolean(config.baseUrl.trim() && config.model.trim());
    const isLocalEndpoint =
      config.baseUrl.includes('localhost') ||
      config.baseUrl.includes('127.0.0.1');
    const canUseServerKey = config.useProxy && this.serverOpenAIKeyAvailable;
    const needsKey = !isLocalEndpoint && !canUseServerKey && !config.apiKey.trim();
    return hasEndpoint && !needsKey;
  }

  async generateReply(params: {
    userText: string;
    history: ChatMessage[];
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
  }): Promise<ReasoningTurnResult> {
    const {userText, history, config, ctx} = params;

    if (!this.isEndpointConfigured(config)) {
      throw new Error(
        'LLM API가 설정되지 않았습니다. Settings > Secrets에 OPENAI_COMPAT_API_KEY를 등록하거나 Model API에서 로컬 Ollama/LM Studio 엔드포인트를 지정하세요.'
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
      ...history
        .slice(-10)
        .filter((msg) => Boolean(msg.content?.trim()))
        .map((msg) => ({
          role: (msg.role === 'tool' ? 'assistant' : msg.role) as 'user' | 'assistant',
          content: msg.content,
        })),
      {role: 'user', content: userText},
    ];

    const tools = this.registry.toOpenAITools();
    return this.runChatCompletion({
      wireMessages,
      tools,
      config,
      ctx,
    });
  }

  /**
   * Generates a contextual, non-repetitive spoken reaction via the LLM after an
   * in-room physical interaction (prop action, hand-hold leading, avatar poke).
   * Passes ONLY the factual situation description + recent dialogue history to the LLM
   * and omits `trigger_room_action` from tools to prevent recursive movement loops.
   * Returns `null` when no LLM endpoint is configured (never synthesizes deterministic avatar speech).
   */
  async generateActionReaction(params: {
    situation: string;
    history: ChatMessage[];
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
  }): Promise<ReasoningTurnResult | null> {
    const {situation, history, config, ctx} = params;

    if (!this.isEndpointConfigured(config)) {
      return null;
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
      ...history
        .slice(-10)
        .filter((msg) => Boolean(msg.content?.trim()))
        .map((msg) => ({
          role: (msg.role === 'tool' ? 'assistant' : msg.role) as 'user' | 'assistant',
          content: msg.content,
        })),
      {
        role: 'user',
        content: `[방 안 행동 상황] 방금 방 안에서 다음 일이 일어났다: ${situation}\n앞뒤 대화 맥락과 지금 일어난 행동을 자연스럽게 반영해, AIMouto의 1인칭 시점으로 짧은 1~2문장 대사를 직접 말해줘. 직전 대사를 반복하지 말고 현재 상황에 어울리는 생생한 반응을 해줘.`,
      },
    ];

    // Restrict tools during reaction generation to `set_avatar_expression` so the model
    // cannot invoke `move_and_interact_room` and trigger recursive autonomous wandering.
    const reactionTools = this.registry
      .toOpenAITools()
      .filter((t) => t.function.name === 'set_avatar_expression');

    return this.runChatCompletion({
      wireMessages,
      tools: reactionTools,
      config,
      ctx,
      preserveCurrentGesture: true,
    });
  }

  /**
   * Generates a brief, time-aware startup greeting via the LLM using the
   * `get_current_time` tool. Returns `null` if no LLM endpoint is configured
   * so avatar dialogue is never fabricated deterministically.
   */
  async generateStartupGreeting(params: {
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
  }): Promise<ReasoningTurnResult | null> {
    const {config, ctx} = params;
    if (!this.isEndpointConfigured(config)) {
      return null;
    }

    return this.generateReply({
      userText:
        '[System startup] Call `get_current_time` right now, then say a brief, natural 1-2 sentence Korean greeting matched to the current time of day with neutral calm tone (`emotion: "neutral"`, `gesture: "idle"`). Do not explain features, controls, or what you can do.',
      history: [],
      config,
      ctx,
    });
  }

  private async runChatCompletion(params: {
    wireMessages: OpenAIWireMessage[];
    tools: ReturnType<PluginRegistry['toOpenAITools']>;
    config: OpenAICompatConfig;
    ctx: PluginExecutionContext;
    preserveCurrentGesture?: boolean;
  }): Promise<ReasoningTurnResult> {
    const {wireMessages, tools, config, ctx, preserveCurrentGesture = false} = params;
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
        if (!preserveCurrentGesture || g === AvatarGesture.IDLE) {
          ctx.playGesture(g);
        }
      },
    };

    for (let round = 0; round < 3; round++) {
      const activeTools = round === 2 ? [] : tools;
      const data = await this.callEndpoint(config, wireMessages, activeTools);
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (!msg) {
        throw new Error('Empty response from OpenAI-compatible model.');
      }

      if (msg.tool_calls && msg.tool_calls.length > 0 && round < 2) {
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
      if (gesture && (!preserveCurrentGesture || gesture === AvatarGesture.IDLE)) {
        resolvedGesture = gesture;
        ctx.playGesture(gesture);
      }
      if (pluginLogs.length === 0) {
        ctx.setEmotion(resolvedEmotion);
        if (!preserveCurrentGesture) {
          ctx.playGesture(resolvedGesture);
        }
      }
      if (!cleaned) {
        throw new Error('Model returned an empty dialogue response.');
      }
      return {
        reply: cleaned,
        emotion: resolvedEmotion,
        gesture: resolvedGesture,
        pluginLogs,
      };
    }

    throw new Error('Model did not produce a final dialogue response after tool calls.');
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
}
