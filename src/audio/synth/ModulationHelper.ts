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

    const osc = Math.sin(2 * Math.PI * this.frequencyHz * (elapsed - this.delay));
    const value = osc * this.depth;
    return value === 0 ? 0 : value;
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

    lfo.start(lfoActiveTime);

    if (this.type === 'tremolo') {
      // Modulates gain downwards
      lfoGain.gain.setValueAtTime(this.depth, startTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gainParam);
    } else if (this.type === 'autoPan') {
      // Modulates stereo pan (-1.0 to +1.0)
      lfoGain.gain.setValueAtTime(this.depth, startTime);
      lfo.connect(lfoGain);
      lfoGain.connect(panParam);
    } else if (this.type === 'vibrato') {
      // Modulates pitch (semitones)
      lfoGain.gain.setValueAtTime(this.depth * 100, startTime);
      lfo.connect(lfoGain);
      lfoGain.connect((sourceNode as OscillatorNode | AudioBufferSourceNode).detune);
    }

    lfo.stop(stopTime);

    return lfo;
  }
}
