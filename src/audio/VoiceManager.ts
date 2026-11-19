import {VisemeVowel} from '../types';

export interface VoiceCallbacks {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
}

const VOWEL_CYCLE: VisemeVowel[] = ['A', 'I', 'O', 'E', 'U', 'A', 'O'];

/**
 * Manages bidirectional Voice I/O:
 * - Speech-to-Text via Web Speech API + Mic AudioContext spectrum bars
 * - Text-to-Speech via SpeechSynthesis + procedural Web Audio vocal synth chimes
 * - Real-time lip-sync envelope & viseme vowel estimation for the 3D avatar
 */
export class VoiceManager {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private isSpeaking = false;
  private ttsMuted = false;
  private lang = 'ko-KR';

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private freqBins = new Uint8Array(16);

  private speakingPulse = 0;
  private speakingTimer = 0;
  private vowelIndex = 0;
  private synthWordKick = 0;

  private readonly eqBars = new Array<number>(12).fill(0.15);

  constructor(private readonly callbacks: VoiceCallbacks = {}) {}

  get listening(): boolean {
    return this.isListening;
  }

  get speaking(): boolean {
    return this.isSpeaking;
  }

  get muted(): boolean {
    return this.ttsMuted;
  }

  get language(): string {
    return this.lang;
  }

  setLanguage(lang: 'ko-KR' | 'en-US'): void {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  setMuted(muted: boolean): void {
    this.ttsMuted = muted;
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      this.callbacks.onSpeakingChange?.(false);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.ttsMuted);
    return this.ttsMuted;
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;
    if (typeof window === 'undefined') return;

    const SpeechRecCtor =
      window.SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: typeof SpeechRecognition})
        .webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      this.callbacks.onError?.(
        'Web Speech Recognition is unavailable in this browser. You can still use text input!'
      );
      return;
    }

    try {
      await this.initMicAnalyser();
    } catch {
      // Continue speech recognition even if AnalyserNode mic tap fails
    }

    const recognition = new SpeechRecCtor();
    recognition.lang = this.lang;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      this.isListening = true;
      this.callbacks.onListeningChange?.(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      this.callbacks.onTranscript?.(transcript.trim(), isFinal);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isListening = false;
      this.callbacks.onListeningChange?.(false);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.callbacks.onError?.(`Voice input error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      this.isListening = false;
      this.callbacks.onListeningChange?.(false);
    };

    this.recognition = recognition;
    recognition.start();
  }

  stopListening(): void {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
    this.isListening = false;
    this.callbacks.onListeningChange?.(false);
  }

  async toggleListening(): Promise<boolean> {
    if (this.isListening) {
      this.stopListening();
      return false;
    }
    await this.startListening();
    return this.isListening;
  }

  speak(text: string): void {
    const cleanText = text.replace(/[*_`~#]/g, '').trim();
    if (!cleanText || this.ttsMuted) return;

    this.speakingTimer = Math.min(6, Math.max(1.2, cleanText.length * 0.065));
    this.isSpeaking = true;
    this.callbacks.onSpeakingChange?.(true);

    const hasKorean = /[\u3131-\uD79D]/.test(cleanText);
    const targetLang = hasKorean ? 'ko-KR' : 'en-US';

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = targetLang;
        utterance.pitch = 1.28;
        utterance.rate = 1.06;

        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(
          (v) =>
            v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)) &&
            /female|google|samantha|yuna|sora|aria/i.test(v.name)
        );
        if (preferred) utterance.voice = preferred;

        utterance.onboundary = () => {
          this.synthWordKick = 1.0;
          this.vowelIndex = (this.vowelIndex + 1) % VOWEL_CYCLE.length;
        };
        utterance.onend = () => {
          this.isSpeaking = false;
          this.speakingTimer = 0;
          this.callbacks.onSpeakingChange?.(false);
        };
        utterance.onerror = () => {
          this.isSpeaking = false;
          this.speakingTimer = 0;
          this.callbacks.onSpeakingChange?.(false);
        };
        window.speechSynthesis.speak(utterance);
        this.playCuteChime(hasKorean ? 660 : 720);
        return;
      } catch {
        // Fallback to timed procedural vocal lip-sync
      }
    }
    this.playCuteChime(680);
  }

  /**
   * Plays a subtle anime-style Web Audio synth chirp on avatar responses or actions.
   */
  playCuteChime(baseFreq = 640): void {
    if (this.ttsMuted || typeof window === 'undefined') return;
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext})
          .webkitAudioContext;
      if (!AudioCtor) return;
      if (!this.audioCtx) this.audioCtx = new AudioCtor();
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.09);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {
      // Ignore autoplay restrictions before user gesture
    }
  }

  /**
   * Advances lip-sync & equalizer spectrum bars every frame.
   */
  update(dt: number): {
    mouthOpen: number;
    viseme: VisemeVowel;
    eqBars: number[];
  } {
    if (this.speakingTimer > 0) {
      this.speakingTimer = Math.max(0, this.speakingTimer - dt);
      if (this.speakingTimer === 0 && this.isSpeaking) {
        this.isSpeaking = false;
        this.callbacks.onSpeakingChange?.(false);
      }
    }

    this.synthWordKick = Math.max(0, this.synthWordKick - dt * 5.2);

    if (this.isSpeaking) {
      this.speakingPulse += dt * 15;
      const cadence =
        0.42 +
        0.38 * Math.abs(Math.sin(this.speakingPulse)) +
        0.2 * this.synthWordKick;
      if (Math.sin(this.speakingPulse * 0.7) > 0.92) {
        this.vowelIndex = (this.vowelIndex + 1) % VOWEL_CYCLE.length;
      }
      for (let i = 0; i < this.eqBars.length; i++) {
        const wave = Math.abs(
          Math.sin(this.speakingPulse * 0.65 + i * 0.55)
        );
        this.eqBars[i] = 0.22 + wave * 0.78;
      }
      return {
        mouthOpen: Math.min(1, cadence),
        viseme: VOWEL_CYCLE[this.vowelIndex],
        eqBars: this.eqBars,
      };
    }

    if (this.isListening && this.analyser) {
      this.analyser.getByteFrequencyData(this.freqBins);
      let peak = 0;
      for (let i = 0; i < this.eqBars.length; i++) {
        const val = (this.freqBins[i % this.freqBins.length] ?? 0) / 255;
        this.eqBars[i] = 0.16 + val * 0.84;
        if (val > peak) peak = val;
      }
      return {mouthOpen: 0.05, viseme: 'sil', eqBars: this.eqBars};
    }

    // Gentle idle ambient pulse on equalizer bars
    const t = performance.now() * 0.0022;
    for (let i = 0; i < this.eqBars.length; i++) {
      this.eqBars[i] = 0.14 + 0.12 * Math.abs(Math.sin(t + i * 0.45));
    }
    return {mouthOpen: 0, viseme: 'sil', eqBars: this.eqBars};
  }

  private async initMicAnalyser(): Promise<void> {
    if (this.analyser || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!AudioCtor) return;
    if (!this.audioCtx) this.audioCtx = new AudioCtor();
    const source = this.audioCtx.createMediaStreamSource(stream);
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);
    this.micStream = stream;
    this.analyser = analyser;
  }

  dispose(): void {
    this.stopListening();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
