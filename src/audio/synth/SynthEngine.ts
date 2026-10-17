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
  envelopeGainNode: GainNode;
  velocityGainNode: GainNode;
  panNode: StereoPannerNode;
  lfo?: OscillatorNode;
  stopTime: number;
}

interface ChannelStrip {
  volumeGain: GainNode;
}

export class SynthEngine {
  public readonly ctx: AudioContext;
  public readonly masterGain: GainNode;
  public readonly registry: InstrumentRegistry;

  // Track active voices for volume changes and immediate stops
  private activeVoices: Set<ActiveVoiceRecord> = new Set();

  // Channel strips for per-channel volume control (@V)
  private channelStrips: Map<number, ChannelStrip> = new Map();

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
   * Get or create ChannelStrip for per-channel volume control (@V)
   */
  public getOrCreateChannelStrip(channel: number): ChannelStrip {
    let strip = this.channelStrips.get(channel);
    if (!strip) {
      const volumeGain = this.ctx.createGain();
      volumeGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      volumeGain.connect(this.masterGain);
      strip = { volumeGain };
      this.channelStrips.set(channel, strip);
    }
    return strip;
  }

  /**
   * Set channel volume (@V) in real time
   */
  public setChannelVolume(channel: number, volume: number, time?: number): void {
    const strip = this.getOrCreateChannelStrip(channel);
    const targetGain = Math.max(0, Math.min(1.0, volume / 127));
    const targetTime = time ?? this.ctx.currentTime;
    strip.volumeGain.gain.setValueAtTime(targetGain, targetTime);
  }

