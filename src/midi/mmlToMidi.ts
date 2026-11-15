/**
 * MML to Standard MIDI File Converter
 * Uses MMLProcessor to unify event processing, handling ties, slurs, and portamentos
 * via MIDI pitch bends.
 */

import { MMLProcessor } from '../audio/scheduler/MMLProcessor.js';
import type { PostProcessedEvent, PostProcessedNote } from '../audio/types.js';
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
   * If true, maps drum programs (128, 129, etc.) to MIDI channel 9 (default: true)
   */
  mapDrumsToChannel9?: boolean;
  /**
   * Default pitch bend range in semitones (default: 24)
   */
  pitchBendRange?: number;
}

const DRUM_PROGRAMS = new Set([128, 129, 130, 265, 267, 281, 366]);

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

  // Iterate over all active channels in the processor
  for (const ch of processor.channels) {
    const track = midiFile.addTrack(new MidiTrack(`Channel ${ch}`));
    const notes: PostProcessedNote[] = processor.notesByChannel.get(ch) || [];

    // Filter channel non-note events
    const channelEvents = processor.events.filter(
      (ev): ev is Exclude<PostProcessedEvent, { type: 'note' } | { type: 'tempo' }> =>
        ev.type !== 'tempo' && ev.type !== 'note' && (ev as { channel?: number }).channel === ch
    );

    // Determine target MIDI channel (Ch 9 for drums if applicable, wrap to 0-15)
    let midiChannel = ch % 16;
    const isDrum =
      notes.some((n) => DRUM_PROGRAMS.has(n.program)) ||
      channelEvents.some((e) => e.type === 'program' && DRUM_PROGRAMS.has(e.program));
    if (options?.mapDrumsToChannel9 !== false && isDrum) {
      midiChannel = 9; // MIDI Drum Channel
    }

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
        let progChannel = midiChannel;
        if (options?.mapDrumsToChannel9 !== false && DRUM_PROGRAMS.has(ev.program)) {
          progChannel = 9;
        }
        track.addProgramChange(midiTick, progChannel, ev.program);
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

      const midiStartTick = Math.round(note.tick * tickScale);
      const midiDuration = Math.max(1, Math.round(note.gateDuration * tickScale));
      const effectiveVelocity = Math.max(
        1,
        Math.min(127, Math.round((note.velocity * note.volume) / 127))
      );

      // Single Note On at the beginning of the compound note
      track.addEvent(midiStartTick, [0x90 | (midiChannel & 0x0f), note.noteNumber, effectiveVelocity]);
      // Single Note Off at gate duration
      track.addEvent(midiStartTick + midiDuration, [0x80 | (midiChannel & 0x0f), note.noteNumber, 0]);

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
