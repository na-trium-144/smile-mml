/**
 * Modulation Helper
 * Sets up LFO oscillators for Tremolo (@MA), Vibrato (@MP), and AutoPan (@ML)
 */

import type { ModulationParams } from '../../parser/types.js';
import { resolveModulationConfig, type ActiveModulationConfig } from '../utils/conversion.js';

export class ModulationHelper {
  public readonly enabled: boolean;
  public readonly type: "tremolo" | "vibrato" | "autoPan";
  /** 開始遅延時間（秒） */
  public readonly delay: number;
  /** 振幅（Tremolo/AutoPan: 0.0〜1.0、Vibrato: 半音単位） */
  public readonly depth: number;
  /** LFO周波数 (Hz) */
  public readonly frequencyHz: number;
  /** LFO周期（秒） = 1 / frequencyHz */
  public readonly period: number;
  /** ディレイ後の目標振幅までのランプアップ時間（秒、WebAudioでの linearRamp 0.05秒に相当） */
  public readonly rampTime: number = 0.05;

  /**
   * 振幅（depth の別名）
   */
  public get amplitude(): number {
    return this.depth;
  }

  /**
   * 開始遅延時間（秒、delay の別名）
   */
  public get delaySeconds(): number {
    return this.delay;
  }

  constructor(mod?: ModulationParams | ActiveModulationConfig | null) {
    let config: ActiveModulationConfig | null = null;
    if (mod) {
      if ('type' in mod && 'frequencyHz' in mod) {
        config = mod;
      } else {
        config = resolveModulationConfig(mod as ModulationParams);
      }
    }

    if (!config) {
      this.enabled = false;
      this.type = 'vibrato';
      this.delay = 0;
      this.depth = 0;
      this.frequencyHz = 0;
      this.period = 0;
    } else {
      this.enabled = true;
      this.type = config.type;
      this.delay = config.delaySeconds;
      this.depth = config.depth;
      this.frequencyHz = config.frequencyHz;
      this.period = config.frequencyHz > 0 ? 1 / config.frequencyHz : 0;
    }
  }

  /**
   * 任意の時刻におけるモジュレーションの変調量を取得する。
   * @param time ノート開始からの経過時間（秒）、または startTime を指定した場合は絶対時刻（秒）
   * @param startTime ノート開始の絶対時刻（秒、省略時 0）
   * @returns 現在の変調量（振幅とLFO位相を反映した値）
   */
  public getValue(time: number, startTime: number = 0): number {
    if (!this.enabled || this.depth === 0 || this.frequencyHz === 0) {
      return 0;
    }
    const elapsed = time - startTime;
    if (elapsed < this.delay) {
      return 0;
    }

    const activeElapsed = elapsed - this.delay;
    const gainRatio =
      this.rampTime > 0 ? Math.min(1, activeElapsed / this.rampTime) : 1;

    // WebAudio の OscillatorNode (sine) は startTime から発振するため位相は 2 * PI * frequencyHz * elapsed
    const osc = Math.sin(2 * Math.PI * this.frequencyHz * elapsed);
    const value = osc * (this.depth * gainRatio);
    return value === 0 ? 0 : value;
  }

  /**
   * getValue のエイリアス
   */
  public getValueAtTime(time: number, startTime: number = 0): number {
    return this.getValue(time, startTime);
  }

  /**
   * 任意の時刻におけるモジュレーションの振幅エンベロープ（0 〜 depth）を取得する。
   */
  public getAmplitudeAtTime(time: number, startTime: number = 0): number {
    if (!this.enabled || this.depth === 0) {
      return 0;
    }
    const elapsed = time - startTime;
    if (elapsed < this.delay) {
      return 0;
    }
    const activeElapsed = elapsed - this.delay;
    const gainRatio =
      this.rampTime > 0 ? Math.min(1, activeElapsed / this.rampTime) : 1;
    return this.depth * gainRatio;
  }

  /**
   * 任意の時刻における正規化されたLFO波形値 (-1.0 〜 +1.0) を取得する。
   */
  public getNormalizedValue(time: number, startTime: number = 0): number {
    if (this.depth === 0) return 0;
    return this.getValue(time, startTime) / this.depth;
  }

  /**
   * Connect LFO nodes if modulation is active
   */
  public attachModulation(
    ctx: AudioContext,
    sourceNode: AudioScheduledSourceNode,
    gainParam: AudioParam,
    panParam: AudioParam,
    startTime: number,
    stopTime: number
  ): OscillatorNode | null {
    if (!this.enabled || this.frequencyHz <= 0 || this.depth <= 0) return null;

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(this.frequencyHz, startTime);

    const lfoGain = ctx.createGain();
    const lfoActiveTime = startTime + this.delay;

    // Initially silent during delay
    lfoGain.gain.setValueAtTime(0, startTime);
    if (this.delay > 0) {
      lfoGain.gain.setValueAtTime(0, lfoActiveTime);
    }

    if (this.type === 'tremolo') {
      // Modulates gain downwards
      lfoGain.gain.linearRampToValueAtTime(this.depth, lfoActiveTime + this.rampTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gainParam);
    } else if (this.type === 'autoPan') {
      // Modulates stereo pan (-1.0 to +1.0)
      lfoGain.gain.linearRampToValueAtTime(this.depth, lfoActiveTime + this.rampTime);
      lfo.connect(lfoGain);
      lfoGain.connect(panParam);
    } else if (this.type === 'vibrato') {
      // Modulates pitch (semitones)
      if (sourceNode instanceof OscillatorNode) {
        // Oscillator frequency in Hz: depth is in semitones
        // Delta Hz approx = f * (2^(depth/12) - 1)
        const currentFreq = sourceNode.frequency.value;
        const deltaHz = currentFreq * (Math.pow(2, this.depth / 12) - 1);
        lfoGain.gain.linearRampToValueAtTime(deltaHz, lfoActiveTime + this.rampTime);
        lfo.connect(lfoGain);
        lfoGain.connect(sourceNode.frequency);
      } else if (sourceNode instanceof AudioBufferSourceNode) {
        // PlaybackRate: depth in semitones -> delta rate = (2^(depth/12) - 1)
        const deltaRate = Math.pow(2, this.depth / 12) - 1;
        lfoGain.gain.linearRampToValueAtTime(deltaRate, lfoActiveTime + this.rampTime);
        lfo.connect(lfoGain);
        lfoGain.connect(sourceNode.playbackRate);
      }
    }

    lfo.start(startTime);
    lfo.stop(stopTime);

    return lfo;
  }

  /**
   * Static helper for backward compatibility
   */
  public static attachModulation(
    ctx: AudioContext,
    sourceNode: AudioScheduledSourceNode,
    gainParam: AudioParam,
    panParam: AudioParam,
    mod: ModulationParams,
    startTime: number,
    stopTime: number
  ): OscillatorNode | null {
    const helper = new ModulationHelper(mod);
    return helper.attachModulation(
      ctx,
      sourceNode,
      gainParam,
      panParam,
      startTime,
      stopTime
    );
  }
}
