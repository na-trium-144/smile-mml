/**
 * SoundFont 2 (SF2) Instrument Bank
 * Uses @marmooo/soundfont-parser to parse SF2 files and provide
 * General MIDI melody instruments (@0-@127) and drum sets (@128, @129).
 */

import { GeneratorStore, parse, SoundFont } from '@marmooo/soundfont';
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

const header = voice.sampleHeader;
    const gen = voice.generators; // GeneratorStore

    // SF2 envelopes in timecents (gen.get() を使用)
    const attackVolEnv = gen.get("attackVolEnv") ?? -12000;
    const decayVolEnv = gen.get("decayVolEnv") ?? -12000;
    const sustainVolEnv = gen.get("sustainVolEnv") ?? 0; // centibels
    const releaseVolEnv = gen.get("releaseVolEnv") ?? -12000;

    const defaultEnvelope: ADSRParams = {
      attackTime: Math.max(0.001, timecentToSeconds(attackVolEnv)),
      decayTime: Math.max(0.001, timecentToSeconds(decayVolEnv)),
      sustainLevel: centibelsToGain(sustainVolEnv),
      releaseTime: Math.max(0.01, timecentToSeconds(releaseVolEnv)),
    };

    // Loop flag: SF2 sampleModes (1: loop continuously, 3: loop during sustain)
    const sampleModes = gen.get("sampleModes") ?? 0;
    const hasLoop = (sampleModes === 1 || sampleModes === 3) && header.loopEnd > header.loopStart;

    // Root key override in generator, else from sampleHeader
    // overridingRootKey が -1 の場合はヘッダーの originalPitch を使う仕様
    const overridingRootKey = gen.get("overridingRootKey");
    const rootKey = overridingRootKey === -1 ? header.originalPitch : overridingRootKey;

    // Fine tune / Coarse tune の取得
    const coarseTune = gen.get("coarseTune") * 100;
    const fineTune = (header.pitchCorrection || 0) + gen.get("fineTune") + coarseTune;

    // Pan: SF2 is -500 (left) to +500 (right), あるいは @marmooo/soundfont では -1000~1000 の場合もあるため base-player.ts に合わせる
    const panVal = gen.get("pan");
    const defaultPan = panVal !== undefined ? Math.max(-1, Math.min(1, panVal / 1000)) : 0;

    // Attenuation in centibels
    const initialAttenuation = gen.get("initialAttenuation");
    const attenuation = initialAttenuation !== undefined ? centibelsToGain(initialAttenuation) : 1.0;

    const sampleId = gen.get("sampleID") ?? 0;
    let pcm = this.pcmCache.get(sampleId);
    if (!pcm) {
      pcm = voice.sample.decodePCM(voice.sample.data);
      this.pcmCache.set(sampleId, pcm);
    }

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
