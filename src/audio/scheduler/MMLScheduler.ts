/**
 * MML Playback Scheduler
 * High-precision scheduling using WebAudio AudioContext timestamps
 * with lookahead buffer intervals, dynamic real-time parsing,
 * and integrated visualizer preprocessing.
 */

import type { SynthEngine } from "../synth/SynthEngine.js";
import type { PostProcessedEvent, PostProcessedNote, NoteSegment, VoiceData } from "../types.js";
import type { MMLEvent, NoteEvent } from "../../parser/types.js";
import {
  MMLChannelParser,
  splitMMLChannels,
  NOTE_NAMES,
} from "../../parser/vmmlParser.js";
import { sbDetuneToCents } from "../utils/conversion.js";
import { TempoMap } from "./TempoMap.js";
import type { InstrumentBank } from "../banks/InstrumentBank.js";

interface PendingCompound {
  startTick: number;
  firstNote: NoteEvent;
  segments: NoteSegment[];
  totalDuration: number;
  lastNote: NoteEvent;
}

interface ChannelState {
  channelIndex: number;
  parser: MMLChannelParser;
  generator: Generator<MMLEvent, void, unknown>;
  nextResult: IteratorResult<MMLEvent, void> | null;
  pendingCompound: PendingCompound | null;
  isFinished: boolean;
  firstInfiniteLoopReached: boolean;
}

export class MMLScheduler {
  private synth: SynthEngine;
  private instrumentBanks: InstrumentBank[];
  private tempoMap: TempoMap;
  public onError: (e: unknown) => void;
  public readonly ticksPerWholeNote: number;
  private readonly mml: string;
  private readonly backBufferTicks: number;

  // First loop snapshot (never modified after initial pass)
  private firstLoopEvents: PostProcessedEvent[] = [];
  private firstLoopNotesByChannel: Map<number, PostProcessedNote[]> = new Map();
  private firstLoopPendingCompounds: Map<number, PendingCompound | null> = new Map();
  public firstLoopEndTick: number = 0;

  // Channel parser states
  private channelStates: Map<number, ChannelState> = new Map();
  public channels: number[] = []; // Active channel list (0-15)

  // Prepared playback events (for Synth)
  private events: PostProcessedEvent[] = [];
  private eventsNeedSort: boolean = false;
  private nextEventIndex: number = 0;

  // Visualizer data (for NoteVisualizer)
  notesByChannel: Map<number, PostProcessedNote[]> = new Map();

  // Playback & parse state
  private isPlaying: boolean = false;
  isInfiniteLoop: boolean = false;
  private allFinished: boolean = false;
  private maxTick: number = 0;
  totalDurationSeconds: number = 0;
  private hasPruned: boolean = false;
  private lastPrunedTick: number = 0;

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

  setInstrumentBanks(banks: InstrumentBank[]){
    this.instrumentBanks = banks;
  }

