/**
 * WebAudio Synthesizer Engine
 * Coordinates polyphonic voice allocation, WebAudio node graphs,
 * portamento glides, envelopes, and modulations across all sound sources.
 */

import type { InstrumentRegistry } from '../banks/InstrumentRegistry.js';
import type { PreparedNote, ADSRParams } from '../types.js';
import { midiNoteToFrequency, convertSmileBASICEnvelope } from '../utils/conversion.js';
import { EnvelopeHelper } from './EnvelopeHelper.js';
import { ModulationHelper } from './ModulationHelper.js';

interface ActiveVoiceRecord {
  channel: number;
  noteNumber: number;
  source: AudioScheduledSourceNode;
  gainNode: GainNode;
  lfo?: OscillatorNode;
  stopTime: number;
}

export class SynthEngine {
  public readonly ctx: AudioContext;
  public readonly masterGain: GainNode;
  public readonly registry: InstrumentRegistry;

  // Track active voices for volume changes and immediate stops
  private activeVoices: Set<ActiveVoiceRecord> = new Set();

  // AudioBuffer cache for sample voice data
  private audioBufferCache: WeakMap<Float32Array, AudioBuffer> = new WeakMap();

  // PeriodicWave cache
  private periodicWaveCache: Map<string, PeriodicWave> = new Map();

  constructor(registry: InstrumentRegistry, ctx?: AudioContext) {
    this.ctx = ctx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
    this.registry = registry;
  }

