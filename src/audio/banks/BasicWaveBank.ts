/**
 * PSG and Noise Instrument Bank
 * Generates waveforms for SmileBASIC programs @144-@150 (PSG square waves)
 * and @151 (pseudo-random hardware noise).
 */

import type { InstrumentBank } from "./InstrumentBank.js";
import type { VoiceData, ADSRParams } from "../types.js";
import {
  generateSawtoothHarmonics,
  generateSineHarmonics,
  generateSquareWaveHarmonics,
  PSG_DUTY_CYCLES,
} from "../utils/waveformGenerator.js";
import { generateLFSRNoise } from "../utils/noiseGenerator.js";
import { convertSmileBASICEnvelope } from "../utils/conversion.js";

export class BasicWaveBank implements InstrumentBank {
  public readonly name = "BasicWaveBank";

  // Default envelope for PSG: instant attack, full sustain, instant release
  private readonly defaultPsgEnvelope: ADSRParams = {
    attackTime: 0,
    decayRate: 0,
    sustainLevel: 1.0,
    releaseRate: Infinity,
  };

  static PSG_HARMONICS = new Map<
    number,
    { real: Float32Array; imag: Float32Array }
  >(
    PSG_DUTY_CYCLES.map((duty) => [
      duty,
      generateSquareWaveHarmonics(duty, 64),
    ]),
  );

  static SAW_HARMONICS = generateSawtoothHarmonics(64);
  static SINE_HARMONICS = generateSineHarmonics();

  // Pre-generated loopable LFSR noise buffer
  // nitro-fsの値に従う
  static readonly sampleRate = 48000;
  static NOISE_PCM = generateLFSRNoise(BasicWaveBank.sampleRate, 1.0);

  constructor() {}

  static allPrograms(): {
    program: number;
    type: "psg" | "noise" | "sawtooth" | "sine";
    duty?: number;
    name: string;
    ignoreKey?: boolean;
    keyShift?: number;
    envelope?: ADSRParams;
  }[] {
    return [
      [144, 145, 146, 147, 148, 149, 150].map(
        (p) =>
          ({
            program: p,
            type: "psg",
            duty: PSG_DUTY_CYCLES[p - 144],
            name: `PSG ${PSG_DUTY_CYCLES[p - 144] * 100}%`,
          }) as const,
      ),
      [257, 258, 259, 263].map(
        (p) =>
          ({
            program: p,
            type: "psg",
            duty: 0.5,
            name: `PSG 50% with Envelope`,
            envelope: {
              257: undefined,
              258: convertSmileBASICEnvelope({ a: 95, d: 0, s: 127, r: 124 }),
              259: convertSmileBASICEnvelope({ a: 125, d: 0, s: 127, r: 90 }),
              263: convertSmileBASICEnvelope({ a: 100, d: 0, s: 127, r: 90 }),
            }[p],
          }) as const,
      ),
      [151, 266].map(
        (p) =>
          ({
            program: p,
            type: "noise",
            name: "White Noise",
            ignoreKey: true,
          }) as const,
      ),
      [152, 310].map(
        (p) =>
          ({
            program: p,
            type: "noise",
            name: "White Noise",
            ignoreKey: false,
          }) as const,
      ),
      [256, 297].map(
        (p) =>
          ({
            program: p,
            type: "sawtooth",
            name: "Sawtooth Wave",
          }) as const,
      ),
      [344].map(
        (p) =>
          ({
            program: p,
            type: "sine",
            name: "Sine Wave",
            keyShift: 12,
          }) as const,
      ),
    ].flat();
  }

  public getVoice(
    program: number,
    _noteNumber: number,
    _velocity: number,
  ): VoiceData | null {
    let programInfo = BasicWaveBank.allPrograms().find(
      (p) => p.program === program,
    );
    // allPrograms には載せないが、ユーザー定義波形領域のデフォルトをsine波で生成する
    if (program >= 224 && program <= 255) {
      programInfo = BasicWaveBank.allPrograms().find((p) => p.program === 344);
    }
    if (!programInfo) {
      return null;
    }

    switch (programInfo.type) {
      case "psg": {
        const harmonics = BasicWaveBank.PSG_HARMONICS.get(programInfo.duty!)!;

        return {
          kind: "periodic",
          id: `square_${programInfo.duty}`,
          real: harmonics.real,
          imag: harmonics.imag,
          defaultEnvelope: programInfo.envelope ?? { ...this.defaultPsgEnvelope },
          defaultPan: 0,
          attenuation: 1,
          keyShift: programInfo.keyShift,
        };
      }
      case "sawtooth": {
        const harmonics = BasicWaveBank.SAW_HARMONICS;

        return {
          kind: "periodic",
          id: "sawtooth",
          real: harmonics.real,
          imag: harmonics.imag,
          defaultEnvelope: { ...this.defaultPsgEnvelope },
          defaultPan: 0,
          attenuation: 1,
          keyShift: programInfo.keyShift,
        };
      }

      case "sine": {
        const harmonics = BasicWaveBank.SINE_HARMONICS;

        return {
          kind: "periodic",
          id: "sine",
          real: harmonics.real,
          imag: harmonics.imag,
          defaultEnvelope: { ...this.defaultPsgEnvelope },
          defaultPan: 0,
          attenuation: 1,
          keyShift: programInfo.keyShift,
        };
      }
      case "noise":
        return {
          kind: "noise",
          pcm: BasicWaveBank.NOISE_PCM,
          sampleRate: BasicWaveBank.sampleRate,
          defaultEnvelope: { ...this.defaultPsgEnvelope },
          defaultPan: 0,
          // 3号のノイズは音が小さい
          attenuation: programInfo.ignoreKey ? 0.5 : 1,
          loop: true,
          loopStart: 0,
          loopEnd: BasicWaveBank.NOISE_PCM.length,
          rootKey: 114, // 117 in nitro-fs
          fineTune: 0,
          ignoreKey: programInfo.ignoreKey,
        };
      default:
        programInfo.type satisfies never;
        return null as never;
    }
  }
}
