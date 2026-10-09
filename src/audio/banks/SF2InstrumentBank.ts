/**
 * SoundFont 2 (SF2) Instrument Bank
 * Uses @marmooo/soundfont-parser to parse SF2 files and provide
 * General MIDI melody instruments (@0-@127) and drum sets (@128, @129).
 */

import { parse, SoundFont } from '@marmooo/soundfont-parser';
import type { InstrumentBank } from './InstrumentBank.js';
import type { VoiceData, ADSRParams } from '../types.js';
import { timecentToSeconds, centibelsToGain } from '../utils/conversion.js';

export class SF2InstrumentBank implements InstrumentBank {
  public readonly name: string;
  private sf: SoundFont | null = null;
  // Cache decoded PCM Float32Array per sample ID to avoid redundant decoding
  private pcmCache: Map<number, Float32Array> = new Map();

  constructor(name: string = 'SoundFont2') {
    this.name = name;
  }

  /**
   * Load SF2 binary from ArrayBuffer or Uint8Array
   */
  public async load(buffer: ArrayBuffer | Uint8Array): Promise<void> {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const parsed = parse(uint8);
    this.sf = new SoundFont(parsed);
    this.pcmCache.clear();
  }

  public hasProgram(program: number): boolean {
    if (!this.sf) return false;
    // Handles GM Melodic 0-127 and drums 128, 129
    return program >= 0 && program <= 129;
  }

  public getVoice(program: number, noteNumber: number, velocity: number): VoiceData | null {
    if (!this.sf) return null;

    const { bank, preset } = this.resolveBankPreset(program);
    let voice = this.sf.getVoice(bank, preset, noteNumber, velocity);

    // If drum not found in Bank 128, try Bank 0 with preset
    if (!voice && bank === 128) {
      voice = this.sf.getVoice(0, preset, noteNumber, velocity);
    }
    // If still not found for drum 129, fallback to standard kit preset 0
    if (!voice && program === 129) {
      voice = this.sf.getVoice(128, 0, noteNumber, velocity) || this.sf.getVoice(0, 0, noteNumber, velocity);
    }

    if (!voice || !voice.sample || !voice.sampleHeader) {
      return null;
    }

    const sampleId = voice.generators.sampleID ?? 0;
    let pcm = this.pcmCache.get(sampleId);
    if (!pcm) {
      pcm = voice.sample.decodePCM(voice.sample.data);
      this.pcmCache.set(sampleId, pcm);
    }

    const header = voice.sampleHeader;
    const gen = voice.generators;

    // SF2 envelopes in timecents (-12000 is ~1ms, 0 is 1s, etc.)
    const attackVolEnv = gen.attackVolEnv ?? -12000;
    const decayVolEnv = gen.decayVolEnv ?? -12000;
    const sustainVolEnv = gen.sustainVolEnv ?? 0; // centibels
    const releaseVolEnv = gen.releaseVolEnv ?? -12000;

    const defaultEnvelope: ADSRParams = {
      attackTime: Math.max(0.001, timecentToSeconds(attackVolEnv)),
      decayTime: Math.max(0.001, timecentToSeconds(decayVolEnv)),
      sustainLevel: centibelsToGain(sustainVolEnv),
      releaseTime: Math.max(0.01, timecentToSeconds(releaseVolEnv)),
    };

    // Loop flag: SF2 sampleModes (1: loop continuously, 3: loop during sustain)
    const sampleModes = gen.sampleModes ?? 0;
    const hasLoop = (sampleModes === 1 || sampleModes === 3) && header.loopEnd > header.loopStart;

    // Root key override in generator, else from sampleHeader
    const rootKey = gen.overridingRootKey !== undefined ? gen.overridingRootKey : header.originalPitch;

    // Fine tune from sampleHeader + fineTune generator + coarseTune
    const fineTune = (header.pitchCorrection || 0) + (gen.fineTune || 0) + (gen.coarseTune || 0) * 100;

    // Pan: SF2 is -500 (left) to +500 (right)
    const defaultPan = gen.pan !== undefined ? Math.max(-1, Math.min(1, gen.pan / 500)) : 0;

    // Attenuation in centibels
    const attenuation = gen.initialAttenuation !== undefined ? centibelsToGain(gen.initialAttenuation) : 1.0;

    return {
      kind: 'sample',
      pcm,
      sampleRate: header.sampleRate || 44100,
      rootKey,
      fineTune,
      loop: hasLoop,
      loopStart: Math.max(0, header.loopStart),
      loopEnd: Math.min(pcm.length, header.loopEnd),
      defaultEnvelope,
      defaultPan,
      attenuation,
    };
  }

  private resolveBankPreset(program: number): { bank: number; preset: number } {
    if (program <= 127) {
      return { bank: 0, preset: program };
    }
    if (program === 128) {
      // Standard Drum Kit (MIDI Ch 10 / GM Bank 128, preset 0)
      return { bank: 128, preset: 0 };
    }
    if (program === 129) {
      // Electronic Drum Kit (MIDI GM Preset 24 or 25)
      return { bank: 128, preset: 24 };
    }
    return { bank: 0, preset: program % 128 };
  }

  public dispose(): void {
    this.sf = null;
    this.pcmCache.clear();
  }
}
