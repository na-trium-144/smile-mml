/**
 * Nintendo DS / Petit Computer (SmileBASIC) ROM Instrument Bank
 * Uses nitro-fs to parse NDS ROMs (.nds) or SDAT files (.sdat),
 * extracting authentic instruments and waveforms.
 */

/*
includes GPL/LGPL code from
https://github.com/DanielPXL/nitro-play/blob/master/src/core/AudioWorker.ts
https://github.com/DanielPXL/nitro-fs/blob/master/src/Formats/Audio/SequenceRenderer/ADSRConverter.ts
https://github.com/DanielPXL/nitro-fs/blob/master/src/Formats/Audio/SequenceRenderer/Envelope.ts
https://github.com/DanielPXL/nitro-fs/blob/e5961d694fcfbabf6995886e11caa9f1bf8f0a41/src/Formats/Audio/SequenceRenderer/Kermalis.VGMS.Utils.ts
*/

import { NitroFS, Audio, BufferReader } from "nitro-fs";
import type { InstrumentBank } from "./InstrumentBank.js";
import type {
  VoiceData,
  ADSRParams,
  SampleVoiceData,
  PeriodicVoiceData,
  NoiseVoiceData,
} from "../types.js";
import {
  generateSquareWaveHarmonics,
  PSG_DUTY_CYCLES,
} from "../utils/waveformGenerator.js";
import { generateLFSRNoise } from "../utils/noiseGenerator.js";

export class NDSInstrumentBank implements InstrumentBank {
  public readonly name: string = "Nintendo DS ROM";

  private sdat: InstanceType<typeof Audio.SDAT> | null = null;
  private sbnkList: InstanceType<typeof Audio.SBNK>[] = [];
  private swarList: InstanceType<typeof Audio.SWAR>[] = [];

  // Decoded PCM cache by "swarId:waveId"
  private pcmCache: Map<string, Float32Array> = new Map();

  // Noise PCM cache
  private noisePcm: Float32Array | null = null;

  /**
   * get list of SDATs
   */
  static parseRom(raw: ArrayBuffer): string[] {
    // 1. Try parsing as NDS ROM filesystem
    try {
      const fs = NitroFS.fromRom(raw);

      // Recursively search for .sdat files
      let sdats: string[] = [];
      function look(path: string) {
        const { files, directories } = fs.readDir(path);
        for (const file of files) {
          if (file.endsWith(".sdat")) {
            if (path === "") {
              sdats.push(file);
            } else {
              sdats.push(path + "/" + file);
            }
          }
        }

        for (const dir of directories) {
          if (path === "") {
            look(dir);
          } else {
            look(path + "/" + dir);
          }
        }
      }

      look("");

      return sdats;
    } catch {
      // 2. If not found in ROM, check if the buffer itself is an SDAT file (magic: "SDAT")
      const rawArray = new Uint8Array(raw);
      if (
        rawArray.length > 4 &&
        rawArray[0] === 0x53 &&
        rawArray[1] === 0x44 &&
        rawArray[2] === 0x41 &&
        rawArray[3] === 0x54
      ) {
        return ["Raw SDAT"];
      }
    }
    throw new Error(
      "No SDAT sound archive found in the provided NDS ROM file.",
    );
  }

  /**
   * Load NDS ROM or SDAT binary buffer
   */
  constructor(raw: ArrayBuffer, path: string) {
    let sdatRaw: ArrayBuffer | null = null;

    if (path === "Raw SDAT") {
      sdatRaw = raw;
    } else {
      const fs = NitroFS.fromRom(raw);
      sdatRaw = fs.readFile(path);
    }

    // 3. Initialize SDAT
    const reader = BufferReader.new(sdatRaw);
    this.sdat = new Audio.SDAT(reader);
    this.sbnkList = [];
    this.swarList = [];
    this.pcmCache.clear();

    // Parse all SBNKs
    for (const bankFile of this.sdat.fs.banks) {
      if (bankFile && bankFile.buffer) {
        this.sbnkList.push(new Audio.SBNK(bankFile.buffer));
      }
    }

    // Parse all SWARs
    for (const swarFile of this.sdat.fs.waveArchives) {
      if (swarFile && swarFile.buffer) {
        this.swarList.push(new Audio.SWAR(swarFile.buffer));
      }
    }

    console.log(this.sbnkList);
    console.log(this.swarList);
  }

