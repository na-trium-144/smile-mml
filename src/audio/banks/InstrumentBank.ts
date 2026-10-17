/**
 * Instrument Bank Interface
 * Defines the contract for all sound sources (SF2, NDS ROM, PSG, Noise)
 * Independent of WebAudio API DOM nodes.
 */

import type { VoiceData } from '../types.js';

export interface InstrumentBank {
  readonly type: "sf2" | "basicWave" | "nds";
  /**
   * Get voice data for the specified program, note, and velocity.
   * Resolves key splits, velocity layers, sample looping, and default ADSR.
   */
  getVoice(program: number, noteNumber: number, velocity: number): Promise<VoiceData | null> | VoiceData | null;

  /**
   * Optional cleanup
   */
  dispose?(): void;
}
