/**
 * PSG and Noise Instrument Bank
 * Generates waveforms for SmileBASIC programs @144-@150 (PSG square waves)
 * and @151 (pseudo-random hardware noise).
 */

import type { InstrumentBank } from './InstrumentBank.js';
import type { VoiceData, ADSRParams } from '../types.js';
import { generateSquareWaveHarmonics, PSG_DUTY_CYCLES } from '../utils/waveformGenerator.js';
import { generateLFSRNoise } from '../utils/noiseGenerator.js';

export class PSGInstrumentBank implements InstrumentBank {
  public readonly name = 'PSG / Noise';

  // Cache Fourier coefficients for each duty cycle
  private harmonicsCache: Map<number, { real: Float32Array; imag: Float32Array }> = new Map();

  // Pre-generated loopable LFSR noise buffer
  private noisePcm: Float32Array;
  private readonly sampleRate = 44100;

  // Default envelope for PSG: instant attack, full sustain, tiny release to avoid clicks
  private readonly defaultPsgEnvelope: ADSRParams = {
    attackTime: 0.002,
    decayTime: 0.01,
    sustainLevel: 1.0,
    releaseTime: 0.02,
  };

  constructor() {
    // Pre-calculate harmonics for all 7 duty cycles
    PSG_DUTY_CYCLES.forEach((duty) => {
      this.harmonicsCache.set(duty, generateSquareWaveHarmonics(duty, 64));
    });

    // Pre-generate 1 second of Nintendo DS authentic LFSR noise
    this.noisePcm = generateLFSRNoise(this.sampleRate, 1.0);
  }

  public hasProgram(program: number): boolean {
    return program >= 144 && program <= 151;
  }

  public getVoice(program: number, _noteNumber: number, _velocity: number): VoiceData | null {
    if (program >= 144 && program <= 150) {
      const duty = PSG_DUTY_CYCLES[program - 144];
      const harmonics = this.harmonicsCache.get(duty)!;

      return {
        kind: 'periodic',
        duty,
        real: harmonics.real,
        imag: harmonics.imag,
        defaultEnvelope: { ...this.defaultPsgEnvelope },
        defaultPan: 0,
        attenuation: 0.75, // Moderate level to prevent clipping
      };
    }

    if (program === 151) {
      return {
        kind: 'noise',
        noiseType: 'lfsr',
        pcm: this.noisePcm,
        sampleRate: this.sampleRate,
        defaultEnvelope: { ...this.defaultPsgEnvelope },
        defaultPan: 0,
        attenuation: 0.7,
      };
    }

    return null;
  }
}
