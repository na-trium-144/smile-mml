/**
 * SoundFont 2 (SF2) Instrument Bank
 * Uses @marmooo/soundfont-parser to parse SF2 files and provide
 * General MIDI melody instruments (@0-@127) and drum sets (@128, @129).
 */

// https://github.com/marmooo/midy/blob/a20d82520626b40dbaab8fb82c94747535ea9410/src/base-player.ts
// https://github.com/marmooo/midy/blob/a20d82520626b40dbaab8fb82c94747535ea9410/src/midy-GM2.ts#L267
// を参考にしました

import { AudioData, parse, PresetHeader, SoundFont } from "@marmooo/soundfont";
import type { InstrumentBank } from "./InstrumentBank.js";
import type { VoiceData, ADSRParams } from "../types.js";
import { timecentToSeconds, centibelsToGain } from "../utils/conversion.js";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";

export class SF2InstrumentBank implements InstrumentBank {
  readonly type = "sf2" as const;

  readonly name: string;

  private sf: SoundFont | null = null;
  // Cache decoded PCM Float32Array per sample ID to avoid redundant decoding
  private pcmCache: Map<number, Float32Array> = new Map();

  static oggDecoder = new OggVorbisDecoder();

  constructor(name: string = "SoundFont2") {
    this.name = name;
  }

  /**
   * Load SF2 binary from ArrayBuffer or Uint8Array
   */
  public async load(buffer: ArrayBuffer | Uint8Array): Promise<void> {
    const uint8 =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const parsed = parse(uint8);
    this.sf = new SoundFont(parsed);
    this.pcmCache.clear();
  }

  getAllPrograms(): { name: string; program: number; bank: number; preset: number }[] {
    const headers = this.sf?.presetHeaders.slice() ?? [];
    function programSorting(h: PresetHeader) {
      if (h.bank >= 120) {
        return 1000000 + h.bank * 1000 + h.preset;
      } else {
        return h.preset * 1000 + h.bank;
      }
    }
    headers.sort((a, b) => programSorting(a) - programSorting(b));
    return headers.map((h) => ({
      name: h.presetName,
      bank: h.bank,
      preset: h.preset,
      program: h.bank * 1000 + h.preset,
    }));
  }

  static sb3HiddenPresets = [
    // drumset
    128, 129, 130, 265, 267, 366,
    // sb4のドラムセットとGM2標準ドラムセットで共通するものを登録しておく
    131, 132, 133, 138, 140, 143,
    // hidden instruments
    260, 261, 262, 264, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 282,
    283, 284, 285, 286, 287, 288, 289, 290, 294, 295, 296, 298, 299, 301, 305,
    309, 311, 312, 331, 345, 346,
    // not implemented
    // 268, 269, 270, 281, 360, 361-411
    // implement as PSG
    // 256, 257, 258, 259, 263, 266, 297, 344
  ] as const;
  static resolveBankPreset(program: number): {
    bank?: number;
    preset: number;
    keyShift?: number;
  } {
    const hiddenProgram =
      program as (typeof SF2InstrumentBank.sb3HiddenPresets)[number];
    switch (hiddenProgram) {
      case 128:
        // standard drum kit
        return { bank: 128, preset: 0 };
      case 129:
        // electronic drum kit
        return { bank: 128, preset: 24 };
      case 131:
        // standard 2
        return { bank: 128, preset: 1 };
      case 132:
        // standard 3
        return { bank: 128, preset: 2 };
      case 133:
        // room
        // fallback for 265, 267
        return { bank: 128, preset: 8 };
      case 265:
      case 267:
        return { bank: 128, preset: 8, keyShift: 12 };
      case 138:
      case 366:
        // power
        // fallback for 366
        return { bank: 128, preset: 16 };
      case 140:
      case 130:
        // 808
        // fallback for psg drum kit
        return { bank: 128, preset: 25 };
      case 143:
        // jazz
        return { bank: 128, preset: 32 };

      case 260:
        // 未使用のピアノ (1オクターブ低い)
        return { preset: 1, keyShift: -12 };
      case 261:
        // 鉄琴
        return { preset: 9 };
      case 262:
        // アコースティック・ギター（BGM20で使われているもの？）
        return { preset: 26 };
      case 264:
        // 鐘
        return { preset: 14, keyShift: 7 };
      // case 268: 不穏なストリングス
      // case 269: ドラムループ
      // case 270: うねる音
      case 271:
        // beep 16 banjo
        return { preset: 105 };
      case 272:
        // beep 17 synth strings
        return { preset: 51 };
      case 273:
        // beep 18 synth brass
        return { preset: 63 };
      case 274:
        // beep 19 synth bass
        return { preset: 39, keyShift: -12 };
      case 275:
        // beep 20 distortion guitar
        return { preset: 30, keyShift: -12 };
      case 276:
        // beep 21 rock organ
        return { preset: 18 };
      case 277:
        // beep 22 dance piano
        return { preset: 3 };
      case 278:
      // ガラガラ
      case 283:
        // ガラガラ2
        return { preset: 124 };
      case 279:
        // シンセ・パッド
        return { preset: 89 };
      case 280:
        // 木琴
        return { preset: 12, keyShift: 12 };
      // case 281: タム・タム/BEEP音色
      case 282:
        // コーラスが掛かったシンセリード
        return { preset: 83 };
      case 284:
        // 弦楽器のようなシンセ
        return { preset: 87 };
      case 285:
        // うにょーんシンセ
        return { preset: 82 };
      case 286:
        // シンセ
        return { preset: 86, keyShift: 12 };
      case 287:
        // ユーロビートっぽいシンセ
        return { preset: 83 };
      case 288:
      // ワッブルベース
      case 289:
        // ワッブルベース2
        return { preset: 38, keyShift: -12 };
      case 290:
        // びゅーシンセ
        return { preset: 84 };
      case 294:
        // ブラス?
        return { preset: 84 };
      case 295:
        // シンセ
        return { preset: 26 };
      case 296:
        // シンセ
        return { preset: 7, keyShift: 12 };
      case 298:
        // 短いシンセ音
        return { preset: 7, keyShift: 12 };
      case 299:
        //  わーシンセ
        return { preset: 20 };
      case 301:
        // BGM25で使われている変わったピアノ？
        return { preset: 3 };
      case 305:
        // オーケストラ
        return { preset: 55 };
      case 309:
        // @272よりあっさりした音
        return { preset: 51 };
      case 311:
        // @55よりもずっと良いと感じるような厚いオーケストラ・ヒット
        return { preset: 55, keyShift: 12 };
      case 312:
        // ブラス
        return { preset: 56, keyShift: 12 };
      case 331:
        // BGM20で使われている笛？
        return { preset: 72, keyShift: 12 };
      case 345:
        // ストリングス・アンサンブル
        return { preset: 48, keyShift: 12 };
      case 346:
        // カウベル
        return { preset: 113 };
      // case 347: // マラカス？

      default:
        hiddenProgram satisfies never;
    }
    return { bank: Math.floor(program / 1000), preset: program % 1000 };
  }

