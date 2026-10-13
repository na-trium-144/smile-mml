/**
 * MML Playback Scheduler
 * High-precision scheduling using WebAudio AudioContext timestamps
 * with lookahead buffer intervals, dynamic real-time parsing,
 * and integrated visualizer preprocessing.
 */

import type { SynthEngine } from "../synth/SynthEngine.js";
import type { PreparedEvent, PreparedNote } from "../types.js";
import type { MMLEvent, NoteEvent } from "../../parser/types.js";
import {
  MMLChannelParser,
  splitMMLChannels,
  NOTE_NAMES,
} from "../../parser/vmmlParser.js";
import { sbDetuneToCents } from "../utils/conversion.js";
import { TempoMap } from "./TempoMap.js";
import type { VisualizerNote } from "../../components/NoteVisualizer.js";

interface ChannelState {
  channelIndex: number;
  parser: MMLChannelParser;
  generator: Generator<MMLEvent, void, unknown>;
  nextResult: IteratorResult<MMLEvent, void> | null;
  activeNote: (NoteEvent & { portamentoTargetNote?: number; isSlur?: boolean }) | null;
  lastEmittedNote: { noteNumber: number; tick: number; duration: number; isTie: boolean } | null;
  isFinished: boolean;
}

export class MMLScheduler {
  private synth: SynthEngine;
  private tempoMap: TempoMap;
  public onError: (e: unknown) => void;
  public readonly ticksPerWholeNote: number;

  // Channel parser states
  private channelStates: Map<number, ChannelState> = new Map();
  public readonly channels: number[] = []; // Active channel list (0-15)

  // Prepared playback events (for Synth)
  private events: PreparedEvent[] = [];
  private eventsNeedSort: boolean = false;
  private nextEventIndex: number = 0;

  // Visualizer data (for NoteVisualizer)
  private _visualizerNotes: VisualizerNote[] = [];
  private visualizerNotesByChannel: Map<number, VisualizerNote[]> = new Map();

  // Playback & parse state
  private isPlaying: boolean = false;
  private isInfiniteLoop: boolean = false;
  private allFinished: boolean = false;
  private maxTick: number = 0;
  private totalDurationSeconds: number = 0;

  private playbackOffsetSeconds: number = 0;
  private playbackStartAudioTime: number = 0;

  // Lookahead settings
  private readonly lookaheadSeconds = 0.15; // 150ms lookahead for WebAudio
  private readonly scheduleIntervalMs = 25; // 25ms timer interval
  // NoteVisualizer requires +/- 128 ticks. We look ahead by 512 ticks
  // to ensure visualizer display and 1-note lookahead for portamento & ties are always ready.
  private readonly lookaheadTicks = 512;

  private scheduleTimerId: number | null = null;
  private progressTimerId: number | null = null;

  // Listeners
  public onProgress?: (
    currentSeconds: number,
    totalSeconds: number,
    currentTick: number,
  ) => void;
  public onEnded?: () => void;

  constructor(
    synth: SynthEngine,
    mml: string,
    ticksPerWholeNote: number = 192,
    onError: (e: unknown) => void,
  ) {
    this.synth = synth;
    this.ticksPerWholeNote = ticksPerWholeNote;
    this.onError = onError;
    this.tempoMap = new TempoMap([], ticksPerWholeNote);

    const { channels, initialKeyShift } = splitMMLChannels(mml);

    for (let ch = 0; ch < 16; ch++) {
      if (channels[ch].trim() !== "") {
        this.channels.push(ch);
        this.visualizerNotesByChannel.set(ch, []);

        const parser = new MMLChannelParser(
          ch,
          channels[ch],
          mml,
          initialKeyShift,
          ticksPerWholeNote,
        );
        const generator = parser.nextEvent();
        const nextResult = generator.next();

        this.channelStates.set(ch, {
          channelIndex: ch,
          parser,
          generator,
          nextResult,
          activeNote: null,
          lastEmittedNote: null,
          isFinished: Boolean(nextResult.done),
        });
      }
    }

    // Initial lookahead parse: parse first lookaheadTicks (e.g. 512 ticks)
    this.parseUntil(this.lookaheadTicks);
    this.ensureEventsSorted();
  }

  public get duration(): number {
    return this.isInfiniteLoop ? Infinity : this.totalDurationSeconds;
  }

  public get playing(): boolean {
    return this.isPlaying;
  }

  public get visualizerNotes(): VisualizerNote[] {
    return this._visualizerNotes;
  }

  public getChannelVisualizerNotes(channel: number): VisualizerNote[] {
    return this.visualizerNotesByChannel.get(channel) ?? [];
  }

