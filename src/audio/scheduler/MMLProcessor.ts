/**
 * MML Song Processor
 * Parses MML text across multiple channels, resolves compound notes
 * (ties, slurs, portamentos), and produces unified events and note structures.
 */

import type {
  PostProcessedEvent,
  PostProcessedNote,
  NoteSegment,
} from "../types.js";
import type { MMLEvent, NoteEvent } from "../../parser/types.js";
import {
  MMLChannelParser,
  splitMMLChannels,
  NOTE_NAMES,
} from "../../parser/vmmlParser.js";
import { sbDetuneToCents } from "../utils/conversion.js";
import { ModulationHelper } from "../synth/ModulationHelper.js";
import { TempoMap } from "./TempoMap.js";

export interface PendingCompound {
  startTick: number;
  firstNote: NoteEvent;
  segments: NoteSegment[];
  totalDuration: number;
  lastNote: NoteEvent;
}

export interface ChannelState {
  channelIndex: number;
  parser: MMLChannelParser;
  nextResult: MMLEvent[];
  pendingCompound: PendingCompound | null;
  firstInfiniteLoopReached: boolean;
}

export interface MMLProcessorSnapshot {
  events: PostProcessedEvent[];
  notesByChannel: Map<number, PostProcessedNote[]>;
  channelStates: Map<number, ChannelState>;
  maxTick: number;
  totalDurationSeconds: number;
}

export class MMLProcessor {
  public static readonly ticksPerWholeNote = 192;

  public readonly channels: number[] = [];
  public readonly channelStates: Map<number, ChannelState> = new Map();
  public readonly notesByChannel: Map<number, PostProcessedNote[]> = new Map();
  public events: PostProcessedEvent[] = [];
  public eventsNeedSort: boolean = false;
  public readonly tempoMap: TempoMap;
  public maxTick: number = 0;
  public totalDurationSeconds: number = 0;
  public isInfiniteLoop: boolean = false;
  public allFinished: boolean = false;
  public firstLoopEndTick: number = 0;
  public onError: (e: unknown) => void;

  constructor(mml: string, onError?: (e: unknown) => void) {
    this.onError = onError ?? ((e: unknown) => console.error("MMLProcessor error:", e));
    this.tempoMap = new TempoMap([], MMLProcessor.ticksPerWholeNote);

    const { channels, initialKeyShift } = splitMMLChannels(mml);

    for (let ch = 0; ch < channels.length; ch++) {
      if (channels[ch].trim() !== "") {
        this.channels.push(ch);
        this.notesByChannel.set(ch, []);

        const parser = new MMLChannelParser(
          ch,
          channels[ch],
          mml,
          initialKeyShift
        );
        const nextResult = parser.nextEvent();

        this.channelStates.set(ch, {
          channelIndex: ch,
          parser,
          nextResult,
          pendingCompound: null,
          firstInfiniteLoopReached: false,
        });
      }
    }

    // First pass: parse until all channels reach their first infinite loop or end.
    this.parseFirstPass();
    this.firstLoopEndTick = this.maxTick;
  }

  public static noteString(event: NoteEvent): string {
    return (
      NOTE_NAMES[event.baseNoteIndex] +
      (event.totalAccidentials > 0
        ? "#".repeat(event.totalAccidentials)
        : "b".repeat(-event.totalAccidentials)) +
      (event.duration > 0
        ? event.noteValue.toString() + ".".repeat(event.totalDots)
        : "") +
      (event.isTie ? "&" : "") +
      (event.isPortamento ? "_" : "")
    );
  }

  public cloneChannelState(state: ChannelState): ChannelState {
    return {
      channelIndex: state.channelIndex,
      parser: state.parser.clone(),
      nextResult: structuredClone(state.nextResult),
      pendingCompound: structuredClone(state.pendingCompound),
      firstInfiniteLoopReached: state.firstInfiniteLoopReached,
    };
  }

  public createSnapshot(): MMLProcessorSnapshot {
    const notesByChannel = new Map<number, PostProcessedNote[]>();
    for (const [ch, notes] of this.notesByChannel) {
      notesByChannel.set(ch, [...notes]);
    }
    const channelStates = new Map<number, ChannelState>();
    for (const [ch, state] of this.channelStates) {
      channelStates.set(ch, this.cloneChannelState(state));
    }
    return {
      events: [...this.events],
      notesByChannel,
      channelStates,
      maxTick: this.maxTick,
      totalDurationSeconds: this.totalDurationSeconds,
    };
  }

  public restoreSnapshot(snapshot: MMLProcessorSnapshot): void {
    this.events = [...snapshot.events];
    this.eventsNeedSort = false;
    this.notesByChannel.clear();
    for (const [ch, notes] of snapshot.notesByChannel) {
      this.notesByChannel.set(ch, [...notes]);
    }
    this.channelStates.clear();
    for (const [ch, state] of snapshot.channelStates) {
      this.channelStates.set(ch, this.cloneChannelState(state));
    }
    this.maxTick = snapshot.maxTick;
    this.totalDurationSeconds = snapshot.totalDurationSeconds;
  }

  public ensureEventsSorted(): void {
    if (!this.eventsNeedSort) return;
    this.events.sort((a, b) => {
      const tickA = a.type === "note" ? a.event.tick : a.tick;
      const tickB = b.type === "note" ? b.event.tick : b.tick;
      return tickA - tickB;
    });
    this.eventsNeedSort = false;
  }

