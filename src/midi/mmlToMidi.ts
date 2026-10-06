/**
 * MML to Standard MIDI File Converter
 * Uses the MML parser generator, handles tie merging, and recreates portamento with pitch bends.
 */

import { parseMML } from '../parser/vmmlParser.js';
import type { NoteEvent, ParseOptions } from '../parser/types.js';
import { MidiFile, MidiTrack } from './smf.js';

export interface MmlToMidiOptions extends ParseOptions {
  /**
   * Target MIDI ticks per quarter note (default: 480)
   */
  midiTpqn?: number;
  /**
   * Title / Song Name for conductor track
   */
  songTitle?: string;
  /**
   * If true, maps drum programs (128, 129, etc.) to MIDI channel 9 (default: true)
   */
  mapDrumsToChannel9?: boolean;
  /**
   * Pitch bend range in semitones for portamento (default: 24)
   */
  pitchBendRange?: number;
}

const DRUM_PROGRAMS = new Set([128, 129, 130, 265, 267, 281, 366]);

interface InternalNote {
  tick: number;
  duration: number;
  noteNumber: number;
  velocity: number;
  volume: number;
  program: number;
  isPortamento?: boolean;
  portamentoTargetNote?: number;
  isTie?: boolean;
}

interface OtherChannelEvent {
  tick: number;
  type: 'program' | 'control' | 'pitchBend';
  program?: number;
  controller?: number;
  value?: number;
}

