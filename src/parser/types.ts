/**
 * VMML / SmileBASIC MML Types and Data Structures
 */

export interface EnvelopeParams {
  enabled: boolean;
  a: number; // Attack (0-127)
  d: number; // Decay (0-127)
  s: number; // Sustain (0-127)
  r: number; // Release (0-127)
}

export interface LFOParams {
  enabled: boolean;
  depth: number; // 0-127 (or -1 when unset)
  range: number; // 0-127
  speed: number; // 0-127
  delay: number; // 0-127
}

export interface ModulationParams {
  enabled: boolean;
  tremolo: LFOParams; // @MA
  vibrato: LFOParams; // @MP
  autoPan: LFOParams; // @ML
}

export interface ChannelParameters {
  length: number; // L (default: 4)
  octave: number; // O (default: 4)
  dots: number; // . (default: 0)
  gate: number; // Q (default: 8)
  volume: number; // V (default: 127)
  pan: number; // P (default: 64)
  program: number; // @ (default: 0)
  detune: number; // @D (default: 0)
  velocity: number; // @V (default: 127)
  envelope: EnvelopeParams;
  modulation: ModulationParams;
  keyShift: number; // K (default: 0)
  outputOctave: number; // o (default: 4)
  variables: number[]; // $0-$7 (default: 0)
}

export interface BaseMMLEvent {
  tick: number;
  channel: number;
}

export interface NoteEvent extends BaseMMLEvent {
  type: 'note';
  noteNumber: number; // 0-127 (MIDI note number, Middle C = 60)
  noteName: string; // e.g. "C4", "F#5"
  duration: number; // Note length in ticks (0 for portamento target without length)
  gateDuration: number; // Sounding duration in ticks
  velocity: number; // 0-127 (@V)
  volume: number; // 0-127 (V)
  pan: number; // 0-127 (P, 64 is center)
  program: number; // 0-511 (@)
  detune: number; // -128 to 127 (@D)
  gate: number; // 0-8 (Q)
  envelope: EnvelopeParams;
  modulation: ModulationParams;
  isTie?: boolean;
  isPortamento?: boolean; // true if sliding to the next note
  portamentoTargetNote?: number; // Target MIDI note number
  portamentoSourceNote?: number; // Source MIDI note number
}

export interface RestEvent extends BaseMMLEvent {
  type: 'rest';
  duration: number;
}

export interface TempoEvent {
  type: 'tempo';
  tick: number;
  bpm: number;
}

export interface ProgramChangeEvent extends BaseMMLEvent {
  type: 'program';
  program: number;
}

export interface ControlChangeEvent extends BaseMMLEvent {
  type: 'control';
  controller: number; // 7 for Volume, 10 for Pan, etc.
  value: number;
}

export interface PitchBendEvent extends BaseMMLEvent {
  type: 'pitchBend';
  value: number; // -8192 to 8191
}

export interface LoopEvent extends BaseMMLEvent {
  type: 'loop';
  loopCount: number; // 1-indexed count
  targetCount: number; // 0 means infinite loop
  isInfinite: boolean;
}

export interface ChannelEndEvent extends BaseMMLEvent {
  type: 'end';
}

export type MMLEvent =
  | NoteEvent
  | RestEvent
  | TempoEvent
  | ProgramChangeEvent
  | ControlChangeEvent
  | PitchBendEvent
  | LoopEvent
  | ChannelEndEvent;

export interface ParseOptions {
  /**
   * Ticks per whole note (default: 192, where quarter note = 48 ticks)
   */
  ticksPerWholeNote?: number;
  /**
   * Stop parsing channel on infinite loop
   */
  stopOnInfiniteLoop?: boolean;
  /**
   * Global key shift (semitones)
   */
  keyShift?: number;
  /**
   * Global tempo multiplier
   */
  tempoScale?: number;
}
