import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_OPENAI_CONFIG} from '../constants';
import {AvatarEmotion, AvatarGesture, PluginExecutionContext} from '../types';
import {
  OpenAICompatibleClient,
  parseInlineExpressionTags,
} from './OpenAICompatibleClient';
import {PluginRegistry} from './PluginRegistry';

function createStubContext(): {
  ctx: PluginExecutionContext;
  state: {emotion: AvatarEmotion; gesture: AvatarGesture; affinity: number};
} {
  const state = {
    emotion: AvatarEmotion.NEUTRAL,
    gesture: AvatarGesture.IDLE,
    affinity: 50,
  };
  const memories: Record<string, string> = {};
  return {
    state,
    ctx: {
      setEmotion: (e) => (state.emotion = e),
      playGesture: (g) => (state.gesture = g),
      setStageTheme: () => {},
      toggleXRMode: () => {},
      displayGeneratedArt: () => {},
      requestGeneratedImage: async () => ({imageUrl: 'data:image/png;base64,abc'}),
      getMemories: () => ({...memories}),
      saveMemory: (k, v) => {
        memories[k] = v;
      },
      addAffinity: (delta) => {
        state.affinity += delta;
        return state.affinity;
      },
    },
  };
}

test('PluginRegistry executes built-in emotion_director and imouto_dice_chaos plugins', async () => {
  const registry = new PluginRegistry();
  const tools = registry.toOpenAITools();
  assert.ok(tools.length >= 6);

  const {ctx, state} = createStubContext();
  const emoResult = await registry.executeToolCall(
    'set_avatar_expression',
    JSON.stringify({emotion: 'tsundere', gesture: 'shy_fidget', affinityDelta: 5}),
    ctx
  );
  assert.equal(state.emotion, AvatarEmotion.TSUNDERE);
  assert.equal(state.gesture, AvatarGesture.SHY_FIDGET);
  assert.equal(emoResult.result.affinity, 55);

  const diceResult = await registry.executeToolCall(
    'roll_imouto_chaos',
    {mode: 'dice', sides: 20},
    ctx
  );
  const roll = Number(diceResult.result.roll);
  assert.ok(roll >= 1 && roll <= 20);
});

test('PluginRegistry supports disabling, custom registration, and inline tag parsing', async () => {
  const registry = new PluginRegistry();
  const custom = registry.registerCustomPlugin({
    name: 'Hype Counter',
    description: 'Adds stream hype',
    parameterName: 'topic',
    parameterDescription: 'Topic',
    responseTemplate: 'HYPE={{input}}',
    emotionOnRun: AvatarEmotion.LOVE,
  });

  const {ctx, state} = createStubContext();
  const res = await registry.executeToolCall(custom.schema.function.name, {topic: 'WebXR'}, ctx);
  assert.equal(res.result.output, 'HYPE=WebXR');
  assert.equal(state.emotion, AvatarEmotion.LOVE);

  registry.setEnabled(custom.id, false);
  const disabledRes = await registry.executeToolCall(custom.schema.function.name, {topic: 'WebXR'}, ctx);
  assert.ok('error' in disabledRes.result);

  const parsed = parseInlineExpressionTags('Hello chat! [emotion:sassy] [gesture:spin_joy]');
  assert.equal(parsed.cleaned, 'Hello chat!');
  assert.equal(parsed.emotion, AvatarEmotion.SASSY);
  assert.equal(parsed.gesture, AvatarGesture.SPIN_JOY);
});

test('PluginRegistry executes built-in move_and_interact_room MotionBricks plugin', async () => {
  const registry = new PluginRegistry();
  const {ctx} = createStubContext();
  let triggered: {target: string; pose?: string} | null = null;
  ctx.triggerRoomAction = (target, pose) => {
    triggered = {target, pose};
    return {ok: true, message: `Moving to ${target}`};
  };

  const res = await registry.executeToolCall(
    'move_and_interact_room',
    {target: 'bed', pose: 'lounge_bed'},
    ctx
  );
  assert.deepEqual(triggered, {target: 'bed', pose: 'lounge_bed'});
  assert.equal(res.result.ok, true);
});

test('PluginRegistry executes get_current_time and OpenAICompatibleClient generates startup greeting via LLM tool call only', async () => {
  const registry = new PluginRegistry();
  const {ctx} = createStubContext();
  const timeRes = await registry.executeToolCall('get_current_time', {locale: 'ko-KR'}, ctx);
  assert.equal(typeof timeRes.result.hour, 'number');
  assert.equal(typeof timeRes.result.localTime, 'string');
  assert.ok(String(timeRes.result.localTime).length > 0);

  const client = new OpenAICompatibleClient(registry);
  // Without an LLM key, startup greeting must NOT return deterministic hardcoded speech
  const unconfigured = await client.generateStartupGreeting({
    config: {...DEFAULT_OPENAI_CONFIG, baseUrl: 'https://api.openai.com/v1', apiKey: ''},
    ctx,
  });
  assert.equal(unconfigured, null);

  // With server key configured, startup greeting invokes LLM + get_current_time tool
  client.setServerKeyAvailable(true);
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_time_1',
                    type: 'function',
                    function: {
                      name: 'get_current_time',
                      arguments: JSON.stringify({locale: 'ko-KR'}),
                    },
                  },
                ],
              },
            },
          ],
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}}
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '지금 시간 보니까 딱 쉬기 좋은 오후네, 오늘 어때?',
            },
          },
        ],
      }),
      {status: 200, headers: {'Content-Type': 'application/json'}}
    );
  }) as typeof fetch;

  try {
    const greeting = await client.generateStartupGreeting({
      config: {...DEFAULT_OPENAI_CONFIG},
      ctx,
    });
    assert.ok(greeting !== null);
    assert.ok(
      greeting.pluginLogs.some((log) => log.toolName === 'get_current_time'),
      'Startup greeting must record get_current_time tool call'
    );
    assert.equal(
      greeting.reply,
      '지금 시간 보니까 딱 쉬기 좋은 오후네, 오늘 어때?'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