  public hasProgram(program: number): boolean {
    if (!this.sdat || this.sbnkList.length === 0) return false;
    // Check main SBNK (bank 0) or matching bank index
    const mainBank = this.sbnkList[0];
    return (
      program >= 0 &&
      program < mainBank.instruments.length &&
      mainBank.instruments[program] !== undefined
    );
  }

  public getVoice(
    program: number,
    noteNumber: number,
    _velocity: number,
  ): VoiceData {
    if (!this.sdat || this.sbnkList.length === 0) {
      throw new Error("sdat is empty");
    }

    const mainBank = this.sbnkList[0];
    const inst = mainBank.instruments[program];
    if (!inst) {
      throw new Error(`inst for program ${program} not found`);
    }

    // Handle DirectInstrument
    if (
      inst.type === Audio.InstrumentType.PCM ||
      inst.type === Audio.InstrumentType.DirectPCM
    ) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      return this.buildSampleVoice(direct.noteInfo);
    }

    // Handle DrumSetInstrument
    else if (inst.type === Audio.InstrumentType.DrumSet) {
      const drumSet = inst as InstanceType<typeof Audio.DrumSetInstrument>;
      if (noteNumber >= drumSet.lowerKey && noteNumber <= drumSet.upperKey) {
        const item = drumSet.instruments[noteNumber - drumSet.lowerKey];
        if (item) {
          return this.buildSampleVoice(item.noteInfo);
        } else {
          throw new Error(`instrument not found for note number ${noteNumber}`);
        }
      } else {
        throw new Error(`unsupported note number ${noteNumber}`);
      }
    }

    // Handle KeySplitInstrument
    else if (inst.type === Audio.InstrumentType.KeySplit) {
      const keySplit = inst as InstanceType<typeof Audio.KeySplitInstrument>;
      // Find region
      let regionIndex = 0;
      for (let i = 0; i < keySplit.regions.length; i++) {
        if (noteNumber <= keySplit.regions[i]) {
          regionIndex = i;
          break;
        }
      }
      const item = keySplit.instruments[regionIndex];
      if (item) {
        return this.buildSampleVoice(item.noteInfo);
      } else {
        throw new Error(`instrument not found for note number ${noteNumber}`);
      }
    }