  /**
   * Initial pass: advances all channels until they finish or encounter their first infinite loop.
   */
  public parseFirstPass(): void {
    while (true) {
      let minTick = Infinity;
      let selectedCh = -1;

      for (const [ch, state] of this.channelStates) {
        if (
          state.parser.isFinished ||
          state.firstInfiniteLoopReached ||
          state.nextResult.length === 0
        ) {
          continue;
        }
        const tick = state.nextResult[0].tick;
        if (tick < minTick) {
          minTick = tick;
          selectedCh = ch;
        }
      }

      if (selectedCh === -1) {
        break;
      }

      const state = this.channelStates.get(selectedCh)!;
      const events = state.nextResult;
      if (events[0].type === "loop" && events[0].isInfinite) {
        this.isInfiniteLoop = true;
        state.firstInfiniteLoopReached = true;
        continue;
      }

      state.nextResult = state.parser.nextEvent();

      for (const event of events) {
        this.processEvent(state, event);
      }
    }

    if (!this.isInfiniteLoop) {
      this.flushAllChannels();
      this.allFinished = true;
    } else {
      for (const [, state] of this.channelStates) {
        state.firstInfiniteLoopReached = false;
      }
    }

    this.ensureEventsSorted();
    this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
  }

  /**
   * Parse events from channels until all active channels advance past targetTick,
   * and any pending ties/portamentos are fully resolved.
   */
  public parseUntil(targetTick: number): void {
    if (this.allFinished) return;

    let iterations = 0;
    const maxIterations = 20000;

    while (iterations++ < maxIterations) {
      let minTick = Infinity;
      let selectedCh = -1;

      for (const [ch, state] of this.channelStates) {
        if (state.parser.isFinished || state.nextResult.length === 0) {
          continue;
        }
        const tick = state.nextResult[0].tick;
        if (tick < minTick) {
          minTick = tick;
          selectedCh = ch;
        }
      }

      if (selectedCh === -1) {
        this.flushAllChannels();
        this.allFinished = true;
        if (!this.isInfiniteLoop) {
          this.totalDurationSeconds = this.tempoMap.tickToSeconds(this.maxTick);
        }
        break;
      }

      if (minTick > targetTick) {
        let hasPending = false;
        for (const [, state] of this.channelStates) {
          if (state.parser.isFinished) continue;
          if (state.pendingCompound) {
            hasPending = true;
            break;
          }
        }
        if (!hasPending) {
          break;
        }
      }

      const state = this.channelStates.get(selectedCh)!;
      const events = state.nextResult;
      state.nextResult = state.parser.nextEvent();

      for (const event of events) {
        this.processEvent(state, event);
      }
    }

    if (this.eventsNeedSort) {
      this.ensureEventsSorted();
    }
  }

  public processEvent(state: ChannelState, event: MMLEvent): void {
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

    if (event.type === "program") {
      this.events.push({
        type: "program",
        tick: event.tick,
        channel: event.channel,
        program: event.program,
      });
      this.eventsNeedSort = true;
      return;
    }

    if (event.type === "pitchBend") {
      this.events.push({
        type: "pitchBend",
        tick: event.tick,
        channel: event.channel,
        value: event.value,
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
      } else if (event.controller === 10) {
        this.events.push({
          type: "pan",
          tick: event.tick,
          channel: event.channel,
          pan: event.value,
        });
      } else {
        this.events.push({
          type: "control",
          tick: event.tick,
          channel: event.channel,
          controller: event.controller,
          value: event.value,
        });
      }
      this.eventsNeedSort = true;
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
      if (event.error) {
        this.onError(event.error);
      }
      return;
    }

    if (event.type === "note") {
      const noteEnd = event.tick + event.duration;
      if (noteEnd > this.maxTick) {
        this.maxTick = noteEnd;
      }

      // Compound note (tie, slur, portamento) pipeline
      const pending = state.pendingCompound;

      if (pending) {
        // Resolve portamento target for previous portamento segment if any
        const lastSeg = pending.segments[pending.segments.length - 1];
        if (
          pending.lastNote.isPortamento &&
          lastSeg.portamentoTargetNote === undefined
        ) {
          lastSeg.portamentoTargetNote = event.noteNumber;
          lastSeg.portamentoTargetDetuneCents = sbDetuneToCents(event.detune);
          lastSeg.portamentoTargetNoteStr = MMLProcessor.noteString(event);
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
          lastSeg.noteStr += MMLProcessor.noteString(event);
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
              noteStr: MMLProcessor.noteString(event),
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
              noteStr: MMLProcessor.noteString(event),
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

  public flushChannel(state: ChannelState): void {
    if (state.pendingCompound) {
      this.emitCompoundNote(state.pendingCompound);
      state.pendingCompound = null;
    }
  }

  public flushAllChannels(): void {
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
    const gateDuration = Math.max(
      1,
      Math.round(compound.totalDuration * gateRatio)
    );

    const initialSeg = compound.segments[0];

    const postProcessedNote: PostProcessedNote = {
      tick: compound.startTick,
      duration: compound.totalDuration,
      gateDuration,
      channel: first.channel,
      noteNumber: initialSeg.noteNumber,
      velocity: initialSeg.velocity,
      volume: initialSeg.volume,
      pan: initialSeg.pan,
      program: first.program,
      detuneCents: initialSeg.detuneCents,
      envelope: first.envelope,
      modulation: first.modulation,
      segments: compound.segments,
      synth: {
        ...(first.modulation.enabled
          ? (() => {
              const m = new ModulationHelper(first.modulation);
              return m.enabled ? { modulation: m } : {};
            })()
          : {}),
      },
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
      velocity: n.velocity,
      volume: n.volume,
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
          noteStr: MMLProcessor.noteString(n),
          octave: n.baseOctave,
        },
      ],
      synth: {
        ...(n.modulation.enabled
          ? (() => {
              const m = new ModulationHelper(n.modulation);
              return m.enabled ? { modulation: m } : {};
            })()
          : {}),
      },
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
}
