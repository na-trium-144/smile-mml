/**
 * MML to Standard MIDI File Converter
 * Uses MMLProcessor to unify event processing, handling ties, slurs, and portamentos
 * via MIDI pitch bends.
 */

import { MMLProcessor } from '../audio/scheduler/MMLProcessor.js';
import type { PostProcessedEvent, PostProcessedNote } from '../audio/types.js';
import { SF2InstrumentBank } from '../audio/banks/SF2InstrumentBank.js';
import { BasicWaveBank } from '../audio/banks/BasicWaveBank.js';
import { MidiFile, MidiTrack } from './smf.js';

export interface MmlToMidiOptions {
  /**
   * Target MIDI ticks per quarter note (default: 480)
   */
  midiTpqn?: number;
  /**
   * Title / Song Name for conductor track
   */
  songTitle?: string;
  /**
   * If true, maps drum programs (128-143, 265, 267, 281, 366, 128000, etc.) to MIDI channel 9 (default: true)
   */
  mapDrumsToChannel9?: boolean;
  /**
   * Default pitch bend range in semitones (default: 24)
   */
  pitchBendRange?: number;
}

export interface ResolvedMidiProgram {
  midiProgram: number;
  isDrum: boolean;
  keyShift: number;
}

/**
 * Resolves an MML program number into a standard MIDI program (0-127),
 * drum flag, and keyShift.
 * - Checks BasicWaveBank first (returns midiProgram: 80 or 81, and optional keyShift).
 * - Otherwise delegates to SF2InstrumentBank.resolveBankPreset(program).
 */
export function resolveMidiProgram(program: number): ResolvedMidiProgram {
  // 1. BasicWaveBank
  const basicWave = BasicWaveBank.findProgram(program);
  if (basicWave) {
    return {
      midiProgram: basicWave.midiProgram ?? 80,
      isDrum: false,
      keyShift: basicWave.keyShift ?? 0,
    };
  }

  // 2. SF2InstrumentBank.resolveBankPreset
  const res = SF2InstrumentBank.resolveBankPreset(program);
  const isDrum =
    (res.bank !== undefined && res.bank >= 120) ||
    (program >= 128 && program <= 143) ||
    program === 265 ||
    program === 267 ||
    program === 281 ||
    program === 366;

  return {
    midiProgram: res.preset % 128,
    isDrum,
    keyShift: res.keyShift ?? 0,
  };
}

/**
 * Checks if a program number corresponds to a drum kit.
 */
export function isDrumProgram(program: number): boolean {
  return resolveMidiProgram(program).isDrum;
}

