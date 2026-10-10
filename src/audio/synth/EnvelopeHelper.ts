/**
 * Envelope Helper
 * Schedules ADSR curves onto WebAudio GainNode with sample-accurate automation.
 */

import { NDSInstrumentBank } from "../banks/NDSInstrumentBank.js";
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
   *
   * @return release time in seconds
   */
  public static scheduleADSR(
    gainParam: AudioParam,
    envelope: ADSRParams,
    peakGain: number,
    startTime: number,
    gateDuration: number,
    isSlur: boolean = false,
  ): number {
    const minLevel = NDSInstrumentBank.convertVolume2(
      NDSInstrumentBank.MIN_GAIN,
    );
    peakGain = Math.max(0.001, peakGain);

    const attack = Math.max(0.001, envelope.attackTime);
    const sustainLevel = Math.max(
      minLevel,
      Math.min(1.0, envelope.sustainLevel),
    );
    const decay = Math.max(
      0.001,
      (1 - Math.log(sustainLevel)) / Math.log(envelope.decayRate),
    );
    let release = Math.max(
      0.001,
      Math.log(sustainLevel) -
        Math.log(minLevel) / Math.log(envelope.releaseRate),
    );

    // Initial value
    if (isSlur) {
      // Slur: maintain existing gain level without re-triggering attack
      gainParam.setValueAtTime(peakGain * sustainLevel, startTime);

      // Anchor current value at release point
      gainParam.setValueAtTime(
        peakGain * sustainLevel,
        startTime + gateDuration,
      );
      // Release down to silence
      gainParam.linearRampToValueAtTime(
        peakGain * minLevel,
        startTime + gateDuration + release,
      );
    } else {
      gainParam.setValueAtTime(0, startTime);
      // Attack phase
      if (attack < gateDuration) {
        gainParam.linearRampToValueAtTime(peakGain, startTime + attack);

        // Decay phase to sustain level
        if (attack + decay < gateDuration) {
          gainParam.exponentialRampToValueAtTime(
            peakGain * sustainLevel,
            startTime + attack + decay,
          );

          // Anchor current value at release point
          gainParam.setValueAtTime(
            peakGain * sustainLevel,
            startTime + gateDuration,
          );
        } else {
          const truncatedSustainLevel = Math.pow(
            sustainLevel,
            (gateDuration - attack) / decay,
          );
          release = Math.max(
            0.001,
            (Math.log(truncatedSustainLevel) -
                           Math.log(minLevel)) / Math.log(envelope.releaseRate),
          );
          gainParam.exponentialRampToValueAtTime(
            peakGain * truncatedSustainLevel,
            startTime + gateDuration,
          );
        }
        // Release down to silence
        gainParam.exponentialRampToValueAtTime(
          peakGain * minLevel,
          startTime + gateDuration + release,
        );
      } else {
        const truncatedAttackLevel = gateDuration / attack;
        release = Math.max(
          0.001,
          (Math.log(truncatedAttackLevel) -
                       Math.log(minLevel)) / Math.log(envelope.releaseRate),
        );

        gainParam.linearRampToValueAtTime(
          peakGain * truncatedAttackLevel,
          startTime + gateDuration,
        );

        // Release down to silence
        gainParam.exponentialRampToValueAtTime(
          peakGain * minLevel,
          startTime + gateDuration + release,
        );
      }
    }

    return release;
  }
}
