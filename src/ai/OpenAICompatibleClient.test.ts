import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_OPENAI_CONFIG} from '../constants';
import {AvatarEmotion, AvatarGesture, PluginExecutionContext} from '../types';
import {OpenAICompatibleClient} from './OpenAICompatibleClient';
import {PluginRegistry} from './PluginRegistry';

function makeCtx(): PluginExecutionContext {
  return {
    setEmotion: () => {},
    playGesture: () => {},
    setStageTheme: () => {},
    toggleXRMode: () => {},
    displayGeneratedArt: () => {},
    requestGeneratedImage: async () => ({imageUrl: ''}),
    getMemories: () => ({}),
    saveMemory: () => {},
    addAffinity: () => 75,
  };
}

test('OpenAICompatibleClient forwards useServerDefaults=true and never falls back on API failure', async () => {
  const registry = new PluginRegistry();
  const client = new OpenAICompatibleClient(registry);
  client.setServerKeyAvailable(true);

  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({error: 'Incorrect API key provided'}), {
      status: 401,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        client.generateReply({
          userText: '밤비 내리는 방 감성이 뭔데 ㅋㅋㅋ',
          history: [],
          config: {...DEFAULT_OPENAI_CONFIG},
          ctx: makeCtx(),
        }),
      /Incorrect API key provided/
    );
    assert.equal(capturedBody?.['useServerDefaults'], true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAICompatibleClient returns live API reply cleanly when upstream succeeds', async () => {
  const registry = new PluginRegistry();
  const client = new OpenAICompatibleClient(registry);
  client.setServerKeyAvailable(true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '비 오는 창가에서 듣는 잔잔한 비트 감성이지! [emotion:happy] [gesture:nod]',
            },
          },
        ],
      }),
      {status: 200, headers: {'Content-Type': 'application/json'}}
    )) as typeof fetch;

  try {
    const res = await client.generateReply({
      userText: '밤비 내리는 방 감성이 뭔데?',
      history: [],
      config: {...DEFAULT_OPENAI_CONFIG},
      ctx: makeCtx(),
    });
    assert.equal(res.emotion, AvatarEmotion.HAPPY);
    assert.equal(res.gesture, AvatarGesture.NOD);
    assert.equal(res.reply, '비 오는 창가에서 듣는 잔잔한 비트 감성이지!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAICompatibleClient never fabricates deterministic avatar speech when no API key is configured', async () => {
  const registry = new PluginRegistry();
  const client = new OpenAICompatibleClient(registry);
  client.setServerKeyAvailable(false);

  await assert.rejects(
    () =>
      client.generateReply({
        userText: '안녕!',
        history: [],
        config: {...DEFAULT_OPENAI_CONFIG},
        ctx: makeCtx(),
      }),
    /LLM API가 설정되지 않았습니다/
  );

  const reaction = await client.generateActionReaction({
    situation: '사용자가 AIMouto의 손을 잡고 방 안을 약 1.1m 걸어 침대 근처까지 함께 이동한 뒤 손을 놓았다.',
    history: [],
    config: {...DEFAULT_OPENAI_CONFIG},
    ctx: makeCtx(),
  });
  assert.equal(reaction, null);

  const greeting = await client.generateStartupGreeting({
    config: {...DEFAULT_OPENAI_CONFIG},
    ctx: makeCtx(),
  });
  assert.equal(greeting, null);
});

test('generateActionReaction sends factual situation (prop or hand-hold) and prior history to LLM while excluding trigger_room_action', async () => {
  const registry = new PluginRegistry();
  const client = new OpenAICompatibleClient(registry);
  client.setServerKeyAvailable(true);

  type CapturedRequestBody = {
    messages?: Array<{role: string; content: string}>;
    tools?: Array<{function: {name: string}}>;
  };
  let capturedBody: CapturedRequestBody = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as CapturedRequestBody;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '갑자기 손잡고 침대 쪽으로 데려오다니 좀 놀랐잖아~ [emotion:love]',
            },
          },
        ],
      }),
      {status: 200, headers: {'Content-Type': 'application/json'}}
    );
  }) as typeof fetch;

  try {
    const res = await client.generateActionReaction({
      situation:
        '사용자가 AIMouto의 손을 잡고 방 안을 약 1.2m 걸어 침대 근처까지 함께 이동한 뒤 손을 놓았다.',
      history: [
        {
          id: 'u-1',
          role: 'user',
          content: '잠깐 이쪽으로 같이 가자',
          timestamp: 1,
        },
      ],
      config: {...DEFAULT_OPENAI_CONFIG},
      ctx: makeCtx(),
    });

    assert.ok(res !== null);
    assert.equal(res.reply, '갑자기 손잡고 침대 쪽으로 데려오다니 좀 놀랐잖아~');
    assert.equal(res.emotion, AvatarEmotion.LOVE);

    const msgs = capturedBody.messages ?? [];
    assert.ok(msgs.some((m) => m.content.includes('잠깐 이쪽으로 같이 가자')));
    assert.ok(
      msgs.some((m) =>
        m.content.includes('손을 잡고 방 안을 약 1.2m 걸어 침대 근처까지 함께 이동한 뒤 손을 놓았다.')
      )
    );
    const toolNames = (capturedBody.tools ?? []).map((t) => t.function.name);
    assert.ok(!toolNames.includes('move_and_interact_room'));
    assert.ok(toolNames.includes('set_avatar_expression'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