  /**
   * Parse events from channels until all active channels advance past targetTick.
   */
  public parseUntil(targetTick: number): void {
    if (this.allFinished) return;

    while (true) {
      let minTick = Infinity;
      let selectedCh = -1;

      for (const [ch, state] of this.channelStates) {
        if (state.isFinished || !state.nextResult || state.nextResult.done) {
          continue;
        }
        const tick = state.nextResult.value.tick;
        if (tick < minTick) {
          minTick = tick;
          selectedCh = ch;
        }
      }

      if (selectedCh === -1) {
        // All active channels have completed
        this.flushAllChannels();
        this.allFinished = true;
        this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
        break;
      }

      if (minTick > targetTick) {
        break;
      }

      const state = this.channelStates.get(selectedCh)!;
      const event = state.nextResult!.value!;

      // Advance generator for selected channel
      state.nextResult = state.generator.next();
      if (state.nextResult.done) {
        state.isFinished = true;
      }

      this.processEvent(state, event);
    }
  }

  private processEvent(state: ChannelState, event: MMLEvent): void {
    if (event.type === "tempo") {
      this.tempoMap.addTempo(event.tick, event.bpm);
      this.events.push({
        type: "tempo",
        tick: event.tick,
        bpm: event.bpm,
      });
      this.eventsNeedSort = true;
      return;
    }

    if (event.type === "control") {
      if (event.controller === 7) {
        this.events.push({
          type: "volume",
          tick: event.tick,
          channel: event.channel,
          volume: event.value,
        });
        this.eventsNeedSort = true;
      } else if (event.controller === 10) {
        this.events.push({
          type: "pan",
          tick: event.tick,
          channel: event.channel,
          pan: event.value,
        });
        this.eventsNeedSort = true;
      }
      return;
    }

    if (event.type === "loop") {
      if (event.isInfinite) {
        this.isInfiniteLoop = true;
      }
      return;
    }

    if (event.type === "end") {
      this.flushChannel(state);
      state.isFinished = true;
      return;
    }

    if (event.type === "note") {
      // 1. Build VisualizerNote for real-time display
      const noteStr =
        NOTE_NAMES[event.baseNoteIndex] +
        (event.totalAccidentials > 0
          ? "#".repeat(event.totalAccidentials)
          : "b".repeat(-event.totalAccidentials)) +
        event.noteValue.toString() +
        ".".repeat(event.totalDots) +
        (event.isTie ? "&" : "") +
        (event.isPortamento ? "_" : "");

      const vNote: VisualizerNote = {
        channel: event.channel,
        noteStr,
        octave: event.baseOctave,
        startTick: event.tick,
        endTick: event.tick + event.duration,
        program: event.program,
        volume: event.volume,
        velocity: event.velocity,
        pan: event.pan,
      };
      this._visualizerNotes.push(vNote);
      this.visualizerNotesByChannel.get(event.channel)?.push(vNote);

      // 2. Tie & Portamento resolution pipeline
      const prev = state.activeNote;
      if (!prev) {
        let isSlur = false;
        if (
          state.lastEmittedNote?.isTie &&
          state.lastEmittedNote.tick + state.lastEmittedNote.duration === event.tick &&
          state.lastEmittedNote.noteNumber !== event.noteNumber
        ) {
          isSlur = true;
        }
        state.activeNote = { ...event, isSlur };
      } else {
        // Resolve portamento target for previous note
        if (prev.isPortamento && prev.portamentoTargetNote === undefined) {
          prev.portamentoTargetNote = event.noteNumber;
        }

        // Merge contiguous same-pitch tie
        if (
          prev.isTie &&
          prev.noteNumber === event.noteNumber &&
          prev.tick + prev.duration === event.tick
        ) {
          prev.duration += event.duration;
          prev.gateDuration += event.gateDuration;
          prev.isTie = event.isTie;
          if (event.isPortamento) {
            prev.isPortamento = true;
            prev.portamentoTargetNote = undefined;
          }
        } else {
          // Different note: emit previous note
          this.emitPreparedNote(prev);
          state.lastEmittedNote = prev;

          let isSlur = false;
          if (
            prev.isTie &&
            prev.tick + prev.duration === event.tick &&
            prev.noteNumber !== event.noteNumber
          ) {
            isSlur = true;
          }
          state.activeNote = { ...event, isSlur };
        }
      }
    }
  }

  private flushChannel(state: ChannelState): void {
    if (state.activeNote) {
      this.emitPreparedNote(state.activeNote);
      state.lastEmittedNote = state.activeNote;
      state.activeNote = null;
    }
  }

  private flushAllChannels(): void {
    for (const [, state] of this.channelStates) {
      this.flushChannel(state);
    }
    if (this.eventsNeedSort) {
      this.ensureEventsSorted();
    }
  }

