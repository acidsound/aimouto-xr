import RAPIER from '@dimforge/rapier3d-simd-compat';
import * as xb from 'xrblocks';
import {OpenAICompatibleClient} from './ai/OpenAICompatibleClient';
import {
  loadStoredMemories,
  PluginRegistry,
  saveStoredMemory,
} from './ai/PluginRegistry';
import {VoiceManager} from './audio/VoiceManager';
import {DEFAULT_OPENAI_CONFIG, STAGE_THEMES} from './constants';
import {NeuroAvatarScene} from './scene/NeuroAvatarScene';
import {
  AvatarEmotion,
  AvatarGesture,
  ChatMessage,
  GeneratedImageAspect,
  GeneratedImageSize,
  OpenAICompatConfig,
  PluginExecutionContext,
  StageThemeId,
} from './types';
import {AnimeHudController} from './ui/AnimeHudController';

const STORAGE_OPENAI_KEY = 'aimouto_xr_openai_config_v1';

function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function loadOpenAIConfig(): OpenAICompatConfig {
  try {
    const raw = localStorage.getItem(STORAGE_OPENAI_KEY);
    if (!raw) return {...DEFAULT_OPENAI_CONFIG};
    const parsed = JSON.parse(raw) as Partial<OpenAICompatConfig>;
    const merged: OpenAICompatConfig = {
      ...DEFAULT_OPENAI_CONFIG,
      ...parsed,
      apiKey: '',
    };
    // Migrate older saved configs that kept stock OpenAI placeholder defaults
    if (parsed.customEndpoint === undefined) {
      merged.customEndpoint = !(
        merged.baseUrl === DEFAULT_OPENAI_CONFIG.baseUrl &&
        merged.model === DEFAULT_OPENAI_CONFIG.model
      );
    }
    return merged;
  } catch {
    return {...DEFAULT_OPENAI_CONFIG};
  }
}

class NeuroAppController extends xb.Script {
  private readonly registry = new PluginRegistry();
  private readonly aiClient = new OpenAICompatibleClient(this.registry);
  private openAIConfig = loadOpenAIConfig();
  private affinity = 75;
  private currentEmotion = AvatarEmotion.NEUTRAL;
  private currentGesture = AvatarGesture.IDLE;
  private messages: ChatMessage[] = [
    {
      id: 'init-1',
      role: 'assistant',
      content: '...',
      emotion: AvatarEmotion.NEUTRAL,
      gesture: AvatarGesture.IDLE,
      timestamp: Date.now(),
    },
  ];

  private scene!: NeuroAvatarScene;
  private hud!: AnimeHudController;
  private voice!: VoiceManager;
  private hudLoopActive = false;
  private serverHealthPromise: Promise<void> | null = null;
  private serverDefaults: {baseUrl: string; model: string} = {
    baseUrl: DEFAULT_OPENAI_CONFIG.baseUrl,
    model: DEFAULT_OPENAI_CONFIG.model,
  };

  constructor(private readonly isSoftwareGl: boolean) {
    super();
  }

