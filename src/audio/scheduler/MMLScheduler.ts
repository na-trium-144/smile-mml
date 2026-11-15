/**
 * MML Playback Scheduler
 * High-precision scheduling using WebAudio AudioContext timestamps
 * with lookahead buffer intervals, dynamic real-time parsing (delegated to MMLProcessor),
 * and integrated visualizer preprocessing.
 */

import type { SynthEngine } from "../synth/SynthEngine.js";
import type { PostProcessedEvent, PostProcessedNote, VoiceData } from "../types.js";
import { ModulationHelper } from "../synth/ModulationHelper.js";
import type { TempoMap } from "./TempoMap.js";
import type { InstrumentBank } from "../banks/InstrumentBank.js";
import { MMLProcessor, type MMLProcessorSnapshot } from "./MMLProcessor.js";

export class MMLScheduler {
  private synth: SynthEngine;
  private instrumentBanks: InstrumentBank[];
  private processor: MMLProcessor;
  public onError: (e: unknown) => void;

  static readonly ticksPerWholeNote = 192;

  // Snapshot of the first loop for infinite MML (never modified after initial pass)
  private firstLoopSnapshot: MMLProcessorSnapshot | null = null;
  public firstLoopEndTick: number = 0;
  private hasPruned: boolean = false;
  private lastPrunedTick: number = 0;

  // Prepared playback events (for Synth)
  private nextEventIndex: number = 0;

  // Playback & parse state
  private isPlaying: boolean = false;

  private playbackOffsetSeconds: number = 0;
  private playbackStartAudioTime: number = 0;

  // Lookahead settings
  private readonly lookaheadSeconds = 0.15; // 150ms lookahead for WebAudio
  private readonly scheduleIntervalMs = 25; // 25ms timer interval
  // NoteVisualizer requires +/- 128 ticks. Default lookahead ensures at least visualizer range.
  private readonly lookaheadTicks = 256;
  private readonly backBufferTicks = 256;

  private scheduleTimerId: number | null = null;
  private progressTimerId: number | null = null;

  // Listeners
  public onProgress?: (
    currentSeconds: number,
    totalSeconds: number,
    currentTick: number,
  ) => void;
  public onEnded?: () => void;

  public get channels(): number[] {
    return this.processor.channels;
  }

  public get notesByChannel(): Map<number, PostProcessedNote[]> {
    return this.processor.notesByChannel;
  }

  public get tempoMap(): TempoMap {
    return this.processor.tempoMap;
  }

  public get totalDurationSeconds(): number {
    return this.processor.totalDurationSeconds;
  }

  public get isInfiniteLoop(): boolean {
    return this.processor.isInfiniteLoop;
  }

  public get allFinished(): boolean {
    return this.processor.allFinished;
  }

  public setInstrumentBanks(banks: InstrumentBank[]): void {
    this.instrumentBanks = banks;
  }

  constructor(
    synth: SynthEngine,
    banks: InstrumentBank[],
    mml: string,
    onError: (e: unknown) => void,
  ) {
    this.synth = synth;
    this.instrumentBanks = banks;
    this.onError = onError;

    this.processor = new MMLProcessor(mml, onError);
    this.firstLoopEndTick = this.processor.firstLoopEndTick;

    // Save snapshot of first loop so seek/stop can restore instantly without re-parsing
    if (this.processor.isInfiniteLoop) {
      this.firstLoopSnapshot = this.processor.createSnapshot();
    }
  }

  /**
   * Start or resume playback
   */
  public async play(): Promise<void> {
    if (this.isPlaying) return;

    await this.synth.ensureContextRunning();
    this.isPlaying = true;

    // If reaching the end of finite playback, restart from beginning
    if (
      !this.processor.isInfiniteLoop &&
      this.processor.allFinished &&
      this.playbackOffsetSeconds >= this.processor.totalDurationSeconds
    ) {
      this.playbackOffsetSeconds = 0;
    }

    const currentTick = this.processor.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    if (
      this.processor.isInfiniteLoop &&
      this.hasPruned &&
      currentTick <= this.firstLoopEndTick
    ) {
      this.restoreFirstLoop();
    }

    this.playbackStartAudioTime =
      this.synth.currentTime - this.playbackOffsetSeconds;

    // Ensure lookahead buffer is filled up to current position + lookahead
    this.processor.parseUntil(currentTick + this.lookaheadTicks);

    // Move nextEventIndex to matching event
    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.processor.events.length &&
      this.getEventTime(this.processor.events[this.nextEventIndex]) <
        this.playbackOffsetSeconds
    ) {
      this.nextEventIndex++;
    }

