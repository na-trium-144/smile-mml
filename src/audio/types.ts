/**
 * WebAudio MML Audio Engine Types
 */

import type { EnvelopeParams, ModulationParams } from '../parser/types.js';

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
  kind: 'sample';
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
}

/**
 * Periodic waveform instrument voice data (PSG square wave)
 */
export interface PeriodicVoiceData {
  kind: 'periodic';
  duty: number; // duty cycle (e.g. 0.125, 0.25, 0.5)
  real: Float32Array; // Fourier series cosine coefficients
  imag: Float32Array; // Fourier series sine coefficients
  defaultEnvelope: ADSRParams;
  defaultPan?: number;
  attenuation?: number;
}

/**
 * Noise instrument voice data (DSi/NDS LFSR noise or white noise)
 */
export interface NoiseVoiceData {
  kind: 'noise';
  noiseType: 'white' | 'lfsr';
  pcm: Float32Array; // Pre-generated loopable noise sample
  sampleRate: number;
  defaultEnvelope: ADSRParams;
  defaultPan?: number;
  attenuation?: number;
}

/**
 * Unified VoiceData interface returned by all InstrumentBanks
 */
export type VoiceData = SampleVoiceData | PeriodicVoiceData | NoiseVoiceData;

/**
 * Prepared Note ready for scheduling with resolved lookahead portamento & ties
 */
export interface PreparedNote {
  tick: number; // start tick
  duration: number; // duration in ticks
  gateDuration: number; // gate duration in ticks
  channel: number; // 0 - 15
  noteNumber: number; // 0 - 127
  velocity: number; // 0 - 127 (from MML V command)
  volume: number; // 0 - 127 (from MML @V command)
  pan: number; // 0 - 127 (64 is center)
  program: number; // 0 - 511 (@)
  detuneCents: number; // cents from @D (-100 to +100)
  envelope: EnvelopeParams; // MML @E setting
  modulation: ModulationParams; // MML @MA, @MP, @ML setting
  isPortamento: boolean; // has portamento glide
  portamentoTargetNote?: number; // 1-note lookahead target note number
  isSlur?: boolean; // connected with non-same pitch tie (&)
}

/**
 * Prepared Channel Event
 */
export type PreparedEvent =
  | { type: 'note'; event: PreparedNote }
  | { type: 'volume'; tick: number; channel: number; volume: number }
  | { type: 'pan'; tick: number; channel: number; pan: number }
  | { type: 'tempo'; tick: number; bpm: number }
  | { type: 'end'; tick: number };