  init(): void {
    this.voice = new VoiceManager({
      onTranscript: (text, isFinal) => {
        this.hud.setTranscriptDraft(text);
        if (isFinal && text) {
          this.hud.setTranscriptDraft('');
          void this.handleUserMessage(text);
        }
      },
      onError: (err) => {
        this.pushAssistantMessage(`(Voice) ${err}`, AvatarEmotion.SURPRISED);
      },
    });

    this.scene = new NeuroAvatarScene(this.isSoftwareGl, {
      onAvatarPoke: () => {
        this.affinity = Math.min(100, this.affinity + 2);
        this.setAvatarExpression(AvatarEmotion.TSUNDERE, AvatarGesture.SHY_FIDGET);
        const line = 'H-hey! 손잡고 데리고 다닐 거면 먼저 말해줘야지~!';
        this.pushAssistantMessage(line, AvatarEmotion.TSUNDERE, AvatarGesture.SHY_FIDGET);
        this.voice.speak(line);
      },
      onPropInteracted: (_propId, _pose, reactionText) => {
        this.affinity = Math.min(100, this.affinity + 1);
        this.pushAssistantMessage(reactionText, this.currentEmotion, AvatarGesture.IDLE);
        this.syncHudStatus();
      },
      onHandHoldChanged: (active) => {
        this.hud.setHandHoldActive(active);
      },
      onMotionStateChanged: (snapshot) => {
        this.hud.updateMotionState(snapshot);
      },
      onHoverHintChanged: (hint) => {
        this.hud.setHoverHint(hint);
      },
      onSpatialChatSubmit: (text) => {
        void this.handleUserMessage(text);
      },
      onSpatialQuickAction: (actionId) => {
        if (actionId === 'pose_wave') this.setAvatarExpression(AvatarEmotion.HAPPY, AvatarGesture.WAVE);
        else if (actionId === 'pose_spin') this.setAvatarExpression(AvatarEmotion.HAPPY, AvatarGesture.SPIN_JOY);
        else if (actionId === 'trigger_chaos') void this.handleUserMessage('주사위 굴려줘!');
        else if (actionId === 'cycle_stage') this.cycleStageTheme();
      },
      onXRModeChanged: (inXR) => {
        this.hud.setVisible(!inXR);
      },
      onVrmLoaded: (info) => {
        this.hud.updateVrmInfo(info);
      },
      onVrmError: (err) => {
        this.hud.setVrmError(err);
        this.pushAssistantMessage(`VRM load failed: ${err}`, AvatarEmotion.SURPRISED);
      },
      onVRStatusChanged: (status) => {
        this.hud.updateVRStatus(status);
      },
    });
    this.add(this.scene);

    this.hud = new AnimeHudController(
      this.registry,
      this.openAIConfig,
      this.messages,
      {
        onSendMessage: (text) => void this.handleUserMessage(text),
        onToggleMic: () => void this.voice.toggleListening(),
        onToggleTtsMute: () => this.voice.toggleMute(),
        onToggleLanguage: () => {
          this.voice.setLanguage(
            this.voice.language === 'ko-KR' ? 'en-US' : 'ko-KR'
          );
        },
        onSelectEmotion: (emotion) => {
          this.setAvatarExpression(emotion, this.currentGesture);
        },
        onSelectGesture: (gesture) => {
          this.setAvatarExpression(this.currentEmotion, gesture);
        },
        onSelectStageTheme: (theme) => {
          this.scene.setStageTheme(theme);
          this.syncHudStatus();
        },
        onToggleSkeleton: () => {
          this.scene.setSkeletonVisible(!this.scene.skeletonVisible);
          this.syncHudStatus();
        },
        onToggleSpatialCards: () => {
          this.scene.setSpatialCardsVisible(!this.scene.spatialCardsEnabled);
          this.syncHudStatus();
        },
        onToggleXRPassMode: () => {
          this.scene.toggleARVR();
        },
        onTriggerRoomProp: (propId) => {
          this.scene.interactWithProp(propId);
        },
        onToggleHandHold: () => {
          const active = this.scene.togglePinnedHandHoldMode();
          if (active) {
            this.pushAssistantMessage(
              '손 잡았어! 마우스나 컨트롤러를 움직이면 방 안을 같이 따라갈게~',
              AvatarEmotion.LOVE,
              AvatarGesture.IDLE
            );
          }
        },
        onEnterImmersiveVR: () => this.scene.handleXRButtonClick(),
        onLoadVrmUrl: async (url) => {
          const info = await this.scene.loadVrmFromUrl(url);
          this.setAvatarExpression(AvatarEmotion.NEUTRAL, AvatarGesture.IDLE);
          this.pushAssistantMessage(
            `Switched to VRM avatar "${info.name}" (${info.specVersion})!`,
            AvatarEmotion.NEUTRAL,
            AvatarGesture.IDLE
          );
          return info;
        },
        onLoadVrmFile: async (file) => {
          const info = await this.scene.loadVrmFromFile(file);
          this.setAvatarExpression(AvatarEmotion.NEUTRAL, AvatarGesture.IDLE);
          this.pushAssistantMessage(
            `Loaded your local VRM "${info.name}" (${info.specVersion})!`,
            AvatarEmotion.NEUTRAL,
            AvatarGesture.IDLE
          );
          return info;
        },
        onResetDefaultVrm: async () => {
          const info = await this.scene.resetDefaultVrm();
          if (info) {
            this.setAvatarExpression(AvatarEmotion.NEUTRAL, AvatarGesture.IDLE);
            this.pushAssistantMessage(
              `Reset to default VRM avatar "${info.name}" (${info.specVersion})!`,
              AvatarEmotion.NEUTRAL,
              AvatarGesture.IDLE
            );
          }
          return info;
        },
        onUpdateOpenAIConfig: (cfg) => {
          this.openAIConfig = cfg;
          localStorage.setItem(STORAGE_OPENAI_KEY, JSON.stringify(cfg));
        },
        onGenerateImage: (prompt, size, aspect) =>
          this.requestGeneratedImage(prompt, size, aspect),
        onDisplayArtOnStage: (imageUrl) => {
          this.scene.showGeneratedArt(imageUrl);
        },
      }
    );

    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('dragover', this.handleWindowDragOver);
    window.addEventListener('drop', this.handleWindowDrop);
    this.hud.mount(document.body);
    this.hud.setVisible(false);
    this.syncHudStatus();
    this.serverHealthPromise = this.syncServerHealth();
    void this.runStartupGreeting();
  }