  constructor(
    synth: SynthEngine,
    banks: InstrumentBank[],
    mml: string,
    ticksPerWholeNote: number = 192,
    onError: (e: unknown) => void,
  ) {
    this.synth = synth;
    this.instrumentBanks = banks;
    this.mml = mml;
    this.ticksPerWholeNote = ticksPerWholeNote;
    this.backBufferTicks = ticksPerWholeNote * 10;
    this.onError = onError;
    this.tempoMap = new TempoMap([], ticksPerWholeNote);

    const { channels, initialKeyShift } = splitMMLChannels(this.mml);

    for (let ch = 0; ch < 16; ch++) {
      if (channels[ch].trim() !== "") {
        this.channels.push(ch);
        this.notesByChannel.set(ch, []);

        const parser = new MMLChannelParser(
          ch,
          channels[ch],
          this.mml,
          initialKeyShift,
        );
        const generator = parser.nextEvent();
        const nextResult = generator.next();

        this.channelStates.set(ch, {
          channelIndex: ch,
          parser,
          generator,
          nextResult,
          pendingCompound: null,
          isFinished: Boolean(nextResult.done),
          firstInfiniteLoopReached: false,
        });
      }
    }

    // First pass: parse until all channels reach their first infinite loop or end.
    // This immediately determines totalDurationSeconds (entire song for finite MML,
    // or first loop duration for infinite MML).
    this.parseFirstPass();
    this.firstLoopEndTick = this.maxTick;

    // Save snapshot of the first loop so seek/stop can restore instantly without re-parsing
    if (this.isInfiniteLoop) {
      this.firstLoopEvents = [...this.events];
      for (const ch of this.channels) {
        this.firstLoopNotesByChannel.set(ch, [...(this.notesByChannel.get(ch) ?? [])]);
      }
      for (const [ch, state] of this.channelStates) {
        this.firstLoopPendingCompounds.set(
          ch,
          state.pendingCompound ? { ...state.pendingCompound } : null,
        );
      }
    }
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
          if (state.pendingCompound) {
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

    if (event.type === "rest") {
      this.flushChannel(state);
      return;
    }

    if (event.type === "end") {
      this.flushChannel(state);
      state.isFinished = true;
      if (event.error) {
        this.onError(event.error);
      }
      return;
    }

    if (event.type === "note") {
      // Track maxTick from raw note duration as well
      const noteEnd = event.tick + event.duration;
      if (noteEnd > this.maxTick) {
        this.maxTick = noteEnd;
      }

      // 2. Compound note (tie, slur, portamento) pipeline
      const pending = state.pendingCompound;

      if (pending) {
        // Resolve portamento target for previous portamento segment if any
        const lastSeg = pending.segments[pending.segments.length - 1];
        if (pending.lastNote.isPortamento && lastSeg.portamentoTargetNote === undefined) {
          lastSeg.portamentoTargetNote = event.noteNumber;
          lastSeg.portamentoTargetDetuneCents = sbDetuneToCents(event.detune);
          lastSeg.portamentoTargetNoteStr = MMLScheduler.noteString(event);
          lastSeg.portamentoTargetOctave = event.baseOctave;
        }

        const prevNote = pending.lastNote;
        const isIdentical =
          prevNote.noteNumber === event.noteNumber &&
          prevNote.velocity === event.velocity &&
          prevNote.volume === event.volume &&
          prevNote.pan === event.pan &&
          prevNote.detune === event.detune;

        // Same pitch and parameters following a tie (&): merge segment into previous one
        if (prevNote.isTie && isIdentical) {
          lastSeg.durationTicks += event.duration;
          lastSeg.isPortamento = event.isPortamento;
          pending.totalDuration += event.duration;
          pending.lastNote = event;
          lastSeg.noteStr += MMLScheduler.noteString(event);
        } else {
          // Different pitch or parameter change (slur), or following a portamento (_)
          if (event.duration > 0 || event.isTie || event.isPortamento) {
            pending.segments.push({
              tickOffset: event.tick - pending.startTick,
              durationTicks: event.duration,
              noteNumber: event.noteNumber,
              detuneCents: sbDetuneToCents(event.detune),
              velocity: event.velocity,
              volume: event.volume,
              pan: event.pan,
              isPortamento: event.isPortamento,
              noteStr: MMLScheduler.noteString(event),
              octave: event.baseOctave,
            });
            pending.totalDuration += event.duration;
          }
          pending.lastNote = event;
        }

        // Check if compound note continues
        if (event.isTie || event.isPortamento) {
          return;
        }

        // Compound note fully resolved: emit and clear pending
        this.emitCompoundNote(pending);
        state.pendingCompound = null;
        return;
      }

      // No pending compound:
      // If event initiates a tie or portamento, start a new pendingCompound
      if (event.isTie || event.isPortamento) {
        state.pendingCompound = {
          startTick: event.tick,
          firstNote: event,
          segments: [
            {
              tickOffset: 0,
              durationTicks: event.duration,
              noteNumber: event.noteNumber,
              detuneCents: sbDetuneToCents(event.detune),
              velocity: event.velocity,
              volume: event.volume,
              pan: event.pan,
              isPortamento: event.isPortamento,
              noteStr: MMLScheduler.noteString(event),
              octave: event.baseOctave,
            },
          ],
          totalDuration: event.duration,
          lastNote: event,
        };
      } else {
        this.emitSingleNote(event);
      }
    }
  }
  static noteString(event: NoteEvent){
    return NOTE_NAMES[event.baseNoteIndex] +
        (event.totalAccidentials > 0
          ? "#".repeat(event.totalAccidentials)
          : "b".repeat(-event.totalAccidentials)) +
        (event.duration > 0 ? event.noteValue.toString() + ".".repeat(event.totalDots) : "") +
        (event.isTie ? "&" : "") +
        (event.isPortamento ? "_" : "")
  }

  private flushChannel(state: ChannelState): void {
    if (state.pendingCompound) {
      this.emitCompoundNote(state.pendingCompound);
      state.pendingCompound = null;
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

  private emitCompoundNote(compound: PendingCompound): void {
    if (compound.totalDuration <= 0) return;

    const first = compound.firstNote;
    const gateRatio = first.gate / 8;
    const gateDuration = Math.max(1, Math.round(compound.totalDuration * gateRatio));

    const initialSeg = compound.segments[0];

    const postProcessedNote: PostProcessedNote = {
      tick: compound.startTick,
      duration: compound.totalDuration,
      gateDuration,
      channel: first.channel,
      noteNumber: initialSeg.noteNumber,
      velocity: initialSeg.velocity, // V in MML
      volume: initialSeg.volume, // @V in MML
      pan: initialSeg.pan, // P in MML
      program: first.program,
      detuneCents: initialSeg.detuneCents,
      envelope: first.envelope,
      modulation: first.modulation,
      segments: compound.segments,
      synth: {},
    };

    const noteEnd = postProcessedNote.tick + postProcessedNote.duration;
    if (noteEnd > this.maxTick) {
      this.maxTick = noteEnd;
    }

    this.events.push({
      type: "note",
      event: postProcessedNote,
    });
    this.notesByChannel.get(first.channel)?.push(postProcessedNote);
    this.eventsNeedSort = true;
  }

  private emitSingleNote(n: NoteEvent): void {
    if (n.duration <= 0) return;

    const postProcessedNote: PostProcessedNote = {
      tick: n.tick,
      duration: n.duration,
      gateDuration: Math.max(1, n.gateDuration),
      channel: n.channel,
      noteNumber: n.noteNumber,
      velocity: n.velocity, // V in MML
      volume: n.volume, // @V in MML
      pan: n.pan,
      program: n.program,
      detuneCents: sbDetuneToCents(n.detune),
      envelope: n.envelope,
      modulation: n.modulation,
      segments: [
        {
          tickOffset: 0,
          durationTicks: n.duration,
          noteNumber: n.noteNumber,
          detuneCents: sbDetuneToCents(n.detune),
          velocity: n.velocity,
          volume: n.volume,
          pan: n.pan,
          isPortamento: false,
          noteStr: MMLScheduler.noteString(n),
              octave: n.baseOctave,
        },
      ],
      synth: {},
    };

    const noteEnd = postProcessedNote.tick + postProcessedNote.duration;
    if (noteEnd > this.maxTick) {
      this.maxTick = noteEnd;
    }

    this.events.push({
      type: "note",
      event: postProcessedNote,
    });
    this.notesByChannel.get(n.channel)?.push(postProcessedNote);
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

    const currentTick = this.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    if (
      this.isInfiniteLoop &&
      this.hasPruned &&
      currentTick <= this.firstLoopEndTick
    ) {
      this.restoreFirstLoop();
    }

    this.playbackStartAudioTime =
      this.synth.currentTime - this.playbackOffsetSeconds;

    // Ensure lookahead buffer is filled up to current position + lookahead
    this.parseUntil(currentTick + this.lookaheadTicks);
    this.ensureEventsSorted();

    // Move nextEventIndex to matching event
    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.events.length &&
      this.getEventTime(this.events[this.nextEventIndex]) <
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

    if (this.isInfiniteLoop && this.hasPruned) {
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
    const maxSec = this.totalDurationSeconds;
    this.playbackOffsetSeconds = Math.max(0, Math.min(maxSec, seconds));
    this.synth.stopAll();

    if (this.isInfiniteLoop && this.hasPruned) {
      this.restoreFirstLoop();
    }

    const targetTick = this.tempoMap.secondsToTick(this.playbackOffsetSeconds);
    this.parseUntil(targetTick + this.lookaheadTicks);
    this.ensureEventsSorted();

    this.nextEventIndex = 0;
    while (
      this.nextEventIndex < this.events.length &&
      this.getEventTime(this.events[this.nextEventIndex]) <
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
    const tickLoop = async () => {
      if (!this.isPlaying) return;

      const currentAudioTime = this.synth.currentTime;
      const currentPlaybackSeconds =
        currentAudioTime - this.playbackStartAudioTime;
      const currentTick = this.tempoMap.secondsToTick(currentPlaybackSeconds);

      // Real-time advance: parse ahead by lookaheadTicks AND resolve any ties/portamentos
      this.parseUntil(currentTick + this.lookaheadTicks);
      this.ensureEventsSorted();

      if (this.isInfiniteLoop) {
        this.pruneOldData(currentTick);
      }

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
          // TODO: 並列化
          // awaitを外せば並列化できるが、SF2InstrumentBankのOggVorbisDecoderの出力が壊れた。要検証
          // そもそも並列化する必要があるかどうかも要検証
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

  /**
   * Restores events and notes from the first loop snapshot,
   * and resets channel generators to the end of the first loop.
   */
  private restoreFirstLoop(): void {
    // 1. Restore events from first loop snapshot (no re-parsing needed!)
    this.events = [...this.firstLoopEvents];
    this.eventsNeedSort = false;
    this.nextEventIndex = 0;

    // 2. Restore notesByChannel from first loop snapshot (no re-parsing needed!)
    for (const ch of this.channels) {
      const saved = this.firstLoopNotesByChannel.get(ch) ?? [];
      this.notesByChannel.set(ch, [...saved]);
    }

    // 3. Reset generators to the end of the first loop
    this.channelStates.clear();
    const { channels, initialKeyShift } = splitMMLChannels(this.mml);

    for (const ch of this.channels) {
      const parser = new MMLChannelParser(
        ch,
        channels[ch],
        this.mml,
        initialKeyShift,
      );
      const generator = parser.nextEvent();
      const nextResult = generator.next();

      this.channelStates.set(ch, {
        channelIndex: ch,
        parser,
        generator,
        nextResult,
        pendingCompound: null,
        isFinished: Boolean(nextResult.done),
        firstInfiniteLoopReached: false,
      });
    }

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
        break;
      }

      const state = this.channelStates.get(selectedCh)!;
      const event = state.nextResult!.value!;

      if (event.type === "loop" && event.isInfinite) {
        state.firstInfiniteLoopReached = true;
        continue;
      }

      state.nextResult = state.generator.next();
      if (state.nextResult.done) {
        state.isFinished = true;
      }
    }

    for (const [ch, state] of this.channelStates) {
      state.firstInfiniteLoopReached = false;
      state.pendingCompound = this.firstLoopPendingCompounds.get(ch) ?? null;
    }

    this.hasPruned = false;
    this.lastPrunedTick = 0;
  }

  /**
   * Prune events and notes older than (currentTick - backBufferTicks)
   * using shift from the front of the active buffers.
   */
  public pruneOldData(currentTick: number): void {
    if (!this.isInfiniteLoop) return;

    const pruneBeforeTick = currentTick - this.backBufferTicks;
    if (pruneBeforeTick <= 0) {
      return;
    }

    if (currentTick - this.lastPrunedTick < this.ticksPerWholeNote) {
      return;
    }
    this.lastPrunedTick = currentTick;

    // 1. Prune this.events from the front using shift
    while (this.events.length > 0) {
      const ev = this.events[0];
      const evEndTick =
        ev.type === "note" ? ev.event.tick + ev.event.duration : ev.tick;

      if (evEndTick < pruneBeforeTick) {
        this.events.shift();
        this.nextEventIndex = Math.max(0, this.nextEventIndex - 1);
        this.hasPruned = true;
      } else {
        break;
      }
    }

    // 2. Prune this.notesByChannel from the front using shift
    for (const [, notes] of this.notesByChannel) {
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
    note.synth = {};

    note.synth.durationSec = this.tempoMap.durationTicksToSeconds(
      note.tick,
      note.duration,
    );
    note.synth.gateDurationSec = this.tempoMap.durationTicksToSeconds(
      note.tick,
      note.gateDuration,
    );

    // Calculate timing in seconds for each segment
    for (const seg of note.segments) {
      seg.startTimeOffsetSec = this.tempoMap.durationTicksToSeconds(
        note.tick,
        seg.tickOffset,
      );
      seg.durationSec = this.tempoMap.durationTicksToSeconds(
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