    this.startSchedulerLoop();
    this.startProgressLoop();
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.stopSchedulerLoop();
    this.stopProgressLoop();

    this.playbackOffsetSeconds =
      this.synth.currentTime - this.playbackStartAudioTime;
    this.synth.stopAll();

    this.notifyProgress();
  }

  /**
   * Stop playback and reset to start
   */
  public stop(): void {
    this.isPlaying = false;
    this.stopSchedulerLoop();
    this.stopProgressLoop();

    this.playbackOffsetSeconds = 0;
    this.synth.stopAll();
    this.synth.resetChannelVolumes();

    if (this.processor.isInfiniteLoop && this.hasPruned) {
      this.restoreFirstLoop();
    } else {
      this.nextEventIndex = 0;
    }

    this.notifyProgress();
  }

  /**
   * Seek to specific position in seconds
   */
  public seek(seconds: number): void {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }

    // For infinite loops, allow seeking anywhere within the first loop. For finite, clamp to totalDurationSeconds.
    const maxSec = this.processor.totalDurationSeconds;
    this.playbackOffsetSeconds = Math.max(0, Math.min(maxSec, seconds));
    this.synth.stopAll();

    if (this.processor.isInfiniteLoop && this.hasPruned) {
      this.restoreFirstLoop();
    }

    const targetTick = this.processor.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    this.processor.parseUntil(targetTick + this.lookaheadTicks);

    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.processor.events.length &&
      this.getEventTime(this.processor.events[this.nextEventIndex]) <
        this.playbackOffsetSeconds
    ) {
      this.nextEventIndex++;
    }

    this.notifyProgress();

    if (wasPlaying) {
      this.play();
    }
  }

  public getCurrentSeconds(): number {
    if (this.isPlaying) {
      const elapsed = this.synth.currentTime - this.playbackStartAudioTime;
      if (!this.processor.isInfiniteLoop && this.processor.allFinished) {
        return Math.min(this.processor.totalDurationSeconds, elapsed);
      }
      return elapsed;
    }
    return this.playbackOffsetSeconds;
  }

  public getCurrentTick(): number {
    return this.processor.tempoMap.secondsToTick(this.getCurrentSeconds());
  }

  public secondsToTick(seconds: number): number {
    return this.processor.tempoMap.secondsToTick(seconds);
  }

  private startSchedulerLoop(): void {
    const tickLoop = async () => {
      if (!this.isPlaying) return;

      const currentAudioTime = this.synth.currentTime;
      const currentPlaybackSeconds =
        currentAudioTime - this.playbackStartAudioTime;
      const currentTick = this.processor.tempoMap.secondsToTick(currentPlaybackSeconds);

      // Real-time advance: parse ahead by lookaheadTicks AND resolve any ties/portamentos
      this.processor.parseUntil(currentTick + this.lookaheadTicks);

      if (this.processor.isInfiniteLoop) {
        this.pruneOldData(currentTick);
      }

      const scheduleUntilSeconds =
        currentPlaybackSeconds + this.lookaheadSeconds;

      while (this.nextEventIndex < this.processor.events.length) {
        const ev = this.processor.events[this.nextEventIndex];
        const eventSec = this.getEventTime(ev);

        if (eventSec > scheduleUntilSeconds) {
          break;
        }

        const targetAudioTime = this.playbackStartAudioTime + eventSec;

        if (ev.type === "note") {
          this.synth.setChannelVolume(ev.event.channel, ev.event.volume, targetAudioTime);
          await this.scheduleNote(ev.event, targetAudioTime).catch((e) => {
            this.onError(e);
          });
        } else if (ev.type === "volume") {
          this.synth.setChannelVolume(ev.channel, ev.volume, targetAudioTime);
        }

        this.nextEventIndex++;
      }

      // Check if finished (only for finite MML when all channels are exhausted)
      if (
        !this.processor.isInfiniteLoop &&
        this.processor.allFinished &&
        this.nextEventIndex >= this.processor.events.length &&
        currentPlaybackSeconds >= this.processor.totalDurationSeconds + 0.5
      ) {
        this.stop();
        this.onEnded?.();
        return;
      }

      this.scheduleTimerId = window.setTimeout(
        tickLoop,
        this.scheduleIntervalMs,
      );
    };

    window.setTimeout(tickLoop, 0);
  }

  /**
   * Restores events and notes from the first loop snapshot,
   * and resets channel states to the end of the first loop.
   */
  private restoreFirstLoop(): void {
    if (!this.firstLoopSnapshot) return;
    this.processor.restoreSnapshot(this.firstLoopSnapshot);
    this.nextEventIndex = 0;
    this.hasPruned = false;
    this.lastPrunedTick = 0;
  }

  /**
   * Prune events and notes older than (currentTick - backBufferTicks)
   * using shift from the front of the active buffers.
   */
  public pruneOldData(currentTick: number): void {
    if (!this.processor.isInfiniteLoop) return;

    const pruneBeforeTick = currentTick - this.backBufferTicks;
    if (pruneBeforeTick <= 0) {
      return;
    }

    if (currentTick - this.lastPrunedTick < MMLScheduler.ticksPerWholeNote) {
      return;
    }
    this.lastPrunedTick = currentTick;

    // 1. Prune this.processor.events from the front using shift
    while (this.processor.events.length > 0) {
      const ev = this.processor.events[0];
      const evEndTick =
        ev.type === "note" ? ev.event.tick + ev.event.duration : ev.tick;

      if (evEndTick < pruneBeforeTick) {
        this.processor.events.shift();
        this.nextEventIndex = Math.max(0, this.nextEventIndex - 1);
        this.hasPruned = true;
      } else {
        break;
      }
    }

    // 2. Prune this.processor.notesByChannel from the front using shift
    for (const [, notes] of this.processor.notesByChannel) {
      while (notes.length > 0) {
        const note = notes[0];
        if (note.tick + note.duration < pruneBeforeTick) {
          notes.shift();
          this.hasPruned = true;
        } else {
          break;
        }
      }
    }
  }

  private async scheduleNote(
    note: PostProcessedNote,
    audioTime: number,
  ): Promise<void> {
    const modulation =
      note.synth.modulation ??
      (note.modulation.enabled
        ? (() => {
            const m = new ModulationHelper(note.modulation);
            return m.enabled ? m : undefined;
          })()
        : undefined);

    note.synth = {
      ...(modulation ? { modulation } : {}),
    };

    note.synth.durationSec = this.processor.tempoMap.durationTicksToSeconds(
      note.tick,
      note.duration,
    );
    note.synth.gateDurationSec = this.processor.tempoMap.durationTicksToSeconds(
      note.tick,
      note.gateDuration,
    );

    // Calculate timing in seconds for each segment
    for (const seg of note.segments) {
      seg.startTimeOffsetSec = this.processor.tempoMap.durationTicksToSeconds(
        note.tick,
        seg.tickOffset,
      );
      seg.durationSec = this.processor.tempoMap.durationTicksToSeconds(
        note.tick + seg.tickOffset,
        seg.durationTicks,
      );
    }

    let voiceData: VoiceData | null = null;
    if (this.instrumentBanks.length === 0) {
      throw new Error("音源データが読み込まれていません");
    }
    for (const bank of this.instrumentBanks) {
      voiceData = await bank.getVoice(
        note.program,
        note.noteNumber,
        note.velocity,
      );
      if (voiceData) {
        note.synth.voiceType = bank.type;
        break;
      }
    }
    if (voiceData) {
      await this.synth.playNote(
        voiceData,
        note,
        Math.max(this.synth.currentTime, audioTime),
        note.synth.durationSec,
        note.synth.gateDurationSec,
      );
    } else {
      throw new Error(`@${note.program} に対応する音源が見つかりません`);
    }
  }

  private getEventTime(ev: PostProcessedEvent): number {
    const tick = ev.type === "note" ? ev.event.tick : ev.tick;
    return this.processor.tempoMap.tickToSeconds(tick);
  }

  private startProgressLoop(): void {
    const updateProgress = () => {
      if (!this.isPlaying) return;
      this.notifyProgress();
      this.progressTimerId = window.setTimeout(updateProgress, 50);
    };
    updateProgress();
  }

  private notifyProgress(): void {
    const curSec = this.getCurrentSeconds();
    const curTick = this.getCurrentTick();
    this.onProgress?.(curSec, this.totalDurationSeconds, curTick);
  }

  private stopSchedulerLoop(): void {
    if (this.scheduleTimerId !== null) {
      clearTimeout(this.scheduleTimerId);
      this.scheduleTimerId = null;
    }
  }

  private stopProgressLoop(): void {
    if (this.progressTimerId !== null) {
      clearTimeout(this.progressTimerId);
      this.progressTimerId = null;
    }
  }

  public dispose(): void {
    this.stop();
  }
}
