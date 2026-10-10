/**
 * SoundFont 2 (SF2) Instrument Bank
 * Uses @marmooo/soundfont-parser to parse SF2 files and provide
 * General MIDI melody instruments (@0-@127) and drum sets (@128, @129).
 */

// https://github.com/marmooo/midy/blob/main/src/base-player.ts を参考にしました

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

// https://www.synthfont.com/sfspec24.pdf
// SF2 spec (decayVolEnv/decayModEnv/releaseVolEnv/releaseModEnv):
// both the decay and release phase timecent values are defined as
// "the time ... for a 100dB decrease in level, or a 100% decrease in
// filter cutoff frequency ... from the maximum value to the minimum
// value" (decay), and "the time spent in release phase until 100dB
// attenuation [or, for the Modulation Envelope, zero value] were reached"
// starting from full scale (release). Both reference the same 100dB/100%
// change from full scale, so decay and release share one curve constant
// — used identically across every cache mode ("none"/"ads"/"adsr"/
// "segment"/"full") for both the Volume and Modulation envelopes.
    const defaultEnvelope: ADSRParams = {
      attackTime: Math.max(0.001, timecentToSeconds(attackVolEnv)),
      decayRate: centibelsToGain(-1000 / timecentToSeconds(decayVolEnv)),
      sustainLevel: centibelsToGain(sustainVolEnv),
      releaseRate: centibelsToGain(-1000 / timecentToSeconds(releaseVolEnv)),
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

  // EMU8k/10k / FluidSynth compatibility for initialAttenuation.
  //
  // SF2.01 defines initialAttenuation in centibels (1 cB = 0.1 dB), and the
  // final amplitude conversion remains 10^(cb/200) via cbToRatio().
  // Creative's EMU8000 hardware, however, applied only ~0.4× that scale to the
  // *static* generator values written in the SoundFont (preset/instrument
  // zones). Most banks (including GeneralUser GS) were authored against that
  // EMU response. FluidSynth mirrors the hardware at load time
  // (fluid_defsfont.c: EMU_ATTENUATION_FACTOR = 0.4 applied to gen.val only).
  //
  // Modulator contributions (e.g. default velocity→attenuation amount 960)
  // are NOT scaled — they stay full-scale, matching FluidSynth.
  //
  // effective = staticAtten * 0.4 + (afterModulators - staticAtten)
    const initialAttenuation = gen.get("initialAttenuation");
    const attenuation = initialAttenuation !== undefined ? centibelsToGain(initialAttenuation * 0.4) : 1.0;

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
