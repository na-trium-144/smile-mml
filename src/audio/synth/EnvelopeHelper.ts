/**
 * Envelope Helper
 * Schedules ADSR curves onto WebAudio GainNode with sample-accurate automation.
 */

import { NDSInstrumentBank } from "../banks/NDSInstrumentBank.js";
import type { ADSRParams } from "../types.js";

interface ADSRPoint {
  /** 開始時間からの相対時間（秒） */
  time: number;
  /** ゲインレベル */
  level: number;
  /** 変化の種類 */
  type: "set" | "linear" | "exponential";
}

export class EnvelopeHelper {
  attackTime: number;
  sustainLevel: number;
  decayTime: number;
  releaseTime: number;

  points: ADSRPoint[];

  constructor(envelope: ADSRParams, gateDuration: number) {
    const minLevel = NDSInstrumentBank.convertVolume2(
      NDSInstrumentBank.MIN_GAIN,
    );

    this.attackTime = Math.max(0.001, envelope.attackTime);
    this.sustainLevel = Math.max(
      minLevel,
      Math.min(1.0, envelope.sustainLevel),
    );
    this.decayTime = Math.max(
      0.001,
      (1 - Math.log(this.sustainLevel)) / Math.log(envelope.decayRate),
    );
    this.releaseTime = Math.max(
      0.001,
      Math.log(this.sustainLevel) -
        Math.log(minLevel) / Math.log(envelope.releaseRate),
    );

    this.points = [];

    // Initial value
    this.points.push({ type: "set", level: 0, time: 0 });

    // Attack phase
    if (this.attackTime < gateDuration) {
      this.points.push({ type: "linear", level: 1, time: this.attackTime });

      // Decay phase to sustain level
      // sustainLevelはminLevel〜1.0を0〜1で表示
      if (this.attackTime + this.decayTime < gateDuration) {
        this.points.push({
          type: "exponential",
          level: this.sustainLevel,
          time: this.attackTime + this.decayTime,
        });

        // Anchor current value at release point
        this.points.push({
          type: "set",
          level: this.sustainLevel,
          time: gateDuration,
        });
      } else {
        const truncatedSustainLevel = Math.pow(
          this.sustainLevel,
          (gateDuration - this.attackTime) / this.decayTime,
        );
        this.releaseTime = Math.max(
          0.001,
          (Math.log(truncatedSustainLevel) - Math.log(minLevel)) /
            Math.log(envelope.releaseRate),
        );
        this.points.push({
          type: "exponential",
          level: truncatedSustainLevel,
          time: gateDuration,
        });
      }
      // Release down to silence
      this.points.push({
        type: "exponential",
        level: minLevel,
        time: gateDuration + this.releaseTime,
      });
    } else {
      const truncatedAttackLevel = gateDuration / this.attackTime;
      this.releaseTime = Math.max(
        0.001,
        (Math.log(truncatedAttackLevel) - Math.log(minLevel)) /
          Math.log(envelope.releaseRate),
      );

      this.points.push({
        type: "linear",
        level: truncatedAttackLevel,
        time: gateDuration,
      });

      // Release down to silence
      this.points.push({
        type: "exponential",
        level: minLevel,
        time: gateDuration + this.releaseTime,
      });
    }
  }

  scheduleADSR(gainParam: AudioParam, startTime: number) {
    for (const pt of this.points) {
      const targetTime = startTime + pt.time;
      switch (pt.type) {
        case "set":
          gainParam.setValueAtTime(pt.level, targetTime);
          break;
        case "linear":
          gainParam.linearRampToValueAtTime(pt.level, targetTime);
          break;
        case "exponential":
          gainParam.exponentialRampToValueAtTime(pt.level, targetTime);
          break;
      }
    }
  }

  drawADSR(
    ctx: CanvasRenderingContext2D,
    pixelPerSecond: number,
    height: number,
  ): void {
    const toX = (t: number) => t * pixelPerSecond;
    const toY = (v: number) => height * Math.min(1, -Math.log10(v));
    ctx.beginPath();

    let prevPt = this.points[0];
    ctx.moveTo(toX(prevPt.time), toY(prevPt.level));

    for (let i = 1; i < this.points.length; i++) {
      const currPt = this.points[i];

      if (
        currPt.type === "exponential" &&
        prevPt.level > 0 &&
        currPt.level > 0
      ) {
        // 指数カーブの場合(decayとrelease)、直線で、短めに表示する
        ctx.lineTo(toX(prevPt.time + (currPt.time - prevPt.time) * 0.5), toY(currPt.level));
      } else {
        // 直線補間または点の設定
        ctx.lineTo(toX(currPt.time), toY(currPt.level));
      }

      prevPt = currPt;
    }

    // 塗りつぶし描画（オプション）
    ctx.lineTo(toX(this.points.at(-1)!.time), toY(0));
    ctx.lineTo(toX(0), toY(0));
    ctx.closePath();
    ctx.fill();
  }
}
