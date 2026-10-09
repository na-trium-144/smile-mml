/**
 * Track Processor: Preprocesses parsed MML events for audio playback.
 * Performs 1-note lookahead for portamento target resolution and merges ties.
 */

import type { MMLEvent, NoteEvent } from '../../parser/types.js';
import type { PreparedEvent, PreparedNote } from '../types.js';
import { sbDetuneToCents } from '../utils/conversion.js';

/**
 * Preprocess MML events into chronologically ordered PreparedEvents
 * with resolved portamento targets and merged ties.
 */
export function preparePlaybackEvents(events: Iterable<MMLEvent>): PreparedEvent[] {
  // Collect raw notes and channel control events per channel
  const notesByChannel: Map<number, NoteEvent[]> = new Map();
  const tempoAndOtherEvents: PreparedEvent[] = [];

  for (const ev of events) {
    if (ev.type === 'tempo') {
      tempoAndOtherEvents.push({
        type: 'tempo',
        tick: ev.tick,
        bpm: ev.bpm,
      });
    } else if (ev.type === 'note') {
      let list = notesByChannel.get(ev.channel);
      if (!list) {
        list = [];
        notesByChannel.set(ev.channel, list);
      }
      list.push(ev);
    } else if (ev.type === 'control') {
      if (ev.controller === 7) {
        // @V volume
        tempoAndOtherEvents.push({
          type: 'volume',
          tick: ev.tick,
          channel: ev.channel,
          volume: ev.value,
        });
      } else if (ev.controller === 10) {
        // P pan
        tempoAndOtherEvents.push({
          type: 'pan',
          tick: ev.tick,
          channel: ev.channel,
          pan: ev.value,
        });
      }
    }
  }

  const preparedNotes: PreparedNote[] = [];

  // Process each channel independently
  for (const [channel, rawNotes] of notesByChannel.entries()) {
    // 1. Resolve Portamento Targets with 1-note lookahead:
    // If a note has isPortamento: true, its glide target is the noteNumber of the immediately following note
    for (let i = 0; i < rawNotes.length; i++) {
      if (rawNotes[i].isPortamento && i + 1 < rawNotes.length) {
        rawNotes[i].portamentoTargetNote = rawNotes[i + 1].noteNumber;
      }
    }

    // 2. Merge Same-Pitch Ties and handle portamento combination:
    // e.g. C4&C4 -> single note with duration = C4 + C4
    // C4&C4_E -> (C4&C4)_E with target E
    const merged: NoteEvent[] = [];

    for (let i = 0; i < rawNotes.length; i++) {
      const curr = rawNotes[i];
      const prev = merged.length > 0 ? merged[merged.length - 1] : null;

      // Same-pitch tie: contiguous ticks and identical pitch
      if (
        prev &&
        (prev.isTie || curr.isTie) &&
        prev.noteNumber === curr.noteNumber &&
        prev.tick + prev.duration === curr.tick
      ) {
        prev.duration += curr.duration;
        prev.gateDuration += curr.gateDuration;
        prev.isTie = curr.isTie;
        if (curr.isPortamento) {
          prev.isPortamento = true;
          prev.portamentoTargetNote = curr.portamentoTargetNote;
        }
      } else {
        merged.push({ ...curr });
      }
    }

    // 3. Convert to PreparedNote structures, skipping 0-duration portamento targets (e.g. the 'E' in 'C4_E')
    for (let i = 0; i < merged.length; i++) {
      const n = merged[i];
      // Skip notes with duration <= 0 that were just targets for portamento
      if (n.duration <= 0) {
        continue;
      }

      // Check if this note was preceded by a different-pitch tie (slur)
      let isSlur = false;
      if (i > 0) {
        const prev = merged[i - 1];
        if (prev.isTie && prev.tick + prev.duration === n.tick && prev.noteNumber !== n.noteNumber) {
          isSlur = true;
        }
      }

      preparedNotes.push({
        tick: n.tick,
        duration: n.duration,
        gateDuration: Math.max(1, n.gateDuration),
        channel,
        noteNumber: n.noteNumber,
        velocity: n.volume, // In SmileBASIC 3, V is velocity (stored in NoteEvent.volume)
        volume: n.velocity, // In SmileBASIC 3, @V is channel volume (stored in NoteEvent.velocity)
        pan: n.pan,
        program: n.program,
        detuneCents: sbDetuneToCents(n.detune),
        envelope: n.envelope,
        modulation: n.modulation,
        isPortamento: Boolean(n.isPortamento && n.portamentoTargetNote !== undefined),
        portamentoTargetNote: n.portamentoTargetNote,
        isSlur,
      });
    }
  }

  // Combine note events and other events, sorted chronologically by tick
  const allEvents: PreparedEvent[] = [
    ...tempoAndOtherEvents,
    ...preparedNotes.map((note) => ({ type: 'note' as const, event: note })),
  ];

  allEvents.sort((a, b) => {
    const tickA = a.type === 'note' ? a.event.tick : a.tick;
    const tickB = b.type === 'note' ? b.event.tick : b.tick;
    if (tickA !== tickB) return tickA - tickB;
    // Tempo and control changes take priority over note on at the same tick
    if (a.type !== 'note' && b.type === 'note') return -1;
    if (a.type === 'note' && b.type !== 'note') return 1;
    return 0;
  });

  return allEvents;
}
