import {PluginRegistry} from '../ai/PluginRegistry';
import {LoadedVrmInfo} from '../avatar/VrmAvatarManager';
import {DEFAULT_VRM_URL, VRM_PRESETS} from '../avatar/vrmUtils';
import {
  CONCEPT_UI_IMAGE_PATH,
  EMOTION_PRESETS,
  GESTURE_LABELS,
  STAGE_THEMES,
} from '../constants';
import {SceneHoverHint} from '../scene/NeuroAvatarScene';
import {VRSessionStatus} from '../scene/vrSessionController';
import {
  AvatarEmotion,
  AvatarGesture,
  ChatMessage,
  GeneratedImageAspect,
  GeneratedImageSize,
  MotionBrickSnapshot,
  OpenAICompatConfig,
  RoomPropId,
  StageThemeId,
} from '../types';
import {
  ANIME_UI_BLUEPRINT,
  blueprintToSpatialCardConfigs,
} from './animeUiBlueprint';

export interface HudActions {
  onSendMessage: (text: string) => void;
  onToggleMic: () => void;
  onToggleTtsMute: () => void;
  onToggleLanguage: () => void;
  onSelectEmotion: (emotion: AvatarEmotion) => void;
  onSelectGesture: (gesture: AvatarGesture) => void;
  onSelectStageTheme: (theme: StageThemeId) => void;
  onToggleSkeleton: () => void;
  onToggleSpatialCards: () => void;
  onToggleXRPassMode: () => void;
  onTriggerRoomProp: (propId: RoomPropId) => void;
  onToggleHandHold: () => void;
  onEnterImmersiveVR: () => Promise<VRSessionStatus>;
  onLoadVrmUrl: (url: string) => Promise<LoadedVrmInfo>;
  onLoadVrmFile: (file: File) => Promise<LoadedVrmInfo>;
  onResetDefaultVrm: () => Promise<LoadedVrmInfo | null>;
  onUpdateOpenAIConfig: (cfg: OpenAICompatConfig) => void;
  onGenerateImage: (
    prompt: string,
    size: GeneratedImageSize,
    aspect: GeneratedImageAspect
  ) => Promise<{imageUrl?: string; error?: string}>;
  onDisplayArtOnStage: (imageUrl: string) => void;
}

type ActiveDrawer = 'none' | 'vrm' | 'plugins' | 'model' | 'art' | 'blueprint';

/**
 * Renders the Anime-styled 2D HUD matching the Full-Body 3D Anime UI Blueprint
 * (`fullbody_3d_anime_ui_1794853648830.jpg`), keeping the central 3D avatar
 * viewport completely unobstructed while providing full interactive drawers for
 * Plugins, OpenAI Compatible API config, and Gemini 3 Pro Image (1K/2K/4K).
 */
export class AnimeHudController {
  readonly root: HTMLDivElement;

  private emotionPillEl!: HTMLSpanElement;
  private poseLabelEl!: HTMLSpanElement;
  private affinityFillEl!: HTMLDivElement;
  private affinityTextEl!: HTMLSpanElement;
  private eqBarEls: HTMLDivElement[] = [];
  private eqStatusEl!: HTMLSpanElement;

  private subtitleEl!: HTMLDivElement;
  private pluginLogChipRow!: HTMLDivElement;
  private chatInputEl!: HTMLInputElement;
  private sendBtnEl!: HTMLButtonElement;
  private micBtnEl!: HTMLButtonElement;
  private inputMicBtnEl!: HTMLButtonElement;
  private ttsStatusBadgeEl!: HTMLSpanElement;
  private langBtnEl!: HTMLButtonElement;
  private rigToggleBtnEl!: HTMLButtonElement;
  private spatialToggleBtnEl!: HTMLButtonElement;
  private handHoldBtnEl!: HTMLButtonElement;
  private hoverHintEl!: HTMLDivElement;
  private avatarNameEl!: HTMLSpanElement;
  private rigTagEl!: HTMLSpanElement;
  private xrLaunchBtnEl!: HTMLButtonElement;
  private physicsStatusEl!: HTMLDivElement;

  private drawerBackdropEl!: HTMLDivElement;
  private drawerBodyEl!: HTMLDivElement;
  private drawerTitleEl!: HTMLHeadingElement;
  private activeDrawer: ActiveDrawer = 'none';

  private historyPanelEl!: HTMLDivElement;
  private historyVisible = false;

  private currentEmotion: AvatarEmotion = AvatarEmotion.NEUTRAL;
  private currentGesture: AvatarGesture = AvatarGesture.IDLE;
  private currentStageTheme: StageThemeId = 'midnight_neon';
  private affinity = 75;
  private isBusy = false;
  private lastGeneratedArtUrl = '';
  private selectedArtSize: GeneratedImageSize = '1K';
  private selectedArtAspect: GeneratedImageAspect = '1:1';
  private artStatusMessage = '';
  private vrmInfo: LoadedVrmInfo | null = null;
  private vrmStatusMessage = 'Loaded default VRM 1.0 avatar.';
  private vrmUrlDraft = DEFAULT_VRM_URL;
  private vrmLoading = false;
  private vrModeActive = false;
  private serverHasOpenAIKey = false;
  private serverHasGeminiKey = false;
  private serverDefaultBaseUrl = 'https://api.openai.com/v1';
  private serverDefaultModel = 'gpt-4o-mini';

  constructor(
    private readonly registry: PluginRegistry,
    private openAIConfig: OpenAICompatConfig,
    private messages: ChatMessage[],
    private readonly actions: HudActions
  ) {
    this.root = document.createElement('div');
    this.root.id = 'neuro-anime-hud';
    this.root.className = 'anime-hud-root';
    this.buildDom();

    this.registry.subscribe(() => {
      if (this.activeDrawer === 'plugins') {
        this.renderDrawerContent();
      }
    });
  }