  /**
   * Resume audio context if suspended by browser autoplay policy
   */
  public async ensureContextRunning(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Current AudioContext time in seconds
   */
  public get currentTime(): number {
    return this.ctx.currentTime;
  }

  /**
   * Set master output volume (0.0 - 1.0)
   */
  public setMasterVolume(val: number): void {
    const clamped = Math.max(0, Math.min(1.0, val));
    this.masterGain.gain.setValueAtTime(clamped, this.ctx.currentTime);
  }

  /**
   * Play a prepared note event at the scheduled time
   */
  public playNote(
    note: PreparedNote,
    startTime: number,
    durationSec: number,
    gateDurationSec: number
  ): void {
    const voiceData = this.registry.getVoice(note.program, note.noteNumber, note.velocity);
    if (!voiceData) return;

    // 1. Resolve envelope (SmileBASIC @E override or bank default)
    const envelope: ADSRParams = note.envelope.enabled
      ? convertSmileBASICEnvelope(note.envelope)
      : voiceData.defaultEnvelope;

    // 2. Base Gain & Pan
    const effectiveAtten = voiceData.attenuation ?? 1.0;
    // Effective velocity & channel volume
    const peakGain = (note.velocity / 127) * (note.volume / 127) * effectiveAtten;

    const gainNode = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();

    const basePan = voiceData.defaultPan ?? 0;
    const requestedPan = (note.pan - 64) / 64;
    const finalPan = Math.max(-1.0, Math.min(1.0, basePan + requestedPan));
    panNode.pan.setValueAtTime(finalPan, startTime);

    gainNode.connect(panNode).connect(this.masterGain);

    // 3. Create sound source node based on VoiceData kind
    let sourceNode: AudioScheduledSourceNode;

    if (voiceData.kind === 'sample') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.getOrCreateAudioBuffer(voiceData.pcm, voiceData.sampleRate);

      // Pitch calculation
      const semitones = note.noteNumber - voiceData.rootKey + (voiceData.fineTune + note.detuneCents) / 100;
      const initialPlaybackRate = Math.pow(2, semitones / 12);
      src.playbackRate.setValueAtTime(initialPlaybackRate, startTime);

      // Portamento glide for sample
      if (note.isPortamento && note.portamentoTargetNote !== undefined) {
        const targetSemitones = note.portamentoTargetNote - voiceData.rootKey + (voiceData.fineTune + note.detuneCents) / 100;
        const targetPlaybackRate = Math.pow(2, targetSemitones / 12);
        // Linear frequency/playback rate glide across duration
        src.playbackRate.linearRampToValueAtTime(targetPlaybackRate, startTime + durationSec);
      }

      // Looping
      if (voiceData.loop) {
        src.loop = true;
        src.loopStart = voiceData.loopStart / voiceData.sampleRate;
        src.loopEnd = voiceData.loopEnd / voiceData.sampleRate;
      }

      // Optional SF2 filter
      if (voiceData.filter) {
        const biquad = this.ctx.createBiquadFilter();
        biquad.type = 'lowpass';
        biquad.frequency.setValueAtTime(voiceData.filter.cutoffHz, startTime);
        biquad.Q.setValueAtTime(voiceData.filter.resonanceDb, startTime);
        src.connect(biquad).connect(gainNode);
      } else {
        src.connect(gainNode);
      }

      sourceNode = src;
    } else if (voiceData.kind === 'periodic') {
      const osc = this.ctx.createOscillator();
      const wave = this.getOrCreatePeriodicWave(voiceData.duty, voiceData.real, voiceData.imag);
      osc.setPeriodicWave(wave);

      const initialFreq = midiNoteToFrequency(note.noteNumber, note.detuneCents);
      osc.frequency.setValueAtTime(initialFreq, startTime);

      // Portamento glide for periodic wave
      if (note.isPortamento && note.portamentoTargetNote !== undefined) {
        const targetFreq = midiNoteToFrequency(note.portamentoTargetNote, note.detuneCents);
        osc.frequency.linearRampToValueAtTime(targetFreq, startTime + durationSec);
      }

      osc.connect(gainNode);
      sourceNode = osc;
    } else {
      // Noise
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.getOrCreateAudioBuffer(voiceData.pcm, voiceData.sampleRate);
      noiseSrc.loop = true;
      noiseSrc.connect(gainNode);
      sourceNode = noiseSrc;
    }

    // 4. Schedule ADSR envelope
    const releaseTime = EnvelopeHelper.scheduleADSR(
      gainNode.gain,
      envelope,
      peakGain,
      startTime,
      gateDurationSec,
      note.isSlur
    );

    // 5. Total stop time calculation
    const totalDuration = gateDurationSec + releaseTime + 0.05;
    const stopTime = startTime + totalDuration;

    // 6. Modulation LFO
    let lfoNode: OscillatorNode | undefined;
    if (note.modulation.enabled) {
      const attached = ModulationHelper.attachModulation(
        this.ctx,
        sourceNode,
        gainNode.gain,
        panNode.pan,
        note.modulation,
        startTime,
        stopTime
      );
      if (attached) lfoNode = attached;
    }

    // 7. Start & Stop scheduling
    sourceNode.start(startTime);
    sourceNode.stop(stopTime);

    // Keep reference in active voices
    const record: ActiveVoiceRecord = {
      channel: note.channel,
      noteNumber: note.noteNumber,
      source: sourceNode,
      gainNode,
      lfo: lfoNode,
      stopTime,
    };
    this.activeVoices.add(record);

    // Clean up when finished
    sourceNode.onended = () => {
      this.activeVoices.delete(record);
    };
  }

  /**
   * Stop all active voices immediately
   */
  public stopAll(): void {
    const now = this.ctx.currentTime;
    for (const voice of this.activeVoices) {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(0, now);
        voice.source.stop(now);
        voice.lfo?.stop(now);
      } catch {
        // already stopped
      }
    }
    this.activeVoices.clear();
  }

  private getOrCreateAudioBuffer(pcm: Float32Array, sampleRate: number): AudioBuffer {
    let buf = this.audioBufferCache.get(pcm);
    if (!buf) {
      buf = this.ctx.createBuffer(1, pcm.length, sampleRate);
      buf.copyToChannel(new Float32Array(pcm), 0);
      this.audioBufferCache.set(pcm, buf);
    }
    return buf;
  }

  private getOrCreatePeriodicWave(
    duty: number,
    real: Float32Array,
    imag: Float32Array
  ): PeriodicWave {
    const key = `${duty}`;
    let wave = this.periodicWaveCache.get(key);
    if (!wave) {
      wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      this.periodicWaveCache.set(key, wave);
    }
    return wave;
  }
}