export function convertMmlToMidi(mml: string, options?: MmlToMidiOptions): Uint8Array {
  const tpqn = options?.midiTpqn ?? 480;
  // MMLProcessor ticks per whole note is 192, so quarter note is 48 ticks
  const quarterNoteTicks = MMLProcessor.ticksPerWholeNote / 4;
  const tickScale = tpqn / quarterNoteTicks;
  const defaultBendRange = options?.pitchBendRange ?? 24;

  const processor = new MMLProcessor(mml);
  const midiFile = new MidiFile(tpqn);

  // Extract title from MML {TITLE=...} if not explicitly passed in options
  const titleMatch = mml.match(/\{TITLE=(.*?)\}/i);
  const songTitle = options?.songTitle || (titleMatch ? titleMatch[1].trim() : '') || 'Conductor Track';

  // Track 0: Conductor Track (Tempo & Time Signature)
  const conductorTrack = midiFile.addTrack(new MidiTrack(songTitle));
  conductorTrack.addTimeSignature(0, 4, 4);

  let hasTempoEvent = false;
  for (const ev of processor.events) {
    if (ev.type === 'tempo') {
      const midiTick = Math.round(ev.tick * tickScale);
      conductorTrack.addTempo(midiTick, ev.bpm);
      hasTempoEvent = true;
    }
  }

  if (!hasTempoEvent) {
    conductorTrack.addTempo(0, 120);
  }

  // Map each channel to a MIDI channel (avoid assigning non-drum channels to Ch 9)
  const nonDrumMidiChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let nonDrumIndex = 0;
  const channelMidiMap = new Map<number, number>();

  for (const ch of processor.channels) {
    const notes = processor.notesByChannel.get(ch) || [];
    const channelProgEvents = processor.events.filter(
      (ev) => ev.type === 'program' && (ev as { channel?: number }).channel === ch
    );
    const isDrum =
      notes.some((n) => isDrumProgram(n.program)) ||
      channelProgEvents.some((e) => e.type === 'program' && isDrumProgram(e.program));

    if (options?.mapDrumsToChannel9 !== false && isDrum) {
      channelMidiMap.set(ch, 9);
    } else if (options?.mapDrumsToChannel9 !== false) {
      channelMidiMap.set(ch, nonDrumMidiChannels[nonDrumIndex % nonDrumMidiChannels.length]);
      nonDrumIndex++;
    } else {
      channelMidiMap.set(ch, ch % 16);
    }
  }

  // Iterate over all active channels in the processor
  for (const ch of processor.channels) {
    const track = midiFile.addTrack(new MidiTrack(`Channel ${ch}`));
    const notes: PostProcessedNote[] = processor.notesByChannel.get(ch) || [];

    // Filter channel non-note events
    const channelEvents = processor.events.filter(
      (ev): ev is Exclude<PostProcessedEvent, { type: 'note' } | { type: 'tempo' }> =>
        ev.type !== 'tempo' && ev.type !== 'note' && (ev as { channel?: number }).channel === ch
    );

    const midiChannel = channelMidiMap.get(ch) ?? (ch % 16);

    // Determine required pitch bend range for this track
    let maxSemitoneDelta = defaultBendRange;
    for (const note of notes) {
      const baseNoteNumber = note.noteNumber;
      for (const seg of note.segments) {
        const segDelta = Math.abs((seg.noteNumber - baseNoteNumber) + seg.detuneCents / 100);
        if (segDelta > maxSemitoneDelta) {
          maxSemitoneDelta = Math.ceil(segDelta);
        }
        if (seg.isPortamento && seg.portamentoTargetNote !== undefined) {
          const targetDelta = Math.abs(
            (seg.portamentoTargetNote - baseNoteNumber) + (seg.portamentoTargetDetuneCents ?? 0) / 100
          );
          if (targetDelta > maxSemitoneDelta) {
            maxSemitoneDelta = Math.ceil(targetDelta);
          }
        }
      }
    }
    const bendRange = Math.min(127, Math.max(defaultBendRange, maxSemitoneDelta));

    // Set Pitch Bend Sensitivity (RPN 0) at tick 0
    track.addPitchBendSensitivity(0, midiChannel, bendRange);

    // 1. Emit non-note events (program, volume, pan, pitchBend, control)
    for (const ev of channelEvents) {
      const midiTick = Math.round(ev.tick * tickScale);
      if (ev.type === 'program') {
        const resolved = resolveMidiProgram(ev.program);
        let progChannel = midiChannel;
        if (options?.mapDrumsToChannel9 !== false && resolved.isDrum) {
          progChannel = 9;
        }
        track.addProgramChange(midiTick, progChannel, resolved.midiProgram);
      } else if (ev.type === 'volume') {
        track.addControlChange(midiTick, midiChannel, 7, ev.volume);
      } else if (ev.type === 'pan') {
        track.addControlChange(midiTick, midiChannel, 10, ev.pan);
      } else if (ev.type === 'pitchBend') {
        track.addPitchBend(midiTick, midiChannel, ev.value);
      } else if (ev.type === 'control') {
        track.addControlChange(midiTick, midiChannel, ev.controller, ev.value);
      }
    }

    // 2. Emit notes and their pitch bend automation (slurs, portamentos, detune)
    for (const note of notes) {
      if (note.duration <= 0) continue;

      const resolved = resolveMidiProgram(note.program);
      const keyShift = resolved.keyShift;

      const midiStartTick = Math.round(note.tick * tickScale);
      const midiDuration = Math.max(1, Math.round(note.gateDuration * tickScale));
      const velocity = Math.max(1, Math.min(127, note.velocity));

      const shiftedNoteNumber = Math.max(0, Math.min(127, note.noteNumber + keyShift));

      // Single Note On at the beginning of the compound note
      track.addEvent(midiStartTick, [0x90 | (midiChannel & 0x0f), shiftedNoteNumber, velocity]);
      // Single Note Off at gate duration
      track.addEvent(midiStartTick + midiDuration, [0x80 | (midiChannel & 0x0f), shiftedNoteNumber, 0]);

      let hadPitchBend = false;
      const baseNoteNumber = note.noteNumber;

      for (const seg of note.segments) {
        const segStartTick = Math.round((note.tick + seg.tickOffset) * tickScale);
        const segDurationTicks = Math.max(1, Math.round(seg.durationTicks * tickScale));

        const startDelta = (seg.noteNumber - baseNoteNumber) + seg.detuneCents / 100;

        if (seg.isPortamento && seg.portamentoTargetNote !== undefined) {
          hadPitchBend = true;
          const targetDelta =
            (seg.portamentoTargetNote - baseNoteNumber) + (seg.portamentoTargetDetuneCents ?? 0) / 100;

          // Number of intermediate pitch bend steps (approx every 12 MIDI ticks)
          const stepInterval = Math.max(12, Math.round(segDurationTicks / 24));
          const numSteps = Math.max(2, Math.floor(segDurationTicks / stepInterval));

          for (let s = 0; s <= numSteps; s++) {
            const t = Math.min(segDurationTicks, Math.round((s / numSteps) * segDurationTicks));
            const progress = t / segDurationTicks;
            const currentDelta = startDelta + (targetDelta - startDelta) * progress;
            const bendVal = Math.round((currentDelta / bendRange) * 8191);
            track.addPitchBend(segStartTick + t, midiChannel, bendVal);
          }
        } else {
          // Slur pitch shift or detune
          if (startDelta !== 0 || hadPitchBend) {
            hadPitchBend = true;
            const bendVal = Math.round((startDelta / bendRange) * 8191);
            track.addPitchBend(segStartTick, midiChannel, bendVal);
          }
        }
      }

      // Reset pitch bend back to center (0) after Note Off if pitch bend was used
      if (hadPitchBend) {
        track.addPitchBend(midiStartTick + midiDuration, midiChannel, 0);
      }
    }
  }

  return midiFile.toBytes();
}