    // Handle PSG Instrument
    else if (inst.type === Audio.InstrumentType.PSG) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      const dutyIndex = Math.min(6, direct.noteInfo.waveId % 7);
      const duty = PSG_DUTY_CYCLES[dutyIndex];
      const harmonics = generateSquareWaveHarmonics(duty, 64);
      const voice: PeriodicVoiceData = {
        kind: "periodic",
        duty,
        real: harmonics.real,
        imag: harmonics.imag,
        defaultEnvelope: this.convertNdsEnvelope(direct.noteInfo),
        defaultPan: (direct.noteInfo.pan - 64) / 64,
        attenuation: 0.8,
      };
      return voice;
    }

    // Handle White Noise Instrument
    else if (inst.type === Audio.InstrumentType.WhiteNoise) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      if (!this.noisePcm) {
        this.noisePcm = generateLFSRNoise(44100, 1.0);
      }
      const voice: NoiseVoiceData = {
        kind: "noise",
        noiseType: "lfsr",
        pcm: this.noisePcm,
        sampleRate: 44100,
        defaultEnvelope: this.convertNdsEnvelope(direct.noteInfo),
        defaultPan: (direct.noteInfo.pan - 64) / 64,
        attenuation: 0.8,
      };
      return voice;
    } else {
      throw new Error(`unsupported inst type ${inst.type}`);
    }
  }

  private buildSampleVoice(
    noteInfo: InstanceType<typeof Audio.NoteInfo>,
  ): SampleVoiceData {
    const swarIndex = noteInfo.waveArchiveId;
    const waveIndex = noteInfo.waveId;

    const swar = this.swarList[swarIndex] || this.swarList[0];
    if (!swar) {
      throw new Error("!swar");
    }

    const swav = swar.waves[waveIndex];
    if (!swav) {
      throw new Error("!swav");
    }

    const cacheKey = `${swarIndex}:${waveIndex}`;
    let pcm = this.pcmCache.get(cacheKey);
    if (!pcm) {
      pcm = swav.toPCM();
      this.pcmCache.set(cacheKey, pcm);
    }

    const dataBlock = swav.dataBlock;
    const hasLoop = dataBlock.loop;
    const loopStart = dataBlock.loopStart || 0;
    const loopLength = dataBlock.loopLength || pcm.length;

    return {
      kind: "sample",
      pcm,
      sampleRate: dataBlock.sampleRate || 32728,
      rootKey: noteInfo.baseNote,
      fineTune: 0,
      loop: hasLoop,
      loopStart,
      loopEnd: Math.min(pcm.length, loopStart + loopLength),
      defaultEnvelope: this.convertNdsEnvelope(noteInfo),
      defaultPan: (noteInfo.pan - 64) / 64,
      attenuation: 1.0,
    };
  }

  public dispose(): void {
    this.sdat = null;
    this.sbnkList = [];
    this.swarList = [];
    this.pcmCache.clear();
  }

  private convertNdsEnvelope(
    noteInfo: InstanceType<typeof Audio.NoteInfo>,
  ): ADSRParams {
    return {
      attackTime: NDSInstrumentBank.getAttackSeconds(noteInfo.attack),
      sustainLevel: NDSInstrumentBank.convertVolume2(
        NDSInstrumentBank.convertSustain(noteInfo.sustain),
      ),
      decayRate: NDSInstrumentBank.getFallRate(noteInfo.decay),
      releaseRate: NDSInstrumentBank.getFallRate(noteInfo.release),
    };
  }

  private static readonly TICK_INTERVAL_MS = (64 * 2728 * 1000) / 33513982;
  static readonly MIN_GAIN = -92544; // 完全消音レベル (0.0 に対応)

  private static readonly ATTACKRATE_TABLE = [
    255, 254, 253, 252, 251, 250, 249, 248, 247, 246, 245, 244, 243, 242, 241,
    240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226,
    225, 224, 223, 222, 221, 220, 219, 218, 217, 216, 215, 214, 213, 212, 211,
    210, 209, 208, 207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196,
    195, 194, 193, 192, 191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181,
    180, 179, 178, 177, 176, 175, 174, 173, 172, 171, 170, 169, 168, 167, 166,
    165, 164, 163, 162, 161, 160, 159, 158, 157, 156, 155, 154, 153, 152, 151,
    150, 149, 148, 147, 143, 137, 132, 127, 123, 116, 109, 100, 92, 84, 73, 63,
    51, 38, 26, 14, 5, 1, 0,
  ];

  public static convertAttack(attackRate: number): number {
    return NDSInstrumentBank.ATTACKRATE_TABLE[Math.min(127, attackRate)];
  }

  private static readonly FALLRATE_TABLE = [
    1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39,
    41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77,
    79, 81, 83, 85, 87, 89, 91, 93, 95, 97, 99, 101, 102, 104, 105, 107, 108,
    110, 111, 113, 115, 116, 118, 120, 122, 124, 126, 128, 130, 132, 135, 137,
    140, 142, 145, 148, 151, 154, 157, 160, 163, 167, 171, 175, 179, 183, 187,
    192, 197, 202, 208, 213, 219, 226, 233, 240, 248, 256, 265, 274, 284, 295,
    307, 320, 334, 349, 366, 384, 404, 427, 452, 480, 512, 549, 591, 640, 698,
    768, 853, 960, 1097, 1280, 1536, 1920, 2560, 3840, 7680, 15360, 65535,
  ];

  public static convertFall(fallRate: number): number {
    return NDSInstrumentBank.FALLRATE_TABLE[Math.min(127, fallRate)];
  }

  private static readonly SUSTAIN_TABLE = [
    -92544, -92416, -92288, -83328, -76928, -71936, -67840, -64384, -61440,
    -58880, -56576, -54400, -52480, -50688, -49024, -47488, -46080, -44672,
    -43392, -42240, -41088, -40064, -39040, -38016, -36992, -36096, -35328,
    -34432, -33664, -32896, -32128, -31360, -30592, -29952, -29312, -28672,
    -28032, -27392, -26880, -26240, -25728, -25088, -24576, -24064, -23552,
    -23040, -22528, -22144, -21632, -21120, -20736, -20224, -19840, -19456,
    -19072, -18560, -18176, -17792, -17408, -17024, -16640, -16256, -16000,
    -15616, -15232, -14848, -14592, -14208, -13952, -13568, -13184, -12928,
    -12672, -12288, -12032, -11648, -11392, -11136, -10880, -10496, -10240,
    -9984, -9728, -9472, -9216, -8960, -8704, -8448, -8192, -7936, -7680, -7424,
    -7168, -6912, -6656, -6400, -6272, -6016, -5760, -5504, -5376, -5120, -4864,
    -4608, -4480, -4224, -3968, -3840, -3584, -3456, -3200, -2944, -2816, -2560,
    -2432, -2176, -2048, -1792, -1664, -1408, -1280, -1024, -896, -768, -512,
    -384, -128, 0,
  ];

  public static convertSustain(sustain: number): number {
    return NDSInstrumentBank.SUSTAIN_TABLE[Math.min(127, sustain)];
  }

  /**
   * Attack (秒数) に変換
   * Attackフェーズは毎tick: gain = Math.round(attackRate * gain / 255)
   * 初期値 MIN_GAIN (-92544) から 0 に達するまでの所要時間を計算します。
   *
   * @param attackRate raw attack value (0..127)
   * @returns 秒数 (0秒以上)
   */
  public static getAttackSeconds(attackRate: number): number {
    const rate = NDSInstrumentBank.convertAttack(attackRate);

    let ticks = 0;
    let gain = NDSInstrumentBank.MIN_GAIN;

    // 元コードのように round(rate*gain/255) では、gain=-1で止まってしまう。
    // 256で割ってceilに変更するとリンク先の資料の数値とぴったり合う
    while (gain < 0) {
      gain = Math.ceil((rate * gain) / 256);
      ticks++;
    }

    return (ticks * NDSInstrumentBank.TICK_INTERVAL_MS) / 1000;
  }

  static getFallRate(raw: number){
    const fallRate = NDSInstrumentBank.convertFall(raw);
    // 毎tick `fallRate` ずつ減衰する
    return NDSInstrumentBank.convertVolume2(fallRate / (NDSInstrumentBank.TICK_INTERVAL_MS / 1000));
  }

  /*
  private static _volumeTable = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9,
    9, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12,
    12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 14, 14, 14, 14, 14, 14, 15,
    15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18,
    19, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23,
    23, 23, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 27, 27, 27, 28, 28, 28, 29,
    29, 29, 30, 30, 30, 31, 31, 31, 32, 32, 33, 33, 33, 34, 34, 35, 35, 35, 36,
    36, 37, 37, 38, 38, 38, 39, 39, 40, 40, 41, 41, 42, 42, 43, 43, 44, 44, 45,
    45, 46, 46, 47, 47, 48, 48, 49, 50, 50, 51, 51, 52, 52, 53, 54, 54, 55, 56,
    56, 57, 58, 58, 59, 60, 60, 61, 62, 62, 63, 64, 65, 66, 66, 67, 68, 69, 70,
    70, 71, 72, 73, 74, 75, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
    88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 101, 102, 103, 104, 105,
    106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 119, 121, 122, 124, 125,
    126, 127,
  ];
  static GetChannelVolume(vol: number) {
    let a = Math.floor(vol / 0x80);
    if (a < -723) {
      a = -723;
    } else if (a > 0) {
      a = 0;
    }
    return this._volumeTable[a + 723];
  }
  public static convertVolume(volume: number): number {
    return NDSInstrumentBank.GetChannelVolume(volume) / 127;
  }
  */

  /**
   * 上記の変換テーブルとほぼ同じ値になるよう調整した数式
   * (かなり綺麗になった)
   */
  static convertVolume2(volume: number): number {
    return Math.pow(10, volume / 0x80 / 200);
  }
}
