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

test('OpenAICompatibleClient forwards useServerDefaults=true and never mixes fallback on API failure', async () => {
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
          config: {...DEFAULT_OPENAI_CONFIG, demoFallbackEnabled: true},
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
    assert.equal(res.usedDemoFallback, false);
    assert.equal(res.emotion, AvatarEmotion.HAPPY);
    assert.equal(res.gesture, AvatarGesture.NOD);
    assert.equal(res.reply, '비 오는 창가에서 듣는 잔잔한 비트 감성이지!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAICompatibleClient uses pure offline demo persona only when no API key is present', async () => {
  const registry = new PluginRegistry();
  const client = new OpenAICompatibleClient(registry);
  client.setServerKeyAvailable(false);

  const res = await client.generateReply({
    userText: '안녕!',
    history: [],
    config: {...DEFAULT_OPENAI_CONFIG, demoFallbackEnabled: true},
    ctx: makeCtx(),
  });
  assert.equal(res.usedDemoFallback, true);
  assert.ok(!res.reply.includes('API fallback'));
});
