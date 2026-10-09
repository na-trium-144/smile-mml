/**
 * Modulation Helper
 * Sets up LFO oscillators for Tremolo (@MA), Vibrato (@MP), and AutoPan (@ML)
 */

import type { ModulationParams } from '../../parser/types.js';
import { resolveModulationConfig } from '../utils/conversion.js';

export class ModulationHelper {
  /**
   * Connect LFO nodes if modulation is active
   */
  public static attachModulation(
    ctx: AudioContext,
    sourceNode: AudioScheduledSourceNode,
    gainParam: AudioParam,
    panParam: AudioParam,
    mod: ModulationParams,
    startTime: number,
    stopTime: number
  ): OscillatorNode | null {
    const config = resolveModulationConfig(mod);
    if (!config) return null;

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(config.frequencyHz, startTime);

    const lfoGain = ctx.createGain();
    const lfoActiveTime = startTime + config.delaySeconds;

    // Initially silent during delay
    lfoGain.gain.setValueAtTime(0, startTime);
    if (config.delaySeconds > 0) {
      lfoGain.gain.setValueAtTime(0, lfoActiveTime);
    }

    if (config.type === 'tremolo') {
      // Modulates gain downwards
      lfoGain.gain.linearRampToValueAtTime(config.depth, lfoActiveTime + 0.05);
      lfo.connect(lfoGain);
      lfoGain.connect(gainParam);
    } else if (config.type === 'autoPan') {
      // Modulates stereo pan (-1.0 to +1.0)
      lfoGain.gain.linearRampToValueAtTime(config.depth, lfoActiveTime + 0.05);
      lfo.connect(lfoGain);
      lfoGain.connect(panParam);
    } else if (config.type === 'vibrato') {
      // Modulates pitch (semitones)
      if (sourceNode instanceof OscillatorNode) {
        // Oscillator frequency in Hz: depth is in semitones
        // Delta Hz approx = f * (2^(depth/12) - 1)
        const currentFreq = sourceNode.frequency.value;
        const deltaHz = currentFreq * (Math.pow(2, config.depth / 12) - 1);
        lfoGain.gain.linearRampToValueAtTime(deltaHz, lfoActiveTime + 0.05);
        lfo.connect(lfoGain);
        lfoGain.connect(sourceNode.frequency);
      } else if (sourceNode instanceof AudioBufferSourceNode) {
        // PlaybackRate: depth in semitones -> delta rate = (2^(depth/12) - 1)
        const deltaRate = Math.pow(2, config.depth / 12) - 1;
        lfoGain.gain.linearRampToValueAtTime(deltaRate, lfoActiveTime + 0.05);
        lfo.connect(lfoGain);
        lfoGain.connect(sourceNode.playbackRate);
      }
    }

    lfo.start(startTime);
    lfo.stop(stopTime);

    return lfo;
  }
}