  /**
   * Reset all channel volumes to default (1.0)
   */
  public resetChannelVolumes(): void {
    const now = this.ctx.currentTime;
    for (const strip of this.channelStrips.values()) {
      strip.volumeGain.gain.cancelScheduledValues(now);
      strip.volumeGain.gain.setValueAtTime(1.0, now);
    }
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

    // 2. Base Gain, Velocity Gain, Pan & Channel Strip
    const effectiveAtten = voiceData.attenuation ?? 1.0;
    const basePan = voiceData.defaultPan ?? 0;

    const envelopeGain = this.ctx.createGain();
    const velocityGain = this.ctx.createGain();
    const panNode = this.ctx.createStereoPanner();

    const channelStrip = this.getOrCreateChannelStrip(note.channel);

    // Initial velocity gain and pan from initial note properties
    velocityGain.gain.setValueAtTime((note.velocity / 127) * effectiveAtten, startTime);
    const initialRequestedPan = (note.pan - 64) / 64;
    panNode.pan.setValueAtTime(
      Math.max(-1.0, Math.min(1.0, basePan + initialRequestedPan)),
      startTime
    );

    // Connect node chain:
    // Source -> (Filter) -> EnvelopeGain -> VelocityGain -> PanNode -> ChannelVolumeGain -> MasterGain
    envelopeGain.connect(velocityGain).connect(panNode).connect(channelStrip.volumeGain);

    // 3. Create sound source node based on VoiceData kind
    let sourceNode: AudioScheduledSourceNode;

    const segments = note.segments.length > 0 ? note.segments : [{
      tickOffset: 0,
      durationTicks: note.duration,
      startTimeOffsetSec: 0,
      durationSec,
      noteNumber: note.noteNumber,
      detuneCents: note.detuneCents,
      velocity: note.velocity,
      volume: note.volume,
      pan: note.pan,
      isPortamento: false,
    }];

    if (voiceData.kind === 'sample') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.getOrCreateAudioBuffer(voiceData.pcm, voiceData.sampleRate);

      const getPlaybackRate = (noteNum: number, detuneCents: number) => {
        const semitones = noteNum - voiceData.rootKey + (voiceData.fineTune + detuneCents) / 100;
        return Math.pow(2, semitones / 12);
      };

      // Schedule segments for sample voice
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStartTime = startTime + (seg.startTimeOffsetSec ?? 0);
        const segDuration = seg.durationSec ?? (i === segments.length - 1 ? durationSec - (seg.startTimeOffsetSec ?? 0) : 0);
        const segEndTime = segStartTime + segDuration;

        // Set pitch
        const startRate = getPlaybackRate(seg.noteNumber, seg.detuneCents);
        src.playbackRate.setValueAtTime(startRate, segStartTime);

        if (seg.isPortamento && seg.portamentoTargetNote !== undefined) {
          const targetDetune = seg.portamentoTargetDetuneCents ?? seg.detuneCents;
          const targetRate = getPlaybackRate(seg.portamentoTargetNote, targetDetune);
          src.playbackRate.linearRampToValueAtTime(targetRate, segEndTime);
        }

        // Schedule mid-compound parameter changes (V, P)
        if (i > 0) {
          velocityGain.gain.setValueAtTime((seg.velocity / 127) * effectiveAtten, segStartTime);
          const reqPan = (seg.pan - 64) / 64;
          panNode.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, basePan + reqPan)), segStartTime);
        }
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
        src.connect(biquad).connect(envelopeGain);
      } else {
        src.connect(envelopeGain);
      }

      sourceNode = src;
    } else if (voiceData.kind === 'periodic') {
      const osc = this.ctx.createOscillator();
      const wave = this.getOrCreatePeriodicWave(voiceData.duty, voiceData.real, voiceData.imag);
      osc.setPeriodicWave(wave);

      // Schedule segments for periodic oscillator voice
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segStartTime = startTime + (seg.startTimeOffsetSec ?? 0);
        const segDuration = seg.durationSec ?? (i === segments.length - 1 ? durationSec - (seg.startTimeOffsetSec ?? 0) : 0);
        const segEndTime = segStartTime + segDuration;

        // Set pitch
        const startFreq = midiNoteToFrequency(seg.noteNumber, seg.detuneCents);
        osc.frequency.setValueAtTime(startFreq, segStartTime);

        if (seg.isPortamento && seg.portamentoTargetNote !== undefined) {
          const targetDetune = seg.portamentoTargetDetuneCents ?? seg.detuneCents;
          const targetFreq = midiNoteToFrequency(seg.portamentoTargetNote, targetDetune);
          osc.frequency.linearRampToValueAtTime(targetFreq, segEndTime);
        }

        // Schedule mid-compound parameter changes (V, P)
        if (i > 0) {
          velocityGain.gain.setValueAtTime((seg.velocity / 127) * effectiveAtten, segStartTime);
          const reqPan = (seg.pan - 64) / 64;
          panNode.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, basePan + reqPan)), segStartTime);
        }
      }

      osc.connect(envelopeGain);
      sourceNode = osc;
    } else {
      // Noise
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.getOrCreateAudioBuffer(voiceData.pcm, voiceData.sampleRate);
      noiseSrc.loop = true;

      // Schedule mid-compound parameter changes (V, P)
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const segStartTime = startTime + (seg.startTimeOffsetSec ?? 0);
        velocityGain.gain.setValueAtTime((seg.velocity / 127) * effectiveAtten, segStartTime);
        const reqPan = (seg.pan - 64) / 64;
        panNode.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, basePan + reqPan)), segStartTime);
      }

      noiseSrc.connect(envelopeGain);
      sourceNode = noiseSrc;
    }

    // 4. Schedule ADSR envelope on normalized EnvelopeGain (peak = 1.0)
    const releaseTime = EnvelopeHelper.scheduleADSR(
      envelopeGain.gain,
      envelope,
      1.0,
      startTime,
      gateDurationSec,
      false
    );

    // 5. Total stop time calculation
    const totalDuration = gateDurationSec + releaseTime + 0.05;
    const stopTime = startTime + totalDuration;

    // 6. Modulation LFO
    // TODO: SmileBASIC handles mid-note modulation changes with complex behavior. Currently fixed to the first note's modulation.
    let lfoNode: OscillatorNode | undefined;
    if (note.modulation.enabled) {
      const attached = ModulationHelper.attachModulation(
        this.ctx,
        sourceNode,
        velocityGain.gain,
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
      envelopeGainNode: envelopeGain,
      velocityGainNode: velocityGain,
      panNode,
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
        voice.envelopeGainNode.gain.cancelScheduledValues(now);
        voice.envelopeGainNode.gain.setValueAtTime(0, now);
        voice.velocityGainNode.gain.cancelScheduledValues(now);
        voice.velocityGainNode.gain.setValueAtTime(0, now);
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
