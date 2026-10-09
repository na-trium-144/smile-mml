/**
 * Instrument Bank Interface
 * Defines the contract for all sound sources (SF2, NDS ROM, PSG, Noise)
 * Independent of WebAudio API DOM nodes.
 */

import type { VoiceData } from '../types.js';

export interface InstrumentBank {
  readonly name: string;

  /**
   * Check if this bank can handle the given program number (@n)
   */
  hasProgram(program: number): boolean;

  /**
   * Get voice data for the specified program, note, and velocity.
   * Resolves key splits, velocity layers, sample looping, and default ADSR.
   */
  getVoice(program: number, noteNumber: number, velocity: number): VoiceData | null;

  /**
   * Optional cleanup
   */
  dispose?(): void;
}