export function convertMmlToMidi(mml: string, options?: MmlToMidiOptions): Uint8Array {
  const tpqn = options?.midiTpqn ?? 480;
  const wholeNoteTicks = options?.ticksPerWholeNote ?? 192;
  const quarterNoteTicks = wholeNoteTicks / 4;
  // Scale factor to convert parser ticks to MIDI ticks: e.g. 480 / 48 = 10
  const tickScale = tpqn / quarterNoteTicks;
  const bendRange = options?.pitchBendRange ?? 24;

  const midiFile = new MidiFile(tpqn);

  // Track 0: Conductor Track (Tempo & Time Signature)
  const conductorTrack = midiFile.addTrack(new MidiTrack(options?.songTitle || 'Conductor Track'));
  conductorTrack.addTimeSignature(0, 4, 4);

  // Per-channel collections
  const rawNotesByChannel: Map<number, NoteEvent[]> = new Map();
  const otherEventsByChannel: Map<number, OtherChannelEvent[]> = new Map();

  const getNotesList = (ch: number): NoteEvent[] => {
    let list = rawNotesByChannel.get(ch);
    if (!list) {
      list = [];
      rawNotesByChannel.set(ch, list);
    }
    return list;
  };

  const getOtherList = (ch: number): OtherChannelEvent[] => {
    let list = otherEventsByChannel.get(ch);
    if (!list) {
      list = [];
      otherEventsByChannel.set(ch, list);
    }
    return list;
  };

  let hasTempoEvent = false;

  // Run MML generator with stopOnInfiniteLoop enabled
  const eventGenerator = parseMML(mml, {
    stopOnInfiniteLoop: true,
    keyShift: options?.keyShift,
    tempoScale: options?.tempoScale,
    ticksPerWholeNote: wholeNoteTicks,
  });

  for (const event of eventGenerator) {
    if (event.type === 'tempo') {
      const midiTick = Math.round(event.tick * tickScale);
      conductorTrack.addTempo(midiTick, event.bpm);
      hasTempoEvent = true;
    } else if (event.type === 'note') {
      getNotesList(event.channel).push(event);
    } else if (event.type === 'program') {
      getOtherList(event.channel).push({
        tick: event.tick,
        type: 'program',
        program: event.program,
      });
    } else if (event.type === 'control') {
      getOtherList(event.channel).push({
        tick: event.tick,
        type: 'control',
        controller: event.controller,
        value: event.value,
      });
    } else if (event.type === 'pitchBend') {
      getOtherList(event.channel).push({
        tick: event.tick,
        type: 'pitchBend',
        value: event.value,
      });
    }
  }

  // Default tempo (120 BPM) if no tempo event was encountered
  if (!hasTempoEvent) {
    conductorTrack.addTempo(0, 120);
  }

  // Get all active channels in ascending order
  const allChannels = new Set([
    ...rawNotesByChannel.keys(),
    ...otherEventsByChannel.keys(),
  ]);
  const sortedChannels = Array.from(allChannels).sort((a, b) => a - b);

  for (const ch of sortedChannels) {
    const track = midiFile.addTrack(new MidiTrack(`Channel ${ch}`));
    const rawNotes = rawNotesByChannel.get(ch) || [];
    const otherEvents = otherEventsByChannel.get(ch) || [];

    // Determine target MIDI channel (Ch 9 for drums if applicable)
    let midiChannel = ch;
    const isDrum = rawNotes.some((n) => DRUM_PROGRAMS.has(n.program));
    if (options?.mapDrumsToChannel9 !== false && isDrum) {
      midiChannel = 9; // MIDI Drum Channel
    }

    // Set Pitch Bend Sensitivity (RPN) at tick 0
    track.addPitchBendSensitivity(0, midiChannel, bendRange);

    // 1. Resolve Portamento Targets:
    // If a note has isPortamento: true, its target is the noteNumber of the immediately following note
    for (let i = 0; i < rawNotes.length; i++) {
      if (rawNotes[i].isPortamento && i + 1 < rawNotes.length) {
        rawNotes[i].portamentoTargetNote = rawNotes[i + 1].noteNumber;
      }
    }

    // 2. Merge Same-Pitch Ties:
    // When curr isTie is true and has the SAME pitch as prev and is contiguous:
    // - Merge curr into prev (extend prev.duration)
    // - If curr has portamento, prev inherits it
    // When curr has a DIFFERENT pitch (e.g. C&D_E):
    // - Do not merge (remains separate notes). C plays normally, D slides to E.
    const mergedNotes: InternalNote[] = [];

    for (let i = 0; i < rawNotes.length; i++) {
      const curr = rawNotes[i];
      const prev = mergedNotes.length > 0 ? mergedNotes[mergedNotes.length - 1] : null;

      if (
        prev &&
        (prev.isTie || curr.isTie) &&
        prev.noteNumber === curr.noteNumber &&
        prev.tick + prev.duration === curr.tick
      ) {
        // Merge into previous note
        prev.duration += curr.duration;
        prev.isTie = curr.isTie;
        if (curr.isPortamento) {
          prev.isPortamento = true;
          prev.portamentoTargetNote = curr.portamentoTargetNote;
        }
      } else {
        mergedNotes.push({
          tick: curr.tick,
          duration: curr.duration,
          noteNumber: curr.noteNumber,
          velocity: curr.velocity,
          volume: curr.volume,
          program: curr.program,
          isPortamento: curr.isPortamento,
          portamentoTargetNote: curr.portamentoTargetNote,
          isTie: curr.isTie,
        });
      }
    }

    // 3. Emit Notes and Portamento Pitch Bends:
    for (const note of mergedNotes) {
      // If duration is 0 (portamento target without length e.g. C4_E),
      // do not output a MIDI Note On/Off; it only served as the target of the previous portamento.
      if (note.duration <= 0) {
        continue;
      }

      const midiStartTick = Math.round(note.tick * tickScale);
      const midiDuration = Math.max(1, Math.round(note.duration * tickScale));
      const effectiveVelocity = Math.max(
        1,
        Math.min(127, Math.round((note.velocity * note.volume) / 127))
      );

      // Note On
      track.addEvent(midiStartTick, [0x90 | (midiChannel & 0x0f), note.noteNumber, effectiveVelocity]);
      // Note Off
      track.addEvent(midiStartTick + midiDuration, [0x80 | (midiChannel & 0x0f), note.noteNumber, 0]);

      // Portamento: interpolate pitch bend from start to end of this note
      if (note.isPortamento && note.portamentoTargetNote !== undefined) {
        const fromNote = note.noteNumber;
        const toNote = note.portamentoTargetNote;
        const semitoneDelta = toNote - fromNote;

        // Number of intermediate pitch bend steps (approx every 12-24 MIDI ticks)
        const stepInterval = Math.max(12, Math.round(midiDuration / 24));
        const numSteps = Math.max(2, Math.floor(midiDuration / stepInterval));

        for (let s = 0; s <= numSteps; s++) {
          const t = Math.min(midiDuration, Math.round((s / numSteps) * midiDuration));
          const progress = t / midiDuration; // 0.0 to 1.0
          const semitones = semitoneDelta * progress;
          // Calculate pitch bend value: -8192 to 8191
          const bendVal = Math.round((semitones / bendRange) * 8191);
          track.addPitchBend(midiStartTick + t, midiChannel, bendVal);
        }

        // Reset pitch bend back to center (0) at the end of the note
        track.addPitchBend(midiStartTick + midiDuration, midiChannel, 0);
      }
    }

    // 4. Emit Other Control/Program Events:
    for (const ev of otherEvents) {
      const midiTick = Math.round(ev.tick * tickScale);
      if (ev.type === 'program' && ev.program !== undefined) {
        let progChannel = midiChannel;
        if (options?.mapDrumsToChannel9 !== false && DRUM_PROGRAMS.has(ev.program)) {
          progChannel = 9;
        }
        track.addProgramChange(midiTick, progChannel, ev.program);
      } else if (ev.type === 'control' && ev.controller !== undefined && ev.value !== undefined) {
        track.addControlChange(midiTick, midiChannel, ev.controller, ev.value);
      } else if (ev.type === 'pitchBend' && ev.value !== undefined) {
        track.addPitchBend(midiTick, midiChannel, ev.value);
      }
    }
  }

  return midiFile.toBytes();
}