  public async getVoice(
    program: number,
    noteNumber: number,
    velocity: number,
  ): Promise<VoiceData | null> {
    if (!this.sf) return null;

    const { bank, preset, keyShift } =
      SF2InstrumentBank.resolveBankPreset(program);
    let voice = this.sf.getVoice(
      bank ?? 0,
      preset,
      noteNumber + (keyShift ?? 0),
      velocity,
    );

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
    const hasLoop =
      (sampleModes === 1 || sampleModes === 3) &&
      header.loopEnd > header.loopStart;

    // Root key override in generator, else from sampleHeader
    // overridingRootKey が -1 の場合はヘッダーの originalPitch を使う仕様
    const overridingRootKey = gen.get("overridingRootKey");
    const rootKey =
      (overridingRootKey === -1 ? header.originalPitch : overridingRootKey) -
      (keyShift ?? 0);

    // Fine tune / Coarse tune の取得
    const coarseTune = gen.get("coarseTune") * 100;
    const fineTune =
      (header.pitchCorrection || 0) + gen.get("fineTune") + coarseTune;

    // const panVal = gen.get("pan");
    // const defaultPan =
    //   panVal !== undefined ? Math.max(-1, Math.min(1, panVal / 1000)) : 0;
    // 特にFluid3GMでは無駄に左右にpanが振られているが、正直いらない
    const defaultPan = 0;

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
    const attenuation =
      initialAttenuation !== undefined
        ? centibelsToGain(initialAttenuation * 0.4)
        : 1.0;

    const sampleId = gen.get("sampleID") ?? 0;
    const pcm = await this.getOrDecodePCM(sampleId, voice.sample);

    return {
      kind: "sample",
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

  private async getOrDecodePCM(
    sampleId: number,
    sample: AudioData,
  ): Promise<Float32Array> {
    let pcm = this.pcmCache.get(sampleId);
    if (pcm) return pcm;

    if (sample.type === "compressed") {
      await SF2InstrumentBank.oggDecoder.ready;

      const audioData =
        sample.data instanceof Uint8Array
          ? sample.data
          : new Uint8Array(sample.data);
      const result = await SF2InstrumentBank.oggDecoder.decodeFile(audioData);

      if (0 < result.errors.length) {
        throw new Error(result.errors.join(", "));
      }
      pcm = result.channelData[0];
    } else {
      pcm = sample.decodePCM(sample.data);
    }

    this.pcmCache.set(sampleId, pcm);
    return pcm;
  }

  public dispose(): void {
    this.sf = null;
    this.pcmCache.clear();
  }
}
