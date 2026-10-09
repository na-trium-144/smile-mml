/**
 * Nintendo DS / Petit Computer (SmileBASIC) ROM Instrument Bank
 * Uses nitro-fs to parse NDS ROMs (.nds) or SDAT files (.sdat),
 * extracting authentic instruments and waveforms.
 */

import { NitroFS, Audio, BufferReader } from 'nitro-fs';
import type { InstrumentBank } from './InstrumentBank.js';
import type { VoiceData, ADSRParams, SampleVoiceData, PeriodicVoiceData, NoiseVoiceData } from '../types.js';
import { generateSquareWaveHarmonics, PSG_DUTY_CYCLES } from '../utils/waveformGenerator.js';
import { generateLFSRNoise } from '../utils/noiseGenerator.js';

export class NDSInstrumentBank implements InstrumentBank {
  public readonly name: string = 'Nintendo DS ROM (SmileBASIC)';

  private sdat: InstanceType<typeof Audio.SDAT> | null = null;
  private sbnkList: InstanceType<typeof Audio.SBNK>[] = [];
  private swarList: InstanceType<typeof Audio.SWAR>[] = [];

  // Decoded PCM cache by "swarId:waveId"
  private pcmCache: Map<string, Float32Array> = new Map();

  // Noise PCM cache
  private noisePcm: Float32Array | null = null;

  /**
   * Load NDS ROM or SDAT binary buffer
   */
  public async load(raw: ArrayBuffer): Promise<void> {
    let sdatRaw: ArrayBuffer | null = null;

    // 1. Try parsing as NDS ROM filesystem
    try {
      const fs = NitroFS.fromRom(raw);
      // Search common paths for sound SDAT
      const candidates = [
        '/sound/sound_data.sdat',
        '/data/sound/sound_data.sdat',
        '/data/sound.sdat',
        '/sound.sdat',
      ];

      for (const path of candidates) {
        if (fs.exists(path)) {
          sdatRaw = fs.readFile(path);
          break;
        }
      }

      // If not in common paths, scan root and subdirectories for .sdat
      /*if (!sdatRaw) {
        const queue = ['/'];
        while (queue.length > 0 && !sdatRaw) {
          const dir = queue.shift()!;
          const entries = fs.readDir(dir);
          for (const entry of entries) {
            const fullPath = dir === '/' ? `/${entry}` : `${dir}/${entry}`;
            if (entry.toLowerCase().endsWith('.sdat')) {
              sdatRaw = fs.readFile(fullPath);
              break;
            } else if (!entry.includes('.')) {
              // Possible directory
              try {
                fs.readDir(fullPath);
                queue.push(fullPath);
              } catch {
                // not a directory
              }
            }
          }
        }
      }*/
    } catch {
      // Not an NDS ROM, will attempt raw SDAT below
    }

    // 2. If not found in ROM, check if the buffer itself is an SDAT file (magic: "SDAT")
    if (!sdatRaw) {
      const rawArray = new Uint8Array(raw);
      if (rawArray.length > 4 && rawArray[0] === 0x53 && rawArray[1] === 0x44 && rawArray[2] === 0x41 && rawArray[3] === 0x54) {
        sdatRaw = raw;
      }
    }

    if (!sdatRaw) {
      throw new Error('No SDAT sound archive found in the provided NDS ROM file.');
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
  }

  public hasProgram(program: number): boolean {
    if (!this.sdat || this.sbnkList.length === 0) return false;
    // Check main SBNK (bank 0) or matching bank index
    const mainBank = this.sbnkList[0];
    return program >= 0 && program < mainBank.instruments.length && mainBank.instruments[program] !== undefined;
  }

  public getVoice(program: number, noteNumber: number, _velocity: number): VoiceData | null {
    if (!this.sdat || this.sbnkList.length === 0) return null;

    const mainBank = this.sbnkList[0];
    const inst = mainBank.instruments[program];
    if (!inst) return null;

    // Handle DirectInstrument
    if (inst.type === Audio.InstrumentType.PCM || inst.type === Audio.InstrumentType.DirectPCM) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      return this.buildSampleVoice(direct.noteInfo);
    }

    // Handle DrumSetInstrument
    if (inst.type === Audio.InstrumentType.DrumSet) {
      const drumSet = inst as InstanceType<typeof Audio.DrumSetInstrument>;
      if (noteNumber >= drumSet.lowerKey && noteNumber <= drumSet.upperKey) {
        const item = drumSet.instruments[noteNumber - drumSet.lowerKey];
        if (item) {
          if (item.type === Audio.InstrumentType.PCM || item.type === Audio.InstrumentType.DirectPCM) {
            return this.buildSampleVoice(item.noteInfo);
          }
        }
      }
      return null;
    }

    // Handle KeySplitInstrument
    if (inst.type === Audio.InstrumentType.KeySplit) {
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
      if (item && (item.type === Audio.InstrumentType.PCM || item.type === Audio.InstrumentType.DirectPCM)) {
        return this.buildSampleVoice(item.noteInfo);
      }
      return null;
    }

    // Handle PSG Instrument
    if (inst.type === Audio.InstrumentType.PSG) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      const dutyIndex = Math.min(6, direct.noteInfo.waveId % 7);
      const duty = PSG_DUTY_CYCLES[dutyIndex];
      const harmonics = generateSquareWaveHarmonics(duty, 64);
      const voice: PeriodicVoiceData = {
        kind: 'periodic',
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
    if (inst.type === Audio.InstrumentType.WhiteNoise) {
      const direct = inst as InstanceType<typeof Audio.DirectInstrument>;
      if (!this.noisePcm) {
        this.noisePcm = generateLFSRNoise(44100, 1.0);
      }
      const voice: NoiseVoiceData = {
        kind: 'noise',
        noiseType: 'lfsr',
        pcm: this.noisePcm,
        sampleRate: 44100,
        defaultEnvelope: this.convertNdsEnvelope(direct.noteInfo),
        defaultPan: (direct.noteInfo.pan - 64) / 64,
        attenuation: 0.8,
      };
      return voice;
    }

    return null;
  }

  private buildSampleVoice(noteInfo: InstanceType<typeof Audio.NoteInfo>): SampleVoiceData | null {
    const swarIndex = noteInfo.waveArchiveId;
    const waveIndex = noteInfo.waveId;

    const swar = this.swarList[swarIndex] || this.swarList[0];
    if (!swar) return null;

    const swav = swar.waves[waveIndex];
    if (!swav) return null;

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
      kind: 'sample',
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

  private convertNdsEnvelope(noteInfo: InstanceType<typeof Audio.NoteInfo>): ADSRParams {
    // NDS hardware rates: 127 is fastest, 0 is slowest
    const a = noteInfo.attack;
    const d = noteInfo.decay;
    const s = noteInfo.sustain;
    const r = noteInfo.release;

    const attackTime = a >= 127 ? 0.001 : Math.max(0.001, (127 - a) * 0.04);
    const decayTime = d >= 127 ? 0.001 : Math.max(0.001, (127 - d) * 0.04);
    const sustainLevel = Math.max(0, Math.min(1, s / 127));
    const releaseTime = r >= 127 ? 0.01 : Math.max(0.01, (127 - r) * 0.04);

    return { attackTime, decayTime, sustainLevel, releaseTime };
  }

  public dispose(): void {
    this.sdat = null;
    this.sbnkList = [];
    this.swarList = [];
    this.pcmCache.clear();
  }
}
