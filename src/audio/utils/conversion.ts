/**
 * Audio parameter conversion utilities
 * Implements SmileBASIC 3 MML specifications and SoundFont/MIDI standards
 */

import type { ADSRParams } from "../types.js";
import type { EnvelopeParams, ModulationParams } from "../../parser/types.js";
import { NDSInstrumentBank } from "../banks/NDSInstrumentBank.js";

/**
 * Convert MIDI note number and cents to frequency in Hertz
 * A4 = 440Hz, note 69
 */
export function midiNoteToFrequency(
  noteNumber: number,
  detuneCents: number = 0,
): number {
  return 440 * Math.pow(2, (noteNumber - 69 + detuneCents / 100) / 12);
}

/**
 * Convert SmileBASIC @D parameter (-128 to 127) to cents (-100 to +100 cents = 1 semitone)
 */
export function sbDetuneToCents(detune: number): number {
  return (detune / 128) * 100;
}

/**
 * Convert SmileBASIC @E envelope to physical ADSR parameters
 *
 * Convert SmileBASIC 3 Attack value (0-127) to seconds
 *
 * SmileBASIC2がNintendoDSの仕様に合わせてエンベロープのパラメータの仕様を決定していた
 * かつ SmileBASIC3は2の仕様を引き継いだ と推測し、
 * NDSInstrumentBank (NitroFS) の変換テーブルを用いる。
 *
 * 特にattackに関してはSmileBASIC3で実測した値とほぼ合致:
 * A=4: ~2.5s (whole note at BPM 96)
 * A=9: ~1.25s (half note at BPM 96)
 * A=19: ~0.625s (quarter note at BPM 96)
 * A=39: ~0.3125s (eighth note at BPM 96)
 * A=127: instantaneous
 */
export function convertSmileBASICEnvelope(
  envelope: EnvelopeParams,
): ADSRParams {
  return {
    attackTime: NDSInstrumentBank.getAttackSeconds(envelope.a),
    sustainLevel: NDSInstrumentBank.convertVolume2(
      NDSInstrumentBank.convertSustain(envelope.s),
    ),
    decayRate: NDSInstrumentBank.getFallRate(envelope.d),
    releaseRate: NDSInstrumentBank.getFallRate(envelope.r),
  };
}

/**
 * Modulation configuration derived from SmileBASIC @MA, @MP, @ML parameters
 */
export interface ActiveModulationConfig {
  type: "tremolo" | "vibrato" | "autoPan";
  delaySeconds: number; // seconds before modulation starts
  frequencyHz: number; // LFO frequency
  depth: number; // normalized depth
}

/**
 * Resolve active modulation from MML modulation parameters
 * 
 * SmileBASIC3での実測値をもとにしている。
 * SmileBASIC2とは仕様が異なることが知られているので、ここではnitro-fsは用いない。
 * 
 * - Delay: Delay * 0.01953125s (128th note at BPM 96)
 * - Speed: Speed / 2.5 Hz (period is (Speed)th note at BPM 96; 0 means no effect)
 * - @ML AutoPan: +/- (Depth * Range / 2) on 0-127 pan scale -> normalized (+/- 0 to 1)
 * - @MA Tremolo: -(Depth * Range / 2) gain reduction
 * - @MP Vibrato: +/- (Depth * Range / 128) semitones
 */
export function resolveModulationConfig(
  mod: ModulationParams,
): ActiveModulationConfig | null {
  if (!mod.enabled) return null;

  let target: {
    type: "tremolo" | "vibrato" | "autoPan";
    depth: number;
    range: number;
    speed: number;
    delay: number;
  } | null = null;

  if (mod.autoPan.enabled) {
    target = { type: "autoPan", ...mod.autoPan };
  } else if (mod.tremolo.enabled) {
    target = { type: "tremolo", ...mod.tremolo };
  } else if (mod.vibrato.enabled) {
    target = { type: "vibrato", ...mod.vibrato };
  }

  if (!target || target.speed <= 0 || target.depth <= 0) {
    return null;
  }

  const delaySeconds = target.delay * 0.01953125;
  const frequencyHz = target.speed / 2.5;

  let depth = 0;
  if (target.type === "autoPan") {
    // Amplitude +/- (Depth * Range / 2) on 0-127 scale -> 0.0 to 1.0 pan
    depth = Math.min(1.0, (target.depth * target.range) / (2 * 64));
  } else if (target.type === "tremolo") {
    // Gain reduction ratio (0.0 to 1.0)
    depth = Math.min(1.0, (target.depth * target.range) / (2 * 127));
  } else if (target.type === "vibrato") {
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