  private emitPreparedNote(
    n: NoteEvent & { portamentoTargetNote?: number; isSlur?: boolean },
  ): void {
    if (n.duration <= 0) return; // Skip 0-duration portamento target notes (e.g. E in C4_E)

    const preparedNote: PreparedNote = {
      tick: n.tick,
      duration: n.duration,
      gateDuration: Math.max(1, n.gateDuration),
      channel: n.channel,
      noteNumber: n.noteNumber,
      velocity: n.volume, // V in MML
      volume: n.velocity, // @V in MML
      pan: n.pan,
      program: n.program,
      detuneCents: sbDetuneToCents(n.detune),
      envelope: n.envelope,
      modulation: n.modulation,
      isPortamento: Boolean(n.isPortamento && n.portamentoTargetNote !== undefined),
      portamentoTargetNote: n.portamentoTargetNote,
      isSlur: n.isSlur,
    };

    const noteEnd = preparedNote.tick + preparedNote.duration;
    if (noteEnd > this.maxTick) {
      this.maxTick = noteEnd;
    }

    this.events.push({
      type: "note",
      event: preparedNote,
    });
    this.eventsNeedSort = true;
  }

  private ensureEventsSorted(): void {
    if (!this.eventsNeedSort) return;
    this.events.sort((a, b) => {
      const tickA = a.type === "note" ? a.event.tick : a.tick;
      const tickB = b.type === "note" ? b.event.tick : b.tick;
      if (tickA !== tickB) return tickA - tickB;
      if (a.type !== "note" && b.type === "note") return -1;
      if (a.type === "note" && b.type !== "note") return 1;
      return 0;
    });
    this.eventsNeedSort = false;
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
      !this.isInfiniteLoop &&
      this.allFinished &&
      this.playbackOffsetSeconds >= this.totalDurationSeconds
    ) {
      this.playbackOffsetSeconds = 0;
    }

    this.playbackStartAudioTime =
      this.synth.currentTime - this.playbackOffsetSeconds;

    // Ensure lookahead buffer is filled up to current position + lookahead
    const currentTick = this.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    this.parseUntil(currentTick + this.lookaheadTicks);
    this.ensureEventsSorted();

    // Move nextEventIndex to matching event
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

    const maxSec = this.isInfiniteLoop ? Infinity : this.totalDurationSeconds;
    this.playbackOffsetSeconds = Math.max(0, Math.min(maxSec, seconds));
    this.synth.stopAll();

    const targetTick = this.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    this.parseUntil(targetTick + this.lookaheadTicks);
    this.ensureEventsSorted();

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

  public getCurrentSeconds(): number {
    if (this.isPlaying) {
      const elapsed = this.synth.currentTime - this.playbackStartAudioTime;
      if (!this.isInfiniteLoop && this.allFinished) {
        return Math.min(this.totalDurationSeconds, elapsed);
      }
      return elapsed;
    }
    return this.playbackOffsetSeconds;
  }

  public getCurrentTick(): number {
    return this.tempoMap.secondsToTick(this.getCurrentSeconds());
  }

  public secondsToTick(seconds: number): number {
    return this.tempoMap.secondsToTick(seconds);
  }

  private startSchedulerLoop(): void {
    const tickLoop = () => {
      if (!this.isPlaying) return;

      const currentAudioTime = this.synth.currentTime;
      const currentPlaybackSeconds =
        currentAudioTime - this.playbackStartAudioTime;
      const currentTick = this.tempoMap.secondsToTick(currentPlaybackSeconds);

      // Real-time advance: always parse ahead by lookaheadTicks
      this.parseUntil(currentTick + this.lookaheadTicks);
      this.ensureEventsSorted();

      const scheduleUntilSeconds =
        currentPlaybackSeconds + this.lookaheadSeconds;

      while (this.nextEventIndex < this.events.length) {
        const ev = this.events[this.nextEventIndex];
        const eventSec = this.getEventTime(ev);

        if (eventSec > scheduleUntilSeconds) {
          break;
        }

        const targetAudioTime = this.playbackStartAudioTime + eventSec;

        if (ev.type === "note") {
          try {
            this.scheduleNote(ev.event, targetAudioTime);
          } catch (e) {
            this.onError(e);
          }
        }

        this.nextEventIndex++;
      }

      // Check if finished (only for finite MML when all channels are exhausted)
      if (
        !this.isInfiniteLoop &&
        this.allFinished &&
        this.nextEventIndex >= this.events.length &&
        currentPlaybackSeconds >= this.totalDurationSeconds + 0.5
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

  private scheduleNote(note: PreparedNote, audioTime: number): void {
    const durationSec = this.tempoMap.durationTicksToSeconds(
      note.tick,
      note.duration,
    );
    const gateDurationSec = this.tempoMap.durationTicksToSeconds(
      note.tick,
      note.gateDuration,
    );

    this.synth.playNote(
      note,
      Math.max(this.synth.currentTime, audioTime),
      durationSec,
      gateDurationSec,
    );
  }

  private getEventTime(ev: PreparedEvent): number {
    const tick = ev.type === "note" ? ev.event.tick : ev.tick;
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
    const dur = this.isInfiniteLoop
      ? Infinity
      : (this.allFinished
          ? this.totalDurationSeconds
          : this.tempoMap.tickToSeconds(this.maxTick));
    this.onProgress?.(curSec, dur, curTick);
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
