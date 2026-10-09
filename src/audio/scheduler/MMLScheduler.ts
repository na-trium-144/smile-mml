/**
 * MML Playback Scheduler
 * High-precision scheduling using WebAudio AudioContext timestamps
 * with lookahead buffer intervals.
 */

import type { SynthEngine } from '../synth/SynthEngine.js';
import type { PreparedEvent, PreparedNote } from '../types.js';
import { TempoMap } from './TempoMap.js';

export class MMLScheduler {
  private synth: SynthEngine;
  private events: PreparedEvent[] = [];
  private tempoMap: TempoMap;
  private totalDurationSeconds: number = 0;
  private maxTick: number = 0;

  // Playback state
  private isPlaying: boolean = false;
  private playbackOffsetSeconds: number = 0; // seconds already played when paused/seeked
  private playbackStartAudioTime: number = 0; // AudioContext.currentTime when started
  private nextEventIndex: number = 0;

  // Lookahead settings
  private readonly lookaheadSeconds = 0.15; // 150ms lookahead
  private readonly scheduleIntervalMs = 25; // check every 25ms
  private scheduleTimerId: number | null = null;
  private progressTimerId: number | null = null;

  // Listeners
  public onProgress?: (currentSeconds: number, totalSeconds: number, currentTick: number) => void;
  public onEnded?: () => void;

  constructor(synth: SynthEngine, events: PreparedEvent[], ticksPerWholeNote: number = 192) {
    this.synth = synth;
    this.events = events;

    // Extract tempo events to construct TempoMap
    const tempoEvents = events
      .filter((e): e is { type: 'tempo'; tick: number; bpm: number } => e.type === 'tempo')
      .map((e) => ({ tick: e.tick, bpm: e.bpm }));

    this.tempoMap = new TempoMap(tempoEvents, ticksPerWholeNote);

    // Calculate maximum tick and total duration
    this.maxTick = 0;
    for (const ev of events) {
      if (ev.type === 'note') {
        const noteEnd = ev.event.tick + ev.event.duration;
        if (noteEnd > this.maxTick) this.maxTick = noteEnd;
      } else {
        if (ev.tick > this.maxTick) this.maxTick = ev.tick;
      }
    }

    this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
  }

  public get duration(): number {
    return this.totalDurationSeconds;
  }

  public get playing(): boolean {
    return this.isPlaying;
  }

  /**
   * Start or resume playback
   */
  public async play(): Promise<void> {
    if (this.isPlaying) return;

    await this.synth.ensureContextRunning();
    this.isPlaying = true;

    // If reaching the end, restart from beginning
    if (this.playbackOffsetSeconds >= this.totalDurationSeconds) {
      this.playbackOffsetSeconds = 0;
    }

    this.playbackStartAudioTime = this.synth.currentTime - this.playbackOffsetSeconds;

    // Move nextEventIndex to the event matching playbackOffsetSeconds
    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.events.length &&
      this.getEventTime(this.events[this.nextEventIndex]) < this.playbackOffsetSeconds
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

    // Record elapsed time
    this.playbackOffsetSeconds = this.synth.currentTime - this.playbackStartAudioTime;
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
    this.nextEventIndex = 0;
    this.synth.stopAll();

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

    this.playbackOffsetSeconds = Math.max(0, Math.min(this.totalDurationSeconds, seconds));
    this.synth.stopAll();

    // Re-index event pointer
    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.events.length &&
      this.getEventTime(this.events[this.nextEventIndex]) < this.playbackOffsetSeconds
    ) {
      this.nextEventIndex++;
    }

    this.notifyProgress();

    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Current elapsed playback seconds
   */
  public getCurrentSeconds(): number {
    if (this.isPlaying) {
      return Math.min(
        this.totalDurationSeconds,
        this.synth.currentTime - this.playbackStartAudioTime
      );
    }
    return this.playbackOffsetSeconds;
  }

  /**
   * Current tick
   */
  public getCurrentTick(): number {
    return this.tempoMap.secondsToTick(this.getCurrentSeconds());
  }

  private startSchedulerLoop(): void {
    const tickLoop = () => {
      if (!this.isPlaying) return;

      const currentAudioTime = this.synth.currentTime;
      const currentPlaybackSeconds = currentAudioTime - this.playbackStartAudioTime;
      const scheduleUntilSeconds = currentPlaybackSeconds + this.lookaheadSeconds;

      // Schedule all events up to lookahead window
      while (this.nextEventIndex < this.events.length) {
        const ev = this.events[this.nextEventIndex];
        const eventSec = this.getEventTime(ev);

        if (eventSec > scheduleUntilSeconds) {
          break; // past current lookahead window
        }

        // Only schedule if it's within or slightly ahead of current time
        const targetAudioTime = this.playbackStartAudioTime + eventSec;

        if (ev.type === 'note') {
          this.scheduleNote(ev.event, targetAudioTime);
        }

        this.nextEventIndex++;
      }

      // Check if finished
      if (
        this.nextEventIndex >= this.events.length &&
        currentPlaybackSeconds >= this.totalDurationSeconds + 0.5
      ) {
        this.stop();
        this.onEnded?.();
        return;
      }

      this.scheduleTimerId = window.setTimeout(tickLoop, this.scheduleIntervalMs);
    };

    tickLoop();
  }

  private scheduleNote(note: PreparedNote, audioTime: number): void {
    const durationSec = this.tempoMap.durationTicksToSeconds(note.tick, note.duration);
    const gateDurationSec = this.tempoMap.durationTicksToSeconds(note.tick, note.gateDuration);

    this.synth.playNote(note, Math.max(this.synth.currentTime, audioTime), durationSec, gateDurationSec);
  }

  private getEventTime(ev: PreparedEvent): number {
    const tick = ev.type === 'note' ? ev.event.tick : ev.tick;
    return this.tempoMap.tickToSeconds(tick);
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
