/**
 * Envelope Helper
 * Schedules ADSR curves onto WebAudio GainNode with sample-accurate automation.
 */

import type { ADSRParams } from "../types.js";

export class EnvelopeHelper {
  /**
   * Schedule complete ADSR automation on a GainNode.
   *
   * @param gainParam The AudioParam representing gain
   * @param envelope ADSR parameters in physical units
   * @param peakGain Velocity & volume scaled peak gain level
   * @param startTime Start time in AudioContext seconds
   * @param gateDuration Duration before release begins (gate time in seconds)
   * @param isSlur If true, skip attack phase and maintain current level
   */
  public static scheduleADSR(
    gainParam: AudioParam,
    envelope: ADSRParams,
    peakGain: number,
    startTime: number,
    gateDuration: number,
    isSlur: boolean = false,
  ): void {
    const attack = Math.max(0.001, envelope.attackTime);
    const decay = Math.max(0.001, envelope.decayTime);
    const sustainLevel = Math.max(0.0, Math.min(1.0, envelope.sustainLevel));
    const release = Math.max(0.005, envelope.releaseTime);

    const sustainGain = peakGain * sustainLevel;
    // Note off / release phase
    const releaseStartTime = startTime + gateDuration;

    // Initial value
    if (isSlur) {
      // Slur: maintain existing gain level without re-triggering attack
      gainParam.setValueAtTime(sustainGain, startTime);

      // Anchor current value at release point
      gainParam.setValueAtTime(sustainGain, releaseStartTime);
      // Release down to silence
      gainParam.linearRampToValueAtTime(0.00001, releaseStartTime + release);
    } else {
      gainParam.setValueAtTime(0, startTime);
      // Attack phase
      if (attack < gateDuration) {
        gainParam.linearRampToValueAtTime(peakGain, startTime + attack);

        // Decay phase to sustain level
        if (attack + decay < gateDuration) {
          gainParam.linearRampToValueAtTime(
            sustainGain,
            startTime + attack + decay,
          );

          // Anchor current value at release point
          gainParam.setValueAtTime(sustainGain, releaseStartTime);
        } else {
          gainParam.linearRampToValueAtTime(
            peakGain *
              (1 - ((1 - sustainLevel) * (gateDuration - attack)) / decay),
            releaseStartTime,
          );
        }
        // Release down to silence
        gainParam.linearRampToValueAtTime(0.00001, releaseStartTime + release);
      } else {
        gainParam.linearRampToValueAtTime(
          (peakGain * gateDuration) / attack,
          releaseStartTime,
        );

        // Release down to silence
        gainParam.linearRampToValueAtTime(0.00001, releaseStartTime + release);
      }
    }
  }
}
