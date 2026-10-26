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

export class UserWaveBank implements InstrumentBank {
  readonly type = "userWave" as const;
  public voices = new Map<number, {def: UserWaveDefinition; voice: SampleVoiceData}>();

  public clear(): void {
    this.voices.clear();
  }

  public registerWave(def: UserWaveDefinition): void {
    // Support "FF00"*8 repetition pattern
    const mulMatch = def.waveform.match(
      /^["']?([0-9a-fA-F]+)["']?\s*\*\s*(\d+)$/,
    );
    let cleanHex: string | undefined = undefined;
    if (mulMatch) {
      cleanHex = mulMatch[1].repeat(parseInt(mulMatch[2], 10));
    } else {
      cleanHex = def.waveform.match(/^[0-9a-fA-F]*$/)?.[0];
    }
    if(cleanHex && cleanHex.length >= 2){
      // 波形文字列が1周期の波で基準音程が33のときに再生される音が鳴らした音程と一致するようなサンプルレートで再生する。
      // midiNoteToFrequency(33) = 55 Hz.
      // 1周期が pcm.length サンプルの場合、55 Hz で1周期再生するための sampleRate = 55 * pcm.length
      // WebAudioで55*16Hzのような低サンプルレートな波形を正しく再生できないので、40000Hz前後でリサンプリング
      const numSamples = Math.floor(cleanHex.length / 2);
      const sampleRate = 55 * numSamples;
      const factor = Math.ceil(48000 / sampleRate);
      const pcm = new Float32Array(numSamples * factor);
      for (let i = 0; i < numSamples; i++) {
        const byte = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
        // 80 (128) -> 0.0, 00 (0) -> -1.0, FF (255) -> +1.0
        pcm.fill((byte - 128) / 128, i * factor, (i+1)*factor);
      }


      this.voices.set(def.program, {
        def,
        voice: {
        kind: "sample",
        pcm,
        sampleRate: sampleRate * factor,
        rootKey: def.basePitch,
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
      }});
    }
  }

  /**
   * SmileBASIC コード内の WAVSET 文、
   * または MML 内の {WAV定義番号=A,D,S,R,波形文字列[,基準音程]} マクロ定義を抽出する
   * WAVSET 定義番号,A,D,S,R,"波形文字列"[,基準音程]
   */
  public loadWavset(code: string): void {
    const wavsetRegex =
      /\bWAVSET\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:"([^"]*)"|'([^']*)'|([^\s,;:]+))(?:\s*,\s*(\d+))?/gi;
    let match: RegExpExecArray | null;
    while ((match = wavsetRegex.exec(code)) !== null) {
      const program = parseInt(match[1], 10);
      const a = parseInt(match[2], 10) || 0;
      const d = parseInt(match[3], 10) || 0;
      const s = parseInt(match[4], 10) || 0;
      const r = parseInt(match[5], 10) || 0;
      const waveform = match[6] ?? match[7] ?? match[8] ?? "";
      const basePitch = match[9] !== undefined ? parseInt(match[9], 10) : 69;

      this.registerWave({
        program,
        a,
        d,
        s,
        r,
        waveform,
        basePitch: isNaN(basePitch) ? 69 : basePitch,
      });
    }

    const mmlMacroRegex = /\{WAV(\d+)\s*=\s*([^}]+)\}/gi;
    while ((match = mmlMacroRegex.exec(code)) !== null) {
      const program = parseInt(match[1], 10);
      const parts = match[2]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
      if (parts.length >= 5) {
        const a = parseInt(parts[0], 10) || 0;
        const d = parseInt(parts[1], 10) || 0;
        const s = parseInt(parts[2], 10) || 0;
        const r = parseInt(parts[3], 10) || 0;
        const waveform = parts[4];
        const basePitch =
          parts[5] !== undefined && parts[5] !== ""
            ? parseInt(parts[5], 10)
            : 69;

        this.registerWave({
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
  }

  public getVoice(
    program: number,
    _noteNumber: number,
    _velocity: number,
  ): VoiceData | null {
    return this.voices.get(program)?.voice ?? null;
  }
}