  mount(parent: HTMLElement = document.body): void {
    if (!this.root.parentElement) {
      parent.appendChild(this.root);
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setOpenAIConfig(cfg: OpenAICompatConfig): void {
    this.openAIConfig = cfg;
    if (this.activeDrawer === 'model') {
      this.renderDrawerContent();
    }
  }

  setServerKeyStatus(opts: {
    openAI: boolean;
    gemini: boolean;
    defaultBaseUrl?: string;
    defaultModel?: string;
  }): void {
    this.serverHasOpenAIKey = opts.openAI;
    this.serverHasGeminiKey = opts.gemini;
    if (opts.defaultBaseUrl) this.serverDefaultBaseUrl = opts.defaultBaseUrl;
    if (opts.defaultModel) this.serverDefaultModel = opts.defaultModel;
    if (this.activeDrawer === 'model') {
      this.renderDrawerContent();
    }
  }

  private buildDom(): void {
    const theme = ANIME_UI_BLUEPRINT.theme;
    this.root.style.setProperty('--hud-panel-bg', theme.panelSurfaceRgb);
    this.root.style.setProperty('--hud-pink', theme.outerBorderPink);
    this.root.style.setProperty('--hud-cyan', theme.innerBorderCyan);
    this.root.style.setProperty('--hud-dialogue-bg', theme.dialogueFill);
    this.root.style.setProperty('--hud-dialogue-text', theme.dialogueText);

    this.root.innerHTML = `
      <div class="hud-top-row">
        <!-- Top-Left Full-Body 3D Status Card -->
        <section class="anime-card hud-status-card" aria-label="AIMouto-XR 3D Avatar Status">
          <div class="status-header">
            <div class="silhouette-badge" title="Full-Body 3D Rigged Humanoid">
              <svg viewBox="0 0 64 96" class="silhouette-svg" aria-hidden="true">
                <circle cx="32" cy="18" r="9" fill="#ff6ba8" stroke="#4be3ff" stroke-width="2"/>
                <path d="M22 15 Q13 28 16 46" stroke="#ff6ba8" stroke-width="4" fill="none" stroke-linecap="round"/>
                <path d="M42 15 Q51 28 48 46" stroke="#ff6ba8" stroke-width="4" fill="none" stroke-linecap="round"/>
                <path d="M25 29 L39 29 L43 52 L21 52 Z" fill="#ff6ba8" opacity="0.9"/>
                <path d="M24 31 L14 48 M40 31 L50 48" stroke="#4be3ff" stroke-width="3.5" stroke-linecap="round"/>
                <path d="M27 52 L25 84 M37 52 L39 84" stroke="#ff6ba8" stroke-width="4.5" stroke-linecap="round"/>
                <ellipse cx="32" cy="87" rx="16" ry="4" fill="none" stroke="#4be3ff" stroke-width="1.8"/>
              </svg>
            </div>
            <div class="status-meta">
              <div class="status-title-line">
                <span class="avatar-name">AIMOUTO-XR</span>
                <span class="rig-tag" data-testid="vrm-spec-badge">VRM 1.0</span>
              </div>
              <div class="status-tags">
                <span class="emotion-pill" data-testid="emotion-pill">NEUTRAL</span>
                <span class="pose-label" data-testid="pose-label">Idle Sway</span>
              </div>
            </div>
          </div>

          <div class="affinity-block">
            <div class="affinity-row">
              <span>Affinity Level</span>
              <span class="affinity-val">75%</span>
            </div>
            <div class="affinity-track">
              <div class="affinity-fill" style="width: 75%"></div>
            </div>
          </div>

          <div class="eq-block">
            <div class="eq-row">
              <span>Audio Equalizer</span>
              <span class="eq-state">IDLE</span>
            </div>
            <div class="eq-bars" aria-hidden="true"></div>
          </div>
        </section>

        <!-- Top-Right System Toolbar -->
        <nav class="anime-card hud-toolbar" aria-label="System Toolbar">
          <button type="button" class="toolbar-btn" data-action="open_vrm" data-testid="open-vrm-btn" aria-label="Open VRM Avatar Loader">
            <span class="btn-glyph">🧍</span>
            <span>VRM Avatar</span>
          </button>
          <button type="button" class="toolbar-btn" data-action="toggle_mic" aria-label="Toggle Voice Microphone">
            <span class="btn-glyph">🎙</span>
            <span>Voice Mic</span>
          </button>
          <button type="button" class="toolbar-btn" data-action="open_plugins" aria-label="Open Plugins Manager">
            <span class="btn-glyph">🧩</span>
            <span>Plugins</span>
          </button>
          <button type="button" class="toolbar-btn" data-action="open_model" aria-label="Open OpenAI Model Settings">
            <span class="btn-glyph">⚙</span>
            <span>Model API</span>
          </button>
          <button type="button" class="toolbar-btn" data-action="open_art" aria-label="Open Gemini Art Studio">
            <span class="btn-glyph">🎨</span>
            <span>Art Studio</span>
          </button>
          <button type="button" class="toolbar-btn" data-action="open_blueprint" aria-label="Inspect UI Blueprint">
            <span class="btn-glyph">📐</span>
            <span>UI Data</span>
          </button>
          <button type="button" class="toolbar-btn accent-cyan" data-action="toggle_spatial" aria-label="Toggle 3D Spatial Cards">
            <span class="btn-glyph">🧊</span>
            <span>3D UI</span>
          </button>
          <button type="button" id="XRButton" class="toolbar-btn xr-launch-btn" data-action="enter_vr" data-testid="xr-button" aria-label="Enter Immersive VR Scene">
            <span class="btn-glyph">🥽</span>
            <span>Enter VR</span>
          </button>
        </nav>
      </div>

      <!-- Right-Side MotionBricks & Stage Quick Controls Rail -->
      <aside class="hud-right-rail" aria-label="3D MotionBricks and Stage Controls">
        <div class="anime-card rail-card">
          <div class="rail-title">MotionBricks Room</div>
          <div class="physics-readout" data-testid="physics-status">⚖️ 46kg • Grounded • 60Hz</div>
          <div class="chip-grid">
            <button type="button" class="chip-btn" data-room-prop="desk_chair" data-testid="room-desk-btn">🪑 Desk</button>
            <button type="button" class="chip-btn" data-room-prop="bed" data-testid="room-bed-btn">🛏 Bed</button>
            <button type="button" class="chip-btn" data-room-prop="window" data-testid="room-window-btn">🪟 Window</button>
            <button type="button" class="chip-btn" data-room-prop="desk_lamp" data-testid="room-lamp-btn">💡 Lamp</button>
            <button type="button" class="chip-btn" data-room-prop="cat_plushie" data-testid="room-cat-btn">🐱 Kitty</button>
            <button type="button" class="chip-btn" data-room-prop="toy_ball" data-testid="room-ball-btn">🏀 Ball</button>
            <button type="button" class="chip-btn" data-room-prop="plush_die" data-testid="room-die-btn">🎲 Die</button>
            <button type="button" class="chip-btn" data-action="toggle_hand_hold" data-testid="hand-hold-btn">🤝 Hand</button>
          </div>
        </div>

        <div class="anime-card rail-card">
          <div class="rail-title">Full-Body Poses</div>
          <div class="chip-grid">
            <button type="button" class="chip-btn" data-pose="wave">Wave</button>
            <button type="button" class="chip-btn" data-pose="spin_joy">Spin</button>
            <button type="button" class="chip-btn" data-pose="jump_cheer">Cheer</button>
            <button type="button" class="chip-btn" data-pose="think_pose">Think</button>
          </div>
        </div>

        <div class="anime-card rail-card">
          <div class="rail-title">Emote Rig</div>
          <div class="chip-grid">
            <button type="button" class="chip-btn" data-emotion="neutral">Neutral</button>
            <button type="button" class="chip-btn" data-emotion="happy">Happy</button>
            <button type="button" class="chip-btn" data-emotion="tsundere">Tsun</button>
            <button type="button" class="chip-btn" data-emotion="curious">Curious</button>
          </div>
        </div>

        <div class="anime-card rail-card">
          <div class="rail-title">TTS &amp; Rig Debug</div>
          <div class="chip-grid">
            <button type="button" class="chip-btn" data-action="toggle_lang" data-testid="lang-btn">KR / EN</button>
            <button type="button" class="chip-btn" data-action="toggle_tts" data-testid="tts-btn">Voice ON</button>
            <button type="button" class="chip-btn" data-action="toggle_rig" data-testid="rig-btn">Bones</button>
            <button type="button" class="chip-btn" data-action="toggle_history" data-testid="history-btn">Logs</button>
          </div>
        </div>
      </aside>

      <!-- World Hover Prompt Pill -->
      <div class="room-hover-hint" style="display: none"></div>

      <!-- Collapsible Chat History Log (hidden by default) -->
      <div class="anime-card chat-history-popover" style="display: none" aria-label="Chat History"></div>

      <!-- Bottom-Center Dialogue Bubble & Chat Input Deck -->
      <footer class="hud-bottom-deck">
        <div class="dialogue-bubble" data-testid="dialogue-bubble">
          <div class="dialogue-plugins-row" data-testid="dialogue-plugins-row"></div>
          <div class="dialogue-text" data-testid="dialogue-text">...</div>
        </div>

        <form class="anime-card input-bar" data-testid="chat-form">
          <button type="button" class="input-mic-btn" data-action="toggle_mic" aria-label="Speak with Microphone">
            🎙 Mic
          </button>
          <input
            type="text"
            class="chat-input"
            aria-label="Message AIMouto"
            placeholder="AIMouto에게 말을 걸어보세요 (음성 또는 텍스트)..."
          />
          <button type="submit" class="send-btn" aria-label="Send Message">
            Send ▶
          </button>
        </form>
      </footer>

      <!-- Modal Drawer for Plugins / OpenAI Model API / Art Studio / Blueprint -->
      <div class="drawer-backdrop" style="display: none" role="dialog" aria-modal="true">
        <div class="anime-card drawer-panel">
          <div class="drawer-header">
            <h2 class="drawer-title">Panel</h2>
            <button type="button" class="drawer-close" aria-label="Close panel">✕</button>
          </div>
          <div class="drawer-body"></div>
        </div>
      </div>
    `;

    // Bind refs
    this.emotionPillEl = this.root.querySelector('.emotion-pill')!;
    this.poseLabelEl = this.root.querySelector('.pose-label')!;
    this.affinityFillEl = this.root.querySelector('.affinity-fill')!;
    this.affinityTextEl = this.root.querySelector('.affinity-val')!;
    this.eqStatusEl = this.root.querySelector('.eq-state')!;
    this.subtitleEl = this.root.querySelector('.dialogue-text')!;
    this.pluginLogChipRow = this.root.querySelector('.dialogue-plugins-row')!;
    this.chatInputEl = this.root.querySelector('.chat-input')!;
    this.sendBtnEl = this.root.querySelector('.send-btn')!;
    this.micBtnEl = this.root.querySelector('.hud-toolbar [data-action="toggle_mic"]')!;
    this.inputMicBtnEl = this.root.querySelector('.input-mic-btn')!;
    this.ttsStatusBadgeEl = this.root.querySelector('[data-action="toggle_tts"]')!;
    this.langBtnEl = this.root.querySelector('[data-action="toggle_lang"]')!;
    this.rigToggleBtnEl = this.root.querySelector('[data-action="toggle_rig"]')!;
    this.spatialToggleBtnEl = this.root.querySelector('[data-action="toggle_spatial"]')!;
    this.handHoldBtnEl = this.root.querySelector('[data-action="toggle_hand_hold"]')!;
    this.hoverHintEl = this.root.querySelector('.room-hover-hint')!;
    this.avatarNameEl = this.root.querySelector('.avatar-name')!;
    this.rigTagEl = this.root.querySelector('.rig-tag')!;
    this.xrLaunchBtnEl = this.root.querySelector('[data-action="enter_vr"]')!;
    this.physicsStatusEl = this.root.querySelector('[data-testid="physics-status"]')!;
    this.historyPanelEl = this.root.querySelector('.chat-history-popover')!;
    this.drawerBackdropEl = this.root.querySelector('.drawer-backdrop')!;
    this.drawerTitleEl = this.root.querySelector('.drawer-title')!;
    this.drawerBodyEl = this.root.querySelector('.drawer-body')!;

    // Build 12 equalizer bars
    const eqContainer = this.root.querySelector('.eq-bars')!;
    for (let i = 0; i < 12; i++) {
      const bar = document.createElement('div');
      bar.className = 'eq-bar';
      eqContainer.appendChild(bar);
      this.eqBarEls.push(bar);
    }

    // Event wiring
    const form = this.root.querySelector('.input-bar') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.chatInputEl.value.trim();
      if (!val || this.isBusy) return;
      this.chatInputEl.value = '';
      this.actions.onSendMessage(val);
    });

    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const pose = btn.dataset.pose as AvatarGesture | undefined;
      const emo = btn.dataset.emotion as AvatarEmotion | undefined;
      const stage = btn.dataset.stage as StageThemeId | undefined;
      const roomProp = btn.dataset.roomProp as RoomPropId | undefined;

      if (pose) this.actions.onSelectGesture(pose);
      if (emo) this.actions.onSelectEmotion(emo);
      if (stage) this.actions.onSelectStageTheme(stage);
      if (roomProp) this.actions.onTriggerRoomProp(roomProp);

      switch (action) {
        case 'toggle_hand_hold':
          this.actions.onToggleHandHold();
          break;
        case 'toggle_mic':
          this.actions.onToggleMic();
          break;
        case 'toggle_tts':
          this.actions.onToggleTtsMute();
          break;
        case 'toggle_lang':
          this.actions.onToggleLanguage();
          break;
        case 'toggle_rig':
          this.actions.onToggleSkeleton();
          break;
        case 'toggle_spatial':
          this.actions.onToggleSpatialCards();
          break;
        case 'toggle_arvr':
          this.actions.onToggleXRPassMode();
          break;
        case 'enter_vr':
          void this.triggerImmersiveVR();
          break;
        case 'toggle_history':
          this.historyVisible = !this.historyVisible;
          this.historyPanelEl.style.display = this.historyVisible ? 'flex' : 'none';
          this.renderHistory();
          break;
        case 'open_vrm':
          this.openDrawer('vrm', 'VRM Avatar Loader (.vrm via GLTFLoader)');
          break;
        case 'open_plugins':
          this.openDrawer('plugins', 'Plugin Ecosystem');
          break;
        case 'open_model':
          this.openDrawer('model', 'OpenAI Compatible API Settings');
          break;
        case 'open_art':
          this.openDrawer('art', 'Art Studio (gemini-3-pro-image-preview)');
          break;
        case 'open_blueprint':
          this.openDrawer('blueprint', 'Anime UI Image → Three.js Data Structure');
          break;
      }
    });

    this.root.querySelector('.drawer-close')!.addEventListener('click', () => {
      this.closeDrawer();
    });
    this.drawerBackdropEl.addEventListener('click', (e) => {
      if (e.target === this.drawerBackdropEl) this.closeDrawer();
    });
  }

  setBusy(busy: boolean): void {
    this.isBusy = busy;
    this.sendBtnEl.disabled = busy;
    this.sendBtnEl.textContent = busy ? 'Thinking...' : 'Send ▶';
  }

  setTranscriptDraft(text: string): void {
    this.chatInputEl.value = text;
  }

  updateVoiceVisuals(opts: {
    listening: boolean;
    speaking: boolean;
    muted: boolean;
    lang: string;
    eqBars: number[];
  }): void {
    this.micBtnEl.classList.toggle('is-active', opts.listening);
    this.inputMicBtnEl.classList.toggle('is-active', opts.listening);
    this.inputMicBtnEl.textContent = opts.listening ? '⏹ Stop' : '🎙 Mic';
    this.ttsStatusBadgeEl.textContent = opts.muted ? 'Voice MUTE' : 'Voice ON';
    this.ttsStatusBadgeEl.classList.toggle('is-active', !opts.muted);
    this.langBtnEl.textContent = opts.lang === 'ko-KR' ? 'KR Mode' : 'EN Mode';

    this.eqStatusEl.textContent = opts.listening
      ? 'VOICE IN'
      : opts.speaking
        ? 'TTS OUT'
        : 'IDLE';

    for (let i = 0; i < this.eqBarEls.length; i++) {
      const h = Math.round((opts.eqBars[i] ?? 0.15) * 100);
      this.eqBarEls[i].style.height = `${h}%`;
    }
  }

  updateAvatarStatus(opts: {
    emotion: AvatarEmotion;
    gesture: AvatarGesture;
    affinity: number;
    skeletonVisible: boolean;
    spatialVisible: boolean;
    stageTheme: StageThemeId;
  }): void {
    this.currentEmotion = opts.emotion;
    this.currentGesture = opts.gesture;
    this.affinity = opts.affinity;
    this.currentStageTheme = opts.stageTheme;

    const preset = EMOTION_PRESETS[opts.emotion];
    this.emotionPillEl.textContent = preset.label;
    this.emotionPillEl.style.backgroundColor = preset.badgeColor;
    this.poseLabelEl.textContent = GESTURE_LABELS[opts.gesture];

    this.affinityFillEl.style.width = `${opts.affinity}%`;
    this.affinityTextEl.textContent = `${opts.affinity}%`;
    this.rigToggleBtnEl.classList.toggle('is-active', opts.skeletonVisible);
    this.spatialToggleBtnEl.classList.toggle('is-active', opts.spatialVisible);
  }

  updateMotionState(snapshot: MotionBrickSnapshot): void {
    this.poseLabelEl.textContent = snapshot.label;
    this.handHoldBtnEl.classList.toggle('is-active', snapshot.handHoldActive);
    if (this.physicsStatusEl) {
      const weight = snapshot.weightKg ?? 46;
      const groundLabel = snapshot.grounded === false ? 'Airborne' : 'Grounded';
      const backendLabel =
        snapshot.motionBackend === 'onnx_webgpu' ? 'SOMA+ONNX' : 'SOMA 77J';
      const engineLabel = snapshot.physicsActive ? '60Hz' : 'Kinematic';
      this.physicsStatusEl.textContent = `⚖️ ${weight}kg • ${groundLabel} • ${backendLabel} • ${engineLabel}`;
    }
  }

  setHandHoldActive(active: boolean): void {
    this.handHoldBtnEl.classList.toggle('is-active', active);
  }

  setHoverHint(hint: SceneHoverHint | null): void {
    if (!hint) {
      this.hoverHintEl.style.display = 'none';
      return;
    }
    this.hoverHintEl.textContent = hint.text;
    this.hoverHintEl.classList.toggle('is-hand', Boolean(hint.isHandHold));
    this.hoverHintEl.style.left = `${Math.round(hint.screenX)}px`;
    this.hoverHintEl.style.top = `${Math.round(hint.screenY)}px`;
    this.hoverHintEl.style.display = 'block';
  }

  updateDialogue(message: ChatMessage, allMessages: ChatMessage[]): void {
    this.messages = allMessages;
    this.subtitleEl.textContent = message.content;

    this.pluginLogChipRow.innerHTML = '';
    if (message.pluginCalls && message.pluginCalls.length > 0) {
      for (const call of message.pluginCalls) {
        const chip = document.createElement('span');
        chip.className = 'plugin-exec-chip';
        chip.textContent = `⚡ ${call.toolName}`;
        this.pluginLogChipRow.appendChild(chip);
      }
    }

    if (this.historyVisible) {
      this.renderHistory();
    }
  }

  private renderHistory(): void {
    this.historyPanelEl.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'history-header';
    header.innerHTML = `<span>Conversation Log (${this.messages.length})</span>`;
    this.historyPanelEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'history-list';
    for (const msg of this.messages.slice(-14)) {
      const row = document.createElement('div');
      row.className = `history-item role-${msg.role}`;
      const prefix = msg.role === 'user' ? 'You' : 'AIMouto';
      row.textContent = `${prefix}: ${msg.content}`;
      list.appendChild(row);
    }
    this.historyPanelEl.appendChild(list);
    list.scrollTop = list.scrollHeight;
  }

  openDrawer(drawer: ActiveDrawer, title: string): void {
    this.activeDrawer = drawer;
    this.drawerTitleEl.textContent = title;
    this.drawerBackdropEl.style.display = 'flex';
    this.renderDrawerContent();
  }

  closeDrawer(): void {
    this.activeDrawer = 'none';
    this.drawerBackdropEl.style.display = 'none';
  }

  private async triggerImmersiveVR(): Promise<void> {
    const status = await this.actions.onEnterImmersiveVR();
    this.updateVRStatus(status);
  }

  updateVRStatus(status: VRSessionStatus): void {
    this.vrModeActive = status.state !== 'idle';
    this.xrLaunchBtnEl.classList.toggle('is-active', this.vrModeActive);
    this.xrLaunchBtnEl.innerHTML = this.vrModeActive
      ? '<span class="btn-glyph">🥽</span><span>Exit VR</span>'
      : '<span class="btn-glyph">🥽</span><span>Enter VR</span>';
    this.subtitleEl.textContent = status.message;
  }

  updateVrmInfo(info: LoadedVrmInfo): void {
    this.vrmInfo = info;
    this.avatarNameEl.textContent = info.name.toUpperCase();
    this.avatarNameEl.title = info.name;
    this.rigTagEl.textContent = info.specVersion;
    this.vrmStatusMessage = `Loaded "${info.name}" (${info.specVersion}) • ${info.humanBoneCount} bones, ${info.expressionCount} expressions, ${info.springChainCount} SpringBones.`;
    if (this.activeDrawer === 'vrm') {
      this.renderDrawerContent();
    }
  }

  setVrmError(message: string): void {
    this.vrmLoading = false;
    this.vrmStatusMessage = `Error: ${message}`;
    if (this.activeDrawer === 'vrm') {
      this.renderDrawerContent();
    }
  }

  private renderDrawerContent(): void {
    if (this.activeDrawer === 'vrm') {
      this.renderVrmDrawer();
    } else if (this.activeDrawer === 'plugins') {
      this.renderPluginsDrawer();
    } else if (this.activeDrawer === 'model') {
      this.renderModelDrawer();
    } else if (this.activeDrawer === 'art') {
      this.renderArtStudioDrawer();
    } else if (this.activeDrawer === 'blueprint') {
      this.renderBlueprintDrawer();
    }
  }

  private renderVrmDrawer(): void {
    const info = this.vrmInfo;
    const metaHtml = info
      ? `
        <div class="vrm-meta-card" data-testid="vrm-meta-card">
          <div><strong>Active Model:</strong> ${this.escapeHtml(info.name)} (${this.escapeHtml(info.specVersion)})</div>
          <div><strong>Rig:</strong> ${info.humanBoneCount} VRM Humanoid Bones • ${info.expressionCount} Expressions • ${info.springChainCount} SpringBone Joints</div>
          <div><strong>Source:</strong> <code>${this.escapeHtml(info.sourceLabel)}</code></div>
        </div>`
      : `<div class="vrm-meta-card" data-testid="vrm-meta-card">Loading default VRM avatar...</div>`;

    const presetButtons = VRM_PRESETS.map(
      (preset) =>
        `<button type="button" class="chip-btn" data-vrm-preset="${this.escapeAttr(preset.url)}" data-testid="vrm-preset-${preset.id}" ${
          this.vrmLoading ? 'disabled' : ''
        }>${this.escapeHtml(preset.label)}</button>`
    ).join('');

    this.drawerBodyEl.innerHTML = `
      <p class="drawer-desc">
        Load any <strong>VRM 0.x or VRM 1.0</strong> (.vrm) humanoid avatar dynamically via Three.js <code>GLTFLoader</code> + <code>VRMLoaderPlugin</code>. Facial expressions, blinking, lip-sync visemes, gaze tracking, and SpringBone hair physics attach automatically.
      </p>
      ${metaHtml}
      <div class="preset-row">
        <span>Sample VRM Avatars:</span>
        ${presetButtons}
      </div>
      <form class="vrm-url-form">
        <label>Load VRM from URL (https:// or /models/...)
          <div class="vrm-url-row">
            <input
              type="text"
              name="vrmUrl"
              data-testid="vrm-url-input"
              value="${this.escapeAttr(this.vrmUrlDraft)}"
              placeholder="https://example.com/avatar.vrm or /models/VRM1_Constraint_Twist_Sample.vrm"
              required
            />
            <button type="submit" class="primary-btn" data-testid="vrm-url-load-btn" ${
              this.vrmLoading ? 'disabled' : ''
            }>${this.vrmLoading ? 'Loading...' : 'Load VRM URL'}</button>
          </div>
        </label>
      </form>
      <div class="vrm-upload-box" data-testid="vrm-dropzone">
        <div class="vrm-upload-text">Upload or drag &amp; drop a local <strong>.vrm</strong> file</div>
        <div class="vrm-upload-actions">
          <input type="file" accept=".vrm,.glb,.gltf" data-testid="vrm-file-input" aria-label="Upload local VRM file" />
          <button type="button" class="chip-btn" data-testid="vrm-reset-btn">Reset Default VRM (.vrm)</button>
        </div>
      </div>
      <div class="art-status-msg" data-testid="vrm-status-msg">${this.escapeHtml(
        this.vrmStatusMessage
      )}</div>
    `;

    const urlForm = this.drawerBodyEl.querySelector('.vrm-url-form') as HTMLFormElement;
    const urlInput = urlForm.querySelector('[data-testid="vrm-url-input"]') as HTMLInputElement;
    urlInput.addEventListener('input', () => {
      this.vrmUrlDraft = urlInput.value;
    });

    const loadUrlAndReveal = async (targetUrl: string) => {
      if (!targetUrl || this.vrmLoading) return;
      this.vrmUrlDraft = targetUrl;
      this.vrmLoading = true;
      this.vrmStatusMessage = `Loading VRM from ${targetUrl}...`;
      this.renderVrmDrawer();
      try {
        const loaded = await this.actions.onLoadVrmUrl(targetUrl);
        this.vrmLoading = false;
        this.updateVrmInfo(loaded);
        this.closeDrawer();
      } catch (err) {
        this.setVrmError(err instanceof Error ? err.message : String(err));
      }
    };

    this.drawerBodyEl.querySelectorAll('[data-vrm-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetUrl = (btn as HTMLElement).dataset.vrmPreset;
        if (presetUrl) {
          void loadUrlAndReveal(presetUrl);
        }
      });
    });

    urlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await loadUrlAndReveal(urlInput.value.trim());
    });

    const fileInput = this.drawerBodyEl.querySelector(
      '[data-testid="vrm-file-input"]'
    ) as HTMLInputElement;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || this.vrmLoading) return;
      await this.handleVrmFileSelection(file);
    });

    const dropzone = this.drawerBodyEl.querySelector('[data-testid="vrm-dropzone"]') as HTMLElement;
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && !this.vrmLoading) {
        await this.handleVrmFileSelection(file);
      }
    });

    this.drawerBodyEl
      .querySelector('[data-testid="vrm-reset-btn"]')
      ?.addEventListener('click', async () => {
        if (this.vrmLoading) return;
        this.vrmLoading = true;
        this.vrmStatusMessage = 'Resetting to default VRM avatar...';
        this.renderVrmDrawer();
        const loaded = await this.actions.onResetDefaultVrm();
        this.vrmLoading = false;
        if (loaded) {
          this.updateVrmInfo(loaded);
          this.closeDrawer();
        }
      });
  }

  private async handleVrmFileSelection(file: File): Promise<void> {
    this.vrmLoading = true;
    this.vrmStatusMessage = `Parsing VRM file "${file.name}"...`;
    if (this.activeDrawer === 'vrm') this.renderVrmDrawer();
    try {
      const loaded = await this.actions.onLoadVrmFile(file);
      this.vrmLoading = false;
      this.updateVrmInfo(loaded);
      this.closeDrawer();
    } catch (err) {
      this.setVrmError(err instanceof Error ? err.message : String(err));
    }
  }

  private renderPluginsDrawer(): void {
    const plugins = this.registry.getAll();
    this.drawerBodyEl.innerHTML = `
      <p class="drawer-desc">
        Plugins expose OpenAI-compatible <code>tools</code> that AIMouto invokes autonomously during conversation.
      </p>
      <div class="plugin-list"></div>
      <form class="custom-plugin-form">
        <h3>Register Custom Plugin Tool</h3>
        <div class="form-grid-2">
          <label>Plugin Name
            <input type="text" name="name" placeholder="e.g. Stream Cheer Counter" required />
          </label>
          <label>Parameter Name
            <input type="text" name="param" value="topic" required />
          </label>
        </div>
        <label>Tool Description (for OpenAI LLM)
          <input type="text" name="desc" placeholder="Celebrates a viewer topic with a hype reaction" required />
        </label>
        <label>Output Template (use <code>{{input}}</code>)
          <input type="text" name="template" value="Hype activated for {{input}}! +9000 energy!" required />
        </label>
        <button type="submit" class="primary-btn">Add Custom Plugin</button>
      </form>
    `;

    const listEl = this.drawerBodyEl.querySelector('.plugin-list')!;
    for (const p of plugins) {
      const card = document.createElement('div');
      card.className = 'plugin-row';
      card.innerHTML = `
        <div class="plugin-info">
          <div class="plugin-name-row">
            <strong>${p.name}</strong>
            <span class="plugin-cat">${p.schema.function.name}</span>
          </div>
          <div class="plugin-desc">${p.description}</div>
        </div>
        <div class="plugin-controls">
          <label class="toggle-switch">
            <input type="checkbox" ${p.enabled ? 'checked' : ''} aria-label="Toggle ${p.name}" />
            <span>${p.enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
          ${
            !p.builtin
              ? `<button type="button" class="danger-mini-btn" aria-label="Delete ${p.name}">Delete</button>`
              : ''
          }
        </div>
      `;
      const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.addEventListener('change', () => {
        this.registry.setEnabled(p.id, checkbox.checked);
      });
      const delBtn = card.querySelector('.danger-mini-btn');
      delBtn?.addEventListener('click', () => {
        this.registry.unregister(p.id);
      });
      listEl.appendChild(card);
    }

    const customForm = this.drawerBodyEl.querySelector(
      '.custom-plugin-form'
    ) as HTMLFormElement;
    customForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(customForm);
      this.registry.registerCustomPlugin({
        name: String(fd.get('name') ?? ''),
        description: String(fd.get('desc') ?? ''),
        parameterName: String(fd.get('param') ?? 'input'),
        parameterDescription: 'Input argument for custom plugin',
        responseTemplate: String(fd.get('template') ?? 'Executed {{input}}'),
        emotionOnRun: AvatarEmotion.HAPPY,
        gestureOnRun: AvatarGesture.JUMP_CHEER,
      });
    });
  }

  private renderModelDrawer(): void {
    const keyStatusBanner = this.serverHasOpenAIKey
      ? `✅ Server Secret Active (${this.serverDefaultBaseUrl} • ${this.serverDefaultModel}).`
      : 'ℹ️ No server key detected in Settings > Secrets. Using Local Ollama/LM Studio or offline AIMouto Persona Fallback. To use OpenAI / OpenRouter / custom OpenAI-compatible providers, configure Secrets.';

    this.drawerBodyEl.innerHTML = `
      <div class="art-status-msg">${this.escapeHtml(keyStatusBanner)}</div>
      <form class="model-form">
        <div class="preset-row">
          <span>Quick Presets:</span>
          <button type="button" class="chip-btn" data-preset="server">Server Default</button>
          <button type="button" class="chip-btn" data-preset="openai">OpenAI</button>
          <button type="button" class="chip-btn" data-preset="openrouter">OpenRouter</button>
          <button type="button" class="chip-btn" data-preset="ollama">Ollama Local</button>
          <button type="button" class="chip-btn" data-preset="lmstudio">LM Studio</button>
        </div>

        <label>OpenAI-Compatible Base URL
          <input type="url" name="baseUrl" value="${this.escapeAttr(this.openAIConfig.baseUrl)}" required />
        </label>
        <div class="form-grid-2">
          <label>Model ID
            <input type="text" name="model" value="${this.escapeAttr(this.openAIConfig.model)}" required />
          </label>
          <label>Temperature (0.0 - 1.5)
            <input type="number" step="0.05" min="0" max="1.5" name="temperature" value="${this.openAIConfig.temperature}" />
          </label>
        </div>
        <label>Persona System Prompt
          <textarea name="systemPrompt" rows="4">${this.escapeHtml(this.openAIConfig.systemPrompt)}</textarea>
        </label>
        <div class="checkbox-row">
          <label><input type="checkbox" name="useProxy" ${this.openAIConfig.useProxy ? 'checked' : ''} /> Route via /api/chat server proxy (uses server Secret key & avoids CORS)</label>
          <label><input type="checkbox" name="demoFallbackEnabled" ${this.openAIConfig.demoFallbackEnabled ? 'checked' : ''} /> Offline demo persona only when no API key is configured (never hides real API errors)</label>
        </div>
        <button type="submit" class="primary-btn">Save Model Settings</button>
      </form>
    `;

    const form = this.drawerBodyEl.querySelector('.model-form') as HTMLFormElement;
    const baseInput = form.querySelector('input[name="baseUrl"]') as HTMLInputElement;
    const modelInput = form.querySelector('input[name="model"]') as HTMLInputElement;
    let customEndpointFlag = Boolean(this.openAIConfig.customEndpoint);

    form.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = (btn as HTMLElement).dataset.preset;
        if (p === 'server') {
          baseInput.value = this.serverDefaultBaseUrl;
          modelInput.value = this.serverDefaultModel;
          customEndpointFlag = false;
        } else if (p === 'openai') {
          baseInput.value = 'https://api.openai.com/v1';
          modelInput.value = 'gpt-4o-mini';
          customEndpointFlag = true;
        } else if (p === 'openrouter') {
          baseInput.value = 'https://openrouter.ai/api/v1';
          modelInput.value = 'openai/gpt-4o-mini';
          customEndpointFlag = true;
        } else if (p === 'ollama') {
          baseInput.value = 'http://localhost:11434/v1';
          modelInput.value = 'llama3.1';
          customEndpointFlag = true;
        } else if (p === 'lmstudio') {
          baseInput.value = 'http://localhost:1234/v1';
          modelInput.value = 'local-model';
          customEndpointFlag = true;
        }
      });
    });

    baseInput.addEventListener('input', () => {
      customEndpointFlag =
        baseInput.value.trim() !== this.serverDefaultBaseUrl ||
        modelInput.value.trim() !== this.serverDefaultModel;
    });
    modelInput.addEventListener('input', () => {
      customEndpointFlag =
        baseInput.value.trim() !== this.serverDefaultBaseUrl ||
        modelInput.value.trim() !== this.serverDefaultModel;
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const nextBaseUrl = String(fd.get('baseUrl') ?? '').trim();
      const nextModel = String(fd.get('model') ?? '').trim();
      const matchesServerDefaults =
        nextBaseUrl === this.serverDefaultBaseUrl &&
        nextModel === this.serverDefaultModel;

      const updated: OpenAICompatConfig = {
        baseUrl: nextBaseUrl,
        model: nextModel,
        apiKey: '',
        temperature: Number(fd.get('temperature') ?? 0.8),
        systemPrompt: String(fd.get('systemPrompt') ?? ''),
        useProxy: (form.querySelector('input[name="useProxy"]') as HTMLInputElement).checked,
        demoFallbackEnabled: (
          form.querySelector('input[name="demoFallbackEnabled"]') as HTMLInputElement
        ).checked,
        customEndpoint: matchesServerDefaults ? false : customEndpointFlag,
      };
      this.openAIConfig = updated;
      this.actions.onUpdateOpenAIConfig(updated);
      this.closeDrawer();
    });
  }

  private renderArtStudioDrawer(): void {
    this.drawerBodyEl.innerHTML = `
      <p class="drawer-desc">
        Generate high-quality stage artwork with <strong>gemini-3-pro-image-preview</strong> and display it on AIMouto's 3D Holo-Frame.
      </p>
      <form class="art-form">
        <label>Image Prompt
          <input type="text" name="prompt" placeholder="Cozy rainy-night anime bedroom backdrop with warm desk lamp glow" required />
        </label>
        <div class="art-options-row">
          <div>
            <span class="field-label">Resolution (1K / 2K / 4K)</span>
            <div class="size-selector" role="group" aria-label="Image Size">
              ${(['1K', '2K', '4K'] as GeneratedImageSize[])
                .map(
                  (sz) =>
                    `<button type="button" class="chip-btn ${
                      this.selectedArtSize === sz ? 'is-active' : ''
                    }" data-art-size="${sz}">${sz}</button>`
                )
                .join('')}
            </div>
          </div>
          <div>
            <span class="field-label">Aspect Ratio</span>
            <select name="aspect" aria-label="Aspect Ratio">
              ${(['1:1', '16:9', '4:3', '3:4', '9:16'] as GeneratedImageAspect[])
                .map(
                  (ar) =>
                    `<option value="${ar}" ${
                      this.selectedArtAspect === ar ? 'selected' : ''
                    }>${ar}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <button type="submit" class="primary-btn art-submit-btn">Generate with gemini-3-pro-image-preview</button>
      </form>
      <div class="art-status-msg">${this.escapeHtml(this.artStatusMessage)}</div>
      ${
        this.lastGeneratedArtUrl
          ? `<div class="art-preview-wrap">
               <img src="${this.lastGeneratedArtUrl}" alt="Generated artwork" referrerpolicy="no-referrer" />
               <button type="button" class="primary-btn place-holo-btn">Pin to 3D Holo-Frame</button>
             </div>`
          : ''
      }
    `;

    this.drawerBodyEl.querySelectorAll('[data-art-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedArtSize = (btn as HTMLElement).dataset.artSize as GeneratedImageSize;
        this.renderArtStudioDrawer();
      });
    });

    const form = this.drawerBodyEl.querySelector('.art-form') as HTMLFormElement;
    const aspectSelect = form.querySelector('select[name="aspect"]') as HTMLSelectElement;
    aspectSelect.addEventListener('change', () => {
      this.selectedArtAspect = aspectSelect.value as GeneratedImageAspect;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const prompt = String(fd.get('prompt') ?? '').trim();
      if (!prompt) return;

      const submitBtn = form.querySelector('.art-submit-btn') as HTMLButtonElement;
      submitBtn.disabled = true;
      submitBtn.textContent = `Generating ${this.selectedArtSize}...`;
      this.artStatusMessage = `Requesting ${this.selectedArtSize} image from gemini-3-pro-image-preview...`;
      this.renderArtStudioDrawer();

      const result = await this.actions.onGenerateImage(
        prompt,
        this.selectedArtSize,
        this.selectedArtAspect
      );
      if (result.imageUrl) {
        this.lastGeneratedArtUrl = result.imageUrl;
        this.artStatusMessage = `Generated ${this.selectedArtSize} (${this.selectedArtAspect}) successfully!`;
        this.actions.onDisplayArtOnStage(result.imageUrl);
      } else {
        this.artStatusMessage = result.error ?? 'Image generation failed.';
      }
      if (this.activeDrawer === 'art') this.renderArtStudioDrawer();
    });

    this.drawerBodyEl.querySelector('.place-holo-btn')?.addEventListener('click', () => {
      if (this.lastGeneratedArtUrl) {
        this.actions.onDisplayArtOnStage(this.lastGeneratedArtUrl);
      }
    });
  }

  private renderBlueprintDrawer(): void {
    const spatialConfigs = blueprintToSpatialCardConfigs(ANIME_UI_BLUEPRINT);
    this.drawerBodyEl.innerHTML = `
      <p class="drawer-desc">
        Generated Full-Body 3D Anime UI concept image and its converted Three.js / XR Blocks spatial data structure (<code>ANIME_UI_BLUEPRINT</code>).
      </p>
      <div class="blueprint-grid">
        <div class="blueprint-img-box">
          <h3>1. Generated Anime UI Concept</h3>
          <img src="${CONCEPT_UI_IMAGE_PATH}" alt="Full-body 3D anime UI concept" referrerpolicy="no-referrer" />
        </div>
        <div class="blueprint-json-box">
          <h3>2. Converted Three.js / UICard Data</h3>
          <pre class="blueprint-pre">${this.escapeHtml(
            JSON.stringify({theme: ANIME_UI_BLUEPRINT.theme, spatialCards: spatialConfigs}, null, 2)
          )}</pre>
        </div>
      </div>
    `;
  }

  private escapeHtml(str: string): string {
    return str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replaceAll('"', '&quot;');
  }

  dispose(): void {
    this.root.remove();
  }
}
