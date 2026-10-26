/**
 * Audio Engine Public API
 * Re-exports all audio subsystem modules for convenient access.
 */

// Core types
export type {
  ADSRParams,
  SampleVoiceData,
  PeriodicVoiceData,
  VoiceData,
} from './types.js';

// Instrument banks
export type { InstrumentBank } from './banks/InstrumentBank.js';
export { BasicWaveBank } from './banks/BasicWaveBank.js';
export { SF2InstrumentBank } from './banks/SF2InstrumentBank.js';
export { NDSInstrumentBank } from './banks/NDSInstrumentBank.js';
export {
  UserWaveBank,
  globalUserWaveBank,
  parseWaveformString,
  parseWavsetStatements,
  parseMmlWavMacros,
  createVoiceData,
} from './banks/UserWaveBank.js';
export type { UserWaveDefinition } from './banks/UserWaveBank.js';

// Synthesis engine
export { SynthEngine } from './synth/SynthEngine.js';
export { EnvelopeHelper } from './synth/EnvelopeHelper.js';
export { ModulationHelper } from './synth/ModulationHelper.js';

// Scheduling
export { MMLScheduler } from './scheduler/MMLScheduler.js';
export { TempoMap } from './scheduler/TempoMap.js';

// Utilities
export {
  midiNoteToFrequency,
  convertSmileBASICEnvelope,
  timecentToSeconds,
  centibelsToGain,
  resolveModulationConfig,
} from './utils/conversion.js';
export { generateWhiteNoise } from './utils/noiseGenerator.js';
export { generateSquareWaveHarmonics, PSG_DUTY_CYCLES } from './utils/waveformGenerator.js';
