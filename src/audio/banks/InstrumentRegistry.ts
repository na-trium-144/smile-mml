/**
 * Instrument Registry
 * Manages multiple InstrumentBanks (SF2, NDS ROM, PSG) and routes
 * program numbers (@n) to the appropriate sound generator.
 */

import type { InstrumentBank } from './InstrumentBank.js';
import type { VoiceData, PeriodicVoiceData } from '../types.js';
import { PSGInstrumentBank } from './PSGInstrumentBank.js';
import { generateSquareWaveHarmonics } from '../utils/waveformGenerator.js';

export class InstrumentRegistry {
  private banks: InstrumentBank[] = [];
  private psgBank: PSGInstrumentBank;

  // Fallback harmonic for default synth when SF2/ROM is not yet loaded
  private fallbackHarmonics = generateSquareWaveHarmonics(0.5, 32);

  constructor() {
    // PSG bank is always available as core hardware emulator
    this.psgBank = new PSGInstrumentBank();
    this.banks.push(this.psgBank);
  }

  /**
   * Register a sound bank. Banks registered later take higher precedence.
   */
  public register(bank: InstrumentBank): void {
    // Remove if already registered
    this.unregister(bank.name);
    // Push to end (highest precedence)
    this.banks.push(bank);
  }

  /**
   * Unregister bank by name
   */
  public unregister(name: string): void {
    const idx = this.banks.findIndex((b) => b.name === name);
    if (idx !== -1) {
      this.banks[idx].dispose?.();
      this.banks.splice(idx, 1);
    }
  }

  /**
   * Get all registered banks
   */
  public getBanks(): InstrumentBank[] {
    return [...this.banks];
  }

  /**
   * Find bank by name
   */
  public getBank(name: string): InstrumentBank | undefined {
    return this.banks.find((b) => b.name === name);
  }

  /**
   * Retrieve VoiceData for given program, noteNumber, and velocity.
   * Searches banks in reverse order of registration (highest precedence first).
   * If not found, provides an emergency fallback synth voice for rapid preview.
   */
  public getVoice(program: number, noteNumber: number, velocity: number): VoiceData {
    // 1. Search registered banks (NDS > SF2 > PSG)
    for (let i = this.banks.length - 1; i >= 0; i--) {
      const bank = this.banks[i];
      if (bank.hasProgram(program)) {
        const voice = bank.getVoice(program, noteNumber, velocity);
        if (voice) {
          return voice;
        }
      }
    }

    // 2. If program is @144-@151, always use PSG bank
    if (this.psgBank.hasProgram(program)) {
      const psgVoice = this.psgBank.getVoice(program, noteNumber, velocity);
      if (psgVoice) return psgVoice;
    }

    // 3. Graceful fallback when no SF2/ROM is loaded for @0-@127/128/129:
    // Generate a gentle musical periodic wave so playback still produces audible preview
    const fallbackVoice: PeriodicVoiceData = {
      kind: 'periodic',
      duty: 0.5,
      real: this.fallbackHarmonics.real,
      imag: this.fallbackHarmonics.imag,
      defaultEnvelope: {
        attackTime: 0.01,
        decayTime: 0.2,
        sustainLevel: 0.5,
        releaseTime: 0.1,
      },
      defaultPan: 0,
      attenuation: 0.6,
    };

    return fallbackVoice;
  }
}