  private async runStartupGreeting(): Promise<void> {
    if (this.serverHealthPromise) {
      await this.serverHealthPromise;
    }
    try {
      const result = await this.aiClient.generateStartupGreeting({
        config: this.openAIConfig,
        ctx: this.buildPluginContext(),
      });
      this.currentEmotion = result.emotion;
      this.currentGesture = result.gesture;
      this.syncHudStatus();

      const greetingMsg: ChatMessage = {
        id: 'init-1',
        role: 'assistant',
        content: result.reply,
        emotion: result.emotion,
        gesture: result.gesture,
        pluginCalls: result.pluginLogs,
        timestamp: Date.now(),
      };
      this.messages = [greetingMsg];
      this.hud.updateDialogue(greetingMsg, this.messages);
      this.scene.setDialogueSubtitle(result.reply);
    } catch {
      // Keep simple greeting if startup greeting encounters an unexpected failure
    }
  }

  private async parseJsonSafely<T>(response: Response): Promise<T | null> {
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const trimmed = rawText.trimStart();
    if (/text\/html|application\/xhtml/i.test(contentType) || trimmed.startsWith('<')) {
      return null;
    }
    try {
      return JSON.parse(rawText) as T;
    } catch {
      return null;
    }
  }

  private async syncServerHealth(): Promise<void> {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) return;
      const health = await this.parseJsonSafely<{
        hasGeminiKey?: boolean;
        hasOpenAICompatKey?: boolean;
        defaultOpenAIBaseUrl?: string;
        defaultOpenAIModel?: string;
      }>(res);
      if (!health) return;
      if (health.defaultOpenAIBaseUrl) {
        this.serverDefaults.baseUrl = health.defaultOpenAIBaseUrl;
      }
      if (health.defaultOpenAIModel) {
        this.serverDefaults.model = health.defaultOpenAIModel;
      }

      if (!this.openAIConfig.customEndpoint) {
        this.openAIConfig = {
          ...this.openAIConfig,
          baseUrl: this.serverDefaults.baseUrl,
          model: this.serverDefaults.model,
          customEndpoint: false,
        };
        this.hud.setOpenAIConfig(this.openAIConfig);
      }

