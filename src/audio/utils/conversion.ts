/**
 * Audio parameter conversion utilities
 * Implements SmileBASIC 3 MML specifications and SoundFont/MIDI standards
 */

import type { ADSRParams } from '../types.js';
import type { EnvelopeParams, ModulationParams } from '../../parser/types.js';

/**
 * Convert MIDI note number and cents to frequency in Hertz
 * A4 = 440Hz, note 69
 */
export function midiNoteToFrequency(noteNumber: number, detuneCents: number = 0): number {
  return 440 * Math.pow(2, (noteNumber - 69 + detuneCents / 100) / 12);
}

/**
 * Convert SmileBASIC @D parameter (-128 to 127) to cents (-100 to +100 cents = 1 semitone)
 */
export function sbDetuneToCents(detune: number): number {
  return (detune / 128) * 100;
}

/**
 * Convert SmileBASIC 3 Attack value (0-127) to seconds
 * Smaller values mean longer attack times.
 * Verification data based on MML_spec.md:
 * A=4: ~2.5s (whole note at BPM 96)
 * A=9: ~1.25s (half note at BPM 96)
 * A=19: ~0.625s (quarter note at BPM 96)
 * A=39: ~0.3125s (eighth note at BPM 96)
 * A=127: ~0.001s (instantaneous)
 *
 * NOTE:
 * SmileBASIC2がNintendoDSの仕様に合わせてエンベロープのパラメータの仕様を決定していた
 * かつ SmileBASIC3は2の仕様を引き継いだ と仮定した場合、
 * 上記の実測値を再現するよりも、
 * NDSInstrumentBank.getAttackSeconds を使った方がより正確な再現になっている可能性がある
 * (decay, sustain, release も同様)
 *
 * しかし一方でNDS ROMを使用せずに再生するMMLプレイヤーがNDSの解析データに依存した動作をするというのはちょっと嫌だなという気持ちもある
 */
export function sbAttackToSeconds(a: number): number {
  if (a >= 127) return 0.001;
  if (a <= 0) return 10.0;
  // Curve: 10 / (a + 0.01) matches a=4 -> 2.5s, a=19 -> 0.52s, a=39 -> 0.25s closely
  return Math.min(10.0, Math.max(0.001, 10.0 / a));
}

/**
 * Convert SmileBASIC 3 Decay value (0-127) to seconds
 * 
 * TODO: I think this is inaccurate
 */
export function sbDecayToSeconds(d: number): number {
  if (d >= 127) return 0.001;
  if (d <= 0) return 10.0;
  const diff = 127 - d;
  // diff=36 -> ~2.5s
  return Math.min(10.0, Math.max(0.001, 2.5 * (diff / 36)));
}

/**
 * Convert SmileBASIC 3 Sustain value (0-127) to linear level (0.0 - 1.0)
 */
export function sbSustainToLevel(s: number): number {
  return Math.max(0, Math.min(1, s / 127));
}

/**
 * Convert SmileBASIC 3 Release value (0-127) to seconds
 * Verification data based on MML_spec.md:
 * R=91 (diff 36): ~2.5s (whole note at BPM 96)
 * R=103 (diff 24): ~1.25s (half note at BPM 96)
 * R=114 (diff 13): ~0.625s (quarter note at BPM 96)
 * R=120 (diff 7): ~0.3125s (eighth note at BPM 96)
 * R=127: ~0.01s
 */
export function sbReleaseToSeconds(r: number): number {
  if (r >= 127) return 0.01;
  const diff = 127 - r;
  return Math.min(10.0, Math.max(0.01, 2.5 * (diff / 36)));
}

/**
 * Convert full SmileBASIC @E envelope to physical ADSR parameters
 */
export function convertSmileBASICEnvelope(envelope: EnvelopeParams): ADSRParams {
  return {
    attackTime: sbAttackToSeconds(envelope.a),
    decayTime: sbDecayToSeconds(envelope.d),
    sustainLevel: sbSustainToLevel(envelope.s),
    releaseTime: sbReleaseToSeconds(envelope.r),
  };
}

/**
 * Modulation configuration derived from SmileBASIC @MA, @MP, @ML parameters
 */
export interface ActiveModulationConfig {
  type: 'tremolo' | 'vibrato' | 'autoPan';
  delaySeconds: number; // seconds before modulation starts
  frequencyHz: number; // LFO frequency
  depth: number; // normalized depth
}

/**
 * Resolve active modulation from MML modulation parameters
 * Specifications from MML_spec.md:
 * - Delay: Delay * 0.01953125s (128th note at BPM 96)
 * - Speed: Speed / 2.5 Hz (period is (Speed)th note at BPM 96; 0 means no effect)
 * - @ML AutoPan: +/- (Depth * Range / 2) on 0-127 pan scale -> normalized (+/- 0 to 1)
 * - @MA Tremolo: -(Depth * Range / 2) gain reduction
 * - @MP Vibrato: +/- (Depth * Range / 128) semitones
 */
export function resolveModulationConfig(
  mod: ModulationParams
): ActiveModulationConfig | null {
  if (!mod.enabled) return null;

  let target: {
    type: 'tremolo' | 'vibrato' | 'autoPan';
    depth: number;
    range: number;
    speed: number;
    delay: number;
  } | null = null;

  if (mod.autoPan.enabled) {
    target = { type: 'autoPan', ...mod.autoPan };
  } else if (mod.tremolo.enabled) {
    target = { type: 'tremolo', ...mod.tremolo };
  } else if (mod.vibrato.enabled) {
    target = { type: 'vibrato', ...mod.vibrato };
  }

  if (!target || target.speed <= 0 || target.depth <= 0) {
    return null;
  }

  const delaySeconds = target.delay * 0.01953125;
  const frequencyHz = target.speed / 2.5;

  let depth = 0;
  if (target.type === 'autoPan') {
    // Amplitude +/- (Depth * Range / 2) on 0-127 scale -> 0.0 to 1.0 pan
    depth = Math.min(1.0, (target.depth * target.range) / (2 * 64));
  } else if (target.type === 'tremolo') {
    // Gain reduction ratio (0.0 to 1.0)
    depth = Math.min(1.0, (target.depth * target.range) / (2 * 127));
  } else if (target.type === 'vibrato') {
    // Semitones: (Depth * Range / 128)
    depth = (target.depth * target.range) / 128;
  }

  return {
    type: target.type,
    delaySeconds,
    frequencyHz,
    depth,
  };
}

/**
 * SoundFont timecents to seconds: 2 ^ (timecents / 1200)
 */
export function timecentToSeconds(timecent: number): number {
  return Math.pow(2, timecent / 1200);
}

/**
 * SoundFont centibels to linear gain multiplier: 10 ^ (-centibels / 200)
 */
export function centibelsToGain(centibels: number): number {
  return Math.pow(10, -centibels / 200);
}
