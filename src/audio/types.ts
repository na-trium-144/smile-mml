/**
 * WebAudio MML Audio Engine Types
 */

import type { EnvelopeParams, ModulationParams } from '../parser/types.js';
import type { EnvelopeHelper } from './synth/EnvelopeHelper.js';

/**
 * Standard ADSR Envelope in physical units (seconds and ratio)
 */
export interface ADSRParams {
  attackTime: number; // in seconds
  decayRate: number; // gain falls at a rate of 1/decayRate per seconds
  sustainLevel: number; // 0.0 - 1.0 (linear gain ratio)
  releaseRate: number; // gain falls at a rate of 1/releaseRate per seconds
}

/**
 * Sample-based instrument voice data (SF2, NDS PCM)
 */
export interface SampleVoiceData {
  kind: 'sample' | 'noise';
  pcm: Float32Array; // normalized to [-1.0, 1.0]
  sampleRate: number;
  rootKey: number; // MIDI note number of original sample
  fineTune: number; // fine tuning in cents
  loop: boolean;
  loopStart: number; // in sample index
  loopEnd: number; // in sample index
  defaultEnvelope: ADSRParams;
  defaultPan?: number; // -1.0 (left) to +1.0 (right), 0 is center
  attenuation?: number; // linear multiplier (0.0 - 1.0)
  filter?: {
    cutoffHz: number;
    resonanceDb: number;
  };
  ignoreKey?: boolean; // if true, ignore note number
}

/**
 * Periodic waveform instrument voice data (PSG square wave)
 */
export interface PeriodicVoiceData {
  kind: 'periodic';
  id: string; // 例: "square_0.5", "sawtooth", "sine"
  real: Float32Array; // Fourier series cosine coefficients
  imag: Float32Array; // Fourier series sine coefficients
  defaultEnvelope: ADSRParams;
  defaultPan?: number;
  attenuation?: number;
  keyShift?: number;
}

/**
 * Unified VoiceData interface returned by all InstrumentBanks
 */
export type VoiceData = SampleVoiceData | PeriodicVoiceData;

/**
 * Segment within a compound note representing pitch glides or mid-note parameter changes.
 */
export interface NoteSegment {
  tickOffset: number; // Offset in ticks from the start of the PreparedNote
  durationTicks: number; // Duration of this segment in ticks
  noteNumber: number; // MIDI note number (0 - 127)
  detuneCents: number; // Detune in cents (-100 to +100)
  velocity: number; // V parameter (0 - 127)
  volume: number; // @V parameter (0 - 127)
  pan: number; // P parameter (0 - 127)
  isPortamento: boolean; // If true, glides linearly to portamentoTargetNote
  portamentoTargetNote?: number; // Target MIDI note number
  portamentoTargetDetuneCents?: number; // Target detune in cents
  
  // for NoteVisualizer
  noteStr: string; // e.g. "C#4"
  octave: number; // extracted octave number
  portamentoTargetNoteStr?: string;  // used only for trailing portamento note (duration=0)
  portamentoTargetOctave?: number;

  // Resolved timing in seconds (populated by MMLScheduler prior to playback)
  startTimeOffsetSec?: number;
  durationSec?: number;
}

/**
 * Prepared Note ready for scheduling with resolved lookahead portamento & ties
 */
export interface PostProcessedNote {
  tick: number; // start tick
  duration: number; // total duration of compound note in ticks
  gateDuration: number; // gate duration in ticks (based on first note's Q)
  channel: number; // 0 - 15
  noteNumber: number; // initial note number
  velocity: number; // initial velocity (V)
  volume: number; // initial volume (@V)
  pan: number; // initial pan (P)
  program: number; // 0 - 511 (@)
  detuneCents: number; // cents from @D (-100 to +100)
  envelope: EnvelopeParams; // envelope of the first note (@E)
  modulation: ModulationParams; // modulation of the first note (@MA, @MP, @ML)
  segments: NoteSegment[]; // pitch & parameter trajectory segments
  synth: {
    envelope?: EnvelopeHelper; // final envelope, set in SynthEngine.playNote()
    durationSec?: number; // set in MMLScheduler.scheduleNote()
    gateDurationSec?: number; // set in MMLScheduler.scheduleNote()
    voiceType?: "sf2" | "basicWave" | "nds"; // set in MMLScheduler.scheduleNote()
  };
}

/**
 * Prepared Channel Event
 */
export type PostProcessedEvent =
  | { type: 'note'; event: PostProcessedNote }
  | { type: 'volume'; tick: number; channel: number; volume: number }
  | { type: 'pan'; tick: number; channel: number; pan: number }
  | { type: 'tempo'; tick: number; bpm: number }
  | { type: 'end'; tick: number };