      this.aiClient.setServerKeyAvailable(Boolean(health.hasOpenAICompatKey));
      this.hud.setServerKeyStatus({
        openAI: Boolean(health.hasOpenAICompatKey),
        gemini: Boolean(health.hasGeminiKey),
        defaultBaseUrl: this.serverDefaults.baseUrl,
        defaultModel: this.serverDefaults.model,
      });
    } catch {
      // Ignore if running standalone static preview
    }
  }

  onSimulatorStarted(): void {
    document.body.dataset.state = 'active';
    this.hud.setVisible(true);
    this.hudLoopActive = true;
    this.syncHudStatus();
  }

  onXRSessionStarted(): void {
    document.body.dataset.state = 'xr';
    this.hud.setVisible(false);
    this.hudLoopActive = true;
  }

  onXRSessionEnded(): void {
    document.body.dataset.state = 'active';
    this.hud.setVisible(true);
  }

  private handlePointerMove = (e: PointerEvent): void => {
    const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = -((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
    this.scene?.setGazeNDC(nx, ny);
  };

  private handleWindowDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
    }
  };

  private handleWindowDrop = (e: DragEvent): void => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.vrm') && !lower.endsWith('.glb')) return;
    e.preventDefault();
    void this.scene
      .loadVrmFromFile(file)
      .then((info) => {
        this.pushAssistantMessage(
          `Dropped VRM "${info.name}" (${info.specVersion}) onto the stage!`,
          AvatarEmotion.HAPPY,
          AvatarGesture.WAVE
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.hud.setVrmError(msg);
      });
  };

  private setAvatarExpression(emotion: AvatarEmotion, gesture: AvatarGesture): void {
    this.currentEmotion = emotion;
    this.currentGesture = gesture;
    this.scene.setEmotion(emotion);
    this.scene.playGesture(gesture);
    this.syncHudStatus();
  }

  private cycleStageTheme(): void {
    const keys = Object.keys(STAGE_THEMES) as StageThemeId[];
    const idx = keys.indexOf(this.scene.stageTheme);
    const next = keys[(idx + 1) % keys.length];
    this.scene.setStageTheme(next);
    this.syncHudStatus();
  }

  private syncHudStatus(): void {
    this.hud.updateAvatarStatus({
      emotion: this.currentEmotion,
      gesture: this.currentGesture,
      affinity: this.affinity,
      skeletonVisible: this.scene.skeletonVisible,
      spatialVisible: this.scene.spatialCardsEnabled,
      stageTheme: this.scene.stageTheme,
    });
  }

  private async requestGeneratedImage(
    prompt: string,
    imageSize: GeneratedImageSize = '1K',
    aspectRatio: GeneratedImageAspect = '1:1'
  ): Promise<{imageUrl?: string; error?: string}> {
    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({prompt, imageSize, aspectRatio}),
      });
      const data = await this.parseJsonSafely<{
        imageUrl?: string;
        error?: string;
      }>(response);
      if (!data) {
        return {
          error: `Image endpoint returned non-JSON response (HTTP ${response.status}).`,
        };
      }
      if (!response.ok) {
        return {error: data.error || `Image API error (${response.status})`};
      }
      return {imageUrl: data.imageUrl};
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildPluginContext(): PluginExecutionContext {
    return {
      setEmotion: (emotion) => {
        this.currentEmotion = emotion;
        this.scene.setEmotion(emotion);
        this.syncHudStatus();
      },
      playGesture: (gesture) => {
        this.currentGesture = gesture;
        this.scene.playGesture(gesture);
        this.syncHudStatus();
      },
      setStageTheme: (theme) => {
        this.scene.setStageTheme(theme);
        this.syncHudStatus();
      },
      toggleXRMode: (mode) => {
        this.scene.toggleARVR(mode);
      },
      displayGeneratedArt: (imageUrl) => {
        this.scene.showGeneratedArt(imageUrl);
      },
      requestGeneratedImage: (prompt, imageSize, aspectRatio) =>
        this.requestGeneratedImage(prompt, imageSize, aspectRatio),
      getMemories: () => loadStoredMemories(),
      saveMemory: (key, value) => saveStoredMemory(key, value),
      addAffinity: (delta) => {
        this.affinity = Math.max(0, Math.min(100, this.affinity + delta));
        this.syncHudStatus();
        return this.affinity;
      },
      triggerRoomAction: (target, pose) =>
        this.scene.interactWithProp(target, undefined, pose),
    };
  }

  async handleUserMessage(userText: string): Promise<void> {
    if (this.serverHealthPromise) {
      await this.serverHealthPromise;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);

    this.hud.setBusy(true);
    this.setAvatarExpression(AvatarEmotion.THINKING, AvatarGesture.THINK_POSE);

    try {
      const result = await this.aiClient.generateReply({
        userText,
        history: this.messages,
        config: this.openAIConfig,
        ctx: this.buildPluginContext(),
      });

      this.currentEmotion = result.emotion;
      this.currentGesture = result.gesture;
      this.syncHudStatus();

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        emotion: result.emotion,
        gesture: result.gesture,
        pluginCalls: result.pluginLogs,
        timestamp: Date.now(),
      };
      this.messages.push(assistantMsg);
      this.hud.updateDialogue(assistantMsg, this.messages);
      this.scene.setDialogueSubtitle(result.reply);
      this.voice.speak(result.reply);
    } catch (error) {
      const rawErr = error instanceof Error ? error.message : String(error);
      const looksHtmlOrParse =
        /Unexpected token\s*['"]?<|<!doctype|is not valid JSON|returned HTML|non-JSON/i.test(
          rawErr
        );
      const safeMsg = looksHtmlOrParse
        ? 'API 서버가 JSON 대신 HTML 페이지를 반환했어! Model API 설정에서 Base URL(예: /v1 포함)과 API 키를 확인해줘.'
        : rawErr;
      this.pushAssistantMessage(
        safeMsg,
        AvatarEmotion.SURPRISED,
        AvatarGesture.SHAKE_HEAD
      );
    } finally {
      this.hud.setBusy(false);
    }
  }

  private pushAssistantMessage(
    content: string,
    emotion = AvatarEmotion.NEUTRAL,
    gesture = AvatarGesture.IDLE
  ): void {
    const msg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content,
      emotion,
      gesture,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.hud.updateDialogue(msg, this.messages);
    this.scene.setDialogueSubtitle(content);
  }

  update(): void {
    const dt = xb.getDeltaTime() || 0.016;
    const voiceTick = this.voice.update(dt);
    this.scene.setVoiceState({
      mouthOpen: voiceTick.mouthOpen,
      viseme: voiceTick.viseme,
      speaking: this.voice.speaking,
    });
    if (this.hudLoopActive) {
      this.hud.updateVoiceVisuals({
        listening: this.voice.listening,
        speaking: this.voice.speaking,
        muted: this.voice.muted,
        lang: this.voice.language,
        eqBars: voiceTick.eqBars,
      });
    }
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('dragover', this.handleWindowDragOver);
    window.removeEventListener('drop', this.handleWindowDrop);
    this.voice?.dispose();
    this.hud?.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const isSoftwareGl = detectSoftwareWebGL();
  const options = new xb.Options();
  options.setAppTitle('AIMouto-XR');
  options.setAppDescription(
    'AIMouto-XR (AI + imouto): 3D VRM Little Sister Companion • OpenAI-Compatible API + Plugins'
  );
  options.xrSessionMode = 'immersive-vr';
  options.referenceSpaceType = 'local-floor';
  options.enableXRTransitions();
  options.physics.RAPIER = RAPIER as unknown as NonNullable<
    xb.Options['physics']['RAPIER']
  >;
  options.physics.fps = 60;
  options.physics.gravity = {x: 0, y: -9.81, z: 0};
  options.physics.worldStep = true;
  options.physics.useEventQueue = true;
  options.antialias = !isSoftwareGl;
  options.reticles.enabled = false;
  options.simulator.renderToRenderTexture = false;
  options.simulator.instructions.showAutomatically = false;
  options.simulator.instructions.overlayEnabled = false;
  options.simulator.simulatorSettingsPanel.enabled = false;
  // Disable XR Blocks' built-in default apartment GLB (prevents stray couch/room assets outside AIMouto's bedroom)
  options.simulator.environments = [
    {
      name: 'AIMouto Bedroom',
      manifestPath:
        'data:application/json,' + encodeURIComponent(JSON.stringify({objects: []})),
    },
  ];
  options.simulator.activeEnvironmentIndex = 0;
  options.xrButton.showEnterSimulatorButton = true;
  options.xrButton.startSimulatorText = 'Launch 3D Avatar';
  options.xrButton.startText = 'Enter VR';
  options.xrButton.endText = 'Exit VR';

  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    options.xrButton.alwaysAutostartSimulator = true;
  }

  const appController = new NeuroAppController(isSoftwareGl);
  xb.add(appController);
  void xb.init(options).then(() => {
    // Wire landing XRButton click handler for immersive VR scene setup
    const landingXrBtn = xb.core.xrButton?.xrButtonElement;
    if (landingXrBtn) {
      landingXrBtn.addEventListener('click', () => {
        const sceneScript = appController.children.find(
          (c): c is NeuroAvatarScene => c instanceof NeuroAvatarScene
        );
        if (!xb.core.webXRSessionManager?.isXRSupported()) {
          void xb.core.xrButton?.startSimulator?.();
        }
        void sceneScript?.handleXRButtonClick();
      });
    }
  });
});
