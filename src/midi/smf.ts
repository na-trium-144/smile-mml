/**
 * Standard MIDI File (SMF Format 1) Writer
 * Lightweight, zero-dependency MIDI binary generator.
 */

export interface MidiRawEvent {
  tick: number; // Absolute tick
  data: number[]; // Raw event bytes (without delta-time)
}

export class MidiTrack {
  public name: string;
  public events: MidiRawEvent[] = [];

  constructor(name: string = '') {
    this.name = name;
  }

  public addEvent(tick: number, data: number[]): void {
    this.events.push({ tick, data });
  }

  public addNote(
    startTick: number,
    duration: number,
    channel: number,
    noteNumber: number,
    velocity: number
  ): void {
    const ch = channel & 0x0f;
    const note = Math.max(0, Math.min(127, noteNumber));
    const vel = Math.max(1, Math.min(127, velocity));

    // Note On
    this.addEvent(startTick, [0x90 | ch, note, vel]);
    // Note Off (using Note On with velocity 0 or Note Off 0x80)
    this.addEvent(startTick + duration, [0x80 | ch, note, 0]);
  }

  public addProgramChange(tick: number, channel: number, program: number): void {
    const ch = channel & 0x0f;
    const prog = Math.max(0, Math.min(127, program % 128));
    this.addEvent(tick, [0xc0 | ch, prog]);
  }

  public addControlChange(tick: number, channel: number, controller: number, value: number): void {
    const ch = channel & 0x0f;
    const ctrl = Math.max(0, Math.min(127, controller));
    const val = Math.max(0, Math.min(127, value));
    this.addEvent(tick, [0xb0 | ch, ctrl, val]);
  }

  public addPitchBend(tick: number, channel: number, value: number): void {
    const ch = channel & 0x0f;
    // value: -8192 to 8191 -> 0 to 16383 (center 8192)
    const clamped = Math.max(-8192, Math.min(8191, value));
    const normalized = clamped + 8192;
    const lsb = normalized & 0x7f;
    const msb = (normalized >> 7) & 0x7f;
    this.addEvent(tick, [0xe0 | ch, lsb, msb]);
  }

  public addPitchBendSensitivity(tick: number, channel: number, semitones: number = 24): void {
    const ch = channel & 0x0f;
    const semi = Math.max(1, Math.min(127, semitones));
    // RPN 0,0: Pitch Bend Sensitivity
    this.addEvent(tick, [0xb0 | ch, 101, 0]);
    this.addEvent(tick, [0xb0 | ch, 100, 0]);
    this.addEvent(tick, [0xb0 | ch, 6, semi]);
    this.addEvent(tick, [0xb0 | ch, 38, 0]);
    // Reset RPN
    this.addEvent(tick, [0xb0 | ch, 101, 127]);
    this.addEvent(tick, [0xb0 | ch, 100, 127]);
  }

  public addTempo(tick: number, bpm: number): void {
    const safeBpm = Math.max(1, Math.min(1000, bpm));
    const microsecondsPerQuarter = Math.round(60_000_000 / safeBpm);
    const t0 = (microsecondsPerQuarter >> 16) & 0xff;
    const t1 = (microsecondsPerQuarter >> 8) & 0xff;
    const t2 = microsecondsPerQuarter & 0xff;
    this.addEvent(tick, [0xff, 0x51, 0x03, t0, t1, t2]);
  }

  public addTimeSignature(tick: number, numerator: number = 4, denominator: number = 4): void {
    const denomPower = Math.round(Math.log2(denominator));
    this.addEvent(tick, [0xff, 0x58, 0x04, numerator, denomPower, 24, 8]);
  }

  public addTrackName(tick: number, name: string): void {
    const nameBytes = Array.from(new TextEncoder().encode(name));
    this.addEvent(tick, [0xff, 0x03, ...encodeVarLength(nameBytes.length), ...nameBytes]);
  }

  /**
   * Builds the MTrk chunk bytes
   */
  public toBytes(): Uint8Array {
    // Sort events by tick (stable sort)
    this.events.sort((a, b) => a.tick - b.tick);

    const trackData: number[] = [];

    // Track Name at tick 0 if set and not already added
    if (this.name) {
      const nameBytes = Array.from(new TextEncoder().encode(this.name));
      const hasName = this.events.some((e) => e.data[0] === 0xff && e.data[1] === 0x03);
      if (!hasName) {
        trackData.push(
          0x00, // delta-time 0
          0xff,
          0x03,
          ...encodeVarLength(nameBytes.length),
          ...nameBytes
        );
      }
    }

    let lastTick = 0;
    for (const event of this.events) {
      const delta = Math.max(0, event.tick - lastTick);
      const deltaBytes = encodeVarLength(delta);
      trackData.push(...deltaBytes, ...event.data);
      lastTick = event.tick;
    }

    // End of Track Meta Event
    trackData.push(0x00, 0xff, 0x2f, 0x00);

    // MTrk chunk header
    const length = trackData.length;
    const header = [
      0x4d,
      0x54,
      0x72,
      0x6b, // 'MTrk'
      (length >> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ];

    return new Uint8Array([...header, ...trackData]);
  }
}

/**
 * Standard MIDI File container
 */
export class MidiFile {
  public tracks: MidiTrack[] = [];
  public ticksPerQuarterNote: number;

  constructor(ticksPerQuarterNote: number = 480) {
    this.ticksPerQuarterNote = ticksPerQuarterNote;
  }

  public addTrack(track?: MidiTrack): MidiTrack {
    const t = track || new MidiTrack();
    this.tracks.push(t);
    return t;
  }

  /**
   * Generates the complete binary SMF (.mid) file
   */
  public toBytes(): Uint8Array {
    const trackBytesList = this.tracks.map((t) => t.toBytes());
    const numTracks = this.tracks.length;

    // MThd header chunk (14 bytes)
    const headerChunk = [
      0x4d,
      0x54,
      0x68,
      0x64, // 'MThd'
      0x00,
      0x00,
      0x00,
      0x06, // Chunk length (6 bytes)
      0x00,
      0x01, // Format 1 (multiple tracks)
      (numTracks >> 8) & 0xff,
      numTracks & 0xff,
      (this.ticksPerQuarterNote >> 8) & 0xff,
      this.ticksPerQuarterNote & 0xff,
    ];

    let totalLength = headerChunk.length;
    for (const tb of trackBytesList) {
      totalLength += tb.length;
    }

    const result = new Uint8Array(totalLength);
    result.set(headerChunk, 0);

    let offset = headerChunk.length;
    for (const tb of trackBytesList) {
      result.set(tb, offset);
      offset += tb.length;
    }

    return result;
  }
}

/**
 * Encodes an integer into Variable-Length Quantity (VLQ) bytes
 */
export function encodeVarLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];

  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }

  return bytes;
}
