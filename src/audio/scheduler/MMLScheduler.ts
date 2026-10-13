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
  pendingNote: (NoteEvent & { portamentoTargetNote?: number; isSlur?: boolean }) | null;
  isFinished: boolean;
  firstInfiniteLoopReached: boolean;
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
  // NoteVisualizer requires +/- 128 ticks. Default lookahead ensures at least visualizer range.
  private readonly lookaheadTicks = 256;

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
          pendingNote: null,
          isFinished: Boolean(nextResult.done),
          firstInfiniteLoopReached: false,
        });
      }
    }

    // First pass: parse until all channels reach their first infinite loop or end.
    // This immediately determines totalDurationSeconds (entire song for finite MML,
    // or first loop duration for infinite MML).
    this.parseFirstPass();
  }

  /**
   * Initial batch parse in constructor.
   * Advances all channels until they finish or encounter their first infinite loop.
   */
  private parseFirstPass(): void {
    while (true) {
      let minTick = Infinity;
      let selectedCh = -1;

      for (const [ch, state] of this.channelStates) {
        if (
          state.isFinished ||
          state.firstInfiniteLoopReached ||
          !state.nextResult ||
          state.nextResult.done
        ) {
          continue;
        }
        const tick = state.nextResult.value.tick;
        if (tick < minTick) {
          minTick = tick;
          selectedCh = ch;
        }
      }

      if (selectedCh === -1) {
        // All channels have finished or reached their first infinite loop
        break;
      }

      const state = this.channelStates.get(selectedCh)!;
      const event = state.nextResult!.value!;

      if (event.type === "loop" && event.isInfinite) {
        this.isInfiniteLoop = true;
        state.firstInfiniteLoopReached = true;
        // Do not advance generator past this infinite loop in the first pass
        continue;
      }

      state.nextResult = state.generator.next();
      if (state.nextResult.done) {
        state.isFinished = true;
      }

      this.processEvent(state, event);
    }

    if (!this.isInfiniteLoop) {
      // Finite MML: all channels completed, flush any remaining pendingNotes
      this.flushAllChannels();
      this.allFinished = true;
    } else {
      // Infinite MML: reset firstInfiniteLoopReached so playback can advance past it.
      // Do NOT flush pendingNote here because loop ends can tie or portamento across
      // the loop boundary into the next iteration (e.g. [ERC_] = ERC_ERC_E...)
      for (const [, state] of this.channelStates) {
        state.firstInfiniteLoopReached = false;
      }
    }

    this.ensureEventsSorted();

    // Duration is now known: full duration for finite, 1st loop duration for infinite
    this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
  }

  public get duration(): number {
    return this.totalDurationSeconds;
  }

  public get isInfinite(): boolean {
    return this.isInfiniteLoop;
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
   * Parse events from channels until all active channels advance past targetTick,
   * AND all pending ties or unresolved portamento targets (started at or before targetTick)
   * are completely resolved by following notes.
   */
  public parseUntil(targetTick: number): void {
    if (this.allFinished) return;

    let iterations = 0;
    const maxIterations = 20000; // Safeguard against pathological infinite tie MMLs

    while (iterations++ < maxIterations) {
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
        if (!this.isInfiniteLoop) {
          this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
        }
        break;
      }

      if (minTick > targetTick) {
        // minTick has passed targetTick.
        // Check if any channel still has an unresolved pending tie or portamento target.
        let hasPending = false;
        for (const [, state] of this.channelStates) {
          if (state.isFinished) continue;
          if (state.pendingNote) {
            hasPending = true;
            break;
          }
        }

        if (!hasPending) {
          // All pending ties and portamentos are resolved!
          break;
        }
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

    if (this.eventsNeedSort) {
      this.ensureEventsSorted();
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
      // Track maxTick from raw note duration as well
      const noteEnd = event.tick + event.duration;
      if (noteEnd > this.maxTick) {
        this.maxTick = noteEnd;
      }

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

      // 2. Tie & Portamento resolution and emission pipeline
      const curr: NoteEvent & { portamentoTargetNote?: number; isSlur?: boolean } = {
        ...event,
      };
      const pending = state.pendingNote;

      if (pending) {
        // Resolve portamento target for pending note
        if (pending.isPortamento && pending.portamentoTargetNote === undefined) {
          pending.portamentoTargetNote = curr.noteNumber;
        }

        // Merge contiguous same-pitch tie
        if (
          pending.isTie &&
          pending.noteNumber === curr.noteNumber &&
          pending.tick + pending.duration === curr.tick
        ) {
          pending.duration += curr.duration;
          pending.gateDuration += curr.gateDuration;
          pending.isTie = curr.isTie;
          if (curr.isPortamento) {
            pending.isPortamento = true;
            pending.portamentoTargetNote = undefined;
          }

          // If pending note still needs resolution (further tie or unresolved portamento), keep pending
          if (
            pending.isTie ||
            (pending.isPortamento && pending.portamentoTargetNote === undefined)
          ) {
            return;
          }

          // Fully resolved: emit merged note and clear pending
          this.emitPreparedNote(pending);
          state.pendingNote = null;
          return;
        }

        // Different note: emit pending note
        this.emitPreparedNote(pending);
        state.pendingNote = null;

        // Slur check: pending was a tie with contiguous ticks but different pitch
        if (
          pending.isTie &&
          pending.tick + pending.duration === curr.tick &&
          pending.noteNumber !== curr.noteNumber
        ) {
          curr.isSlur = true;
        }
      }

      // Process curr:
      // If curr needs lookahead for tie or portamento target, hold it in pendingNote.
      // Otherwise, emit immediately without waiting for next note!
      if (curr.isTie || curr.isPortamento) {
        state.pendingNote = curr;
      } else {
        this.emitPreparedNote(curr);
      }
    }
  }

  private flushChannel(state: ChannelState): void {
    if (state.pendingNote) {
      this.emitPreparedNote(state.pendingNote);
      state.pendingNote = null;
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

    // For infinite loops, allow seeking anywhere >= 0. For finite, clamp to totalDurationSeconds.
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

      // Real-time advance: parse ahead by lookaheadTicks AND resolve any ties/portamentos
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
