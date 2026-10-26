/**
 * User Defined Waveform Instrument Bank
 * Supports WAVSET in SmileBASIC and {WAV定義番号=A,D,S,R,波形文字列[,基準音程]} in MML.
 */

import type { InstrumentBank } from "./InstrumentBank.js";
import type { SampleVoiceData, VoiceData } from "../types.js";
import { convertSmileBASICEnvelope } from "../utils/conversion.js";

export interface UserWaveDefinition {
  program: number;
  a: number;
  d: number;
  s: number;
  r: number;
  waveform: string;
  basePitch: number; // default 69
}

/**
 * 2文字で1サンプルを表す16進数文字列を Float32Array PCM に変換する
 * 80 -> 0, 00 -> -1, FF -> +1
 */
export function parseWaveformString(hex: string): Float32Array {
  // Support "FF00"*8 repetition pattern
  const mulMatch = hex.match(/^["']?([0-9a-fA-F]+)["']?\s*\*\s*(\d+)$/);
  let cleanHex = hex;
  if (mulMatch) {
    cleanHex = mulMatch[1].repeat(parseInt(mulMatch[2], 10));
  } else {
    cleanHex = hex.replace(/[^0-9a-fA-F]/g, "");
  }

  const numSamples = Math.floor(cleanHex.length / 2);
  const pcm = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const byte = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    // 80 (128) -> 0.0, 00 (0) -> -1.0, FF (255) -> +1.0
    pcm[i] = byte >= 128 ? (byte - 128) / 127 : (byte - 128) / 128;
  }
  return pcm;
}

/**
 * UserWaveDefinition から SampleVoiceData を作成する
 */
export function createVoiceData(def: UserWaveDefinition): SampleVoiceData {
  const pcm = parseWaveformString(def.waveform);

  // 波形文字列が1周期の波で基準音程が33のときに再生される音が鳴らした音程と一致するようなサンプルレートで再生する。
  // midiNoteToFrequency(33) = 55 Hz.
  // 1周期が pcm.length サンプルの場合、55 Hz で1周期再生するための sampleRate = 55 * pcm.length
  const sampleRate = Math.max(1, 55 * pcm.length);

  return {
    kind: "sample",
    pcm,
    sampleRate,
    rootKey: def.basePitch ?? 69,
    fineTune: 0,
    loop: true,
    loopStart: 0,
    loopEnd: pcm.length,
    defaultEnvelope: convertSmileBASICEnvelope({
      a: def.a,
      d: def.d,
      s: def.s,
      r: def.r,
    }),
    defaultPan: 0,
    attenuation: 0.5,
  };
}

/**
 * SmileBASIC コード内の WAVSET 文を抽出する
 * WAVSET 定義番号,A,D,S,R,"波形文字列"[,基準音程]
 */
export function parseWavsetStatements(code: string): UserWaveDefinition[] {
  const defs: UserWaveDefinition[] = [];
  const wavsetRegex = /\bWAVSET\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:"([^"]*)"|'([^']*)'|([^\s,;:]+))(?:\s*,\s*(\d+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = wavsetRegex.exec(code)) !== null) {
    const program = parseInt(match[1], 10);
    const a = parseInt(match[2], 10) || 0;
    const d = parseInt(match[3], 10) || 0;
    const s = parseInt(match[4], 10) || 0;
    const r = parseInt(match[5], 10) || 0;
    const waveform = match[6] ?? match[7] ?? match[8] ?? "";
    const basePitch = match[9] !== undefined ? parseInt(match[9], 10) : 69;

    defs.push({
      program,
      a,
      d,
      s,
      r,
      waveform,
      basePitch: isNaN(basePitch) ? 69 : basePitch,
    });
  }
  return defs;
}

/**
 * MML 内の {WAV定義番号=A,D,S,R,波形文字列[,基準音程]} マクロ定義を抽出する
 */
export function parseMmlWavMacros(mml: string): UserWaveDefinition[] {
  const defs: UserWaveDefinition[] = [];
  const mmlMacroRegex = /\{WAV(\d+)\s*=\s*([^}]+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = mmlMacroRegex.exec(mml)) !== null) {
    const program = parseInt(match[1], 10);
    const parts = match[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    if (parts.length >= 5) {
      const a = parseInt(parts[0], 10) || 0;
      const d = parseInt(parts[1], 10) || 0;
      const s = parseInt(parts[2], 10) || 0;
      const r = parseInt(parts[3], 10) || 0;
      const waveform = parts[4];
      const basePitch = parts[5] !== undefined && parts[5] !== "" ? parseInt(parts[5], 10) : 69;

      defs.push({
        program,
        a,
        d,
        s,
        r,
        waveform,
        basePitch: isNaN(basePitch) ? 69 : basePitch,
      });
    }
  }
  return defs;
}

export class UserWaveBank implements InstrumentBank {
  readonly type = "userWave" as const;
  private voices = new Map<number, SampleVoiceData>();

  public clear(): void {
    this.voices.clear();
  }

  public registerWave(def: UserWaveDefinition): void {
    const voice = createVoiceData(def);
    this.voices.set(def.program, voice);
  }

  public loadWavset(code: string): void {
    const defs = parseWavsetStatements(code);
    for (const def of defs) {
      this.registerWave(def);
    }
  }

  public loadMmlMacros(mml: string): void {
    const defs = parseMmlWavMacros(mml);
    for (const def of defs) {
      this.registerWave(def);
    }
  }

  public hasVoice(program: number): boolean {
    return this.voices.has(program);
  }

  public getVoice(
    program: number,
    _noteNumber: number,
    _velocity: number,
  ): VoiceData | null {
    return this.voices.get(program) ?? null;
  }
}

export const globalUserWaveBank = new UserWaveBank();
