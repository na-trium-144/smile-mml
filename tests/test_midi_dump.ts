import { convertMmlToMidi } from '../src/midi/mmlToMidi.js';

function dumpMidiEvents(midiBytes: Uint8Array): void {
  let offset = 14; // skip MThd
  let trackNum = 0;

  while (offset < midiBytes.length) {
    const magic = String.fromCharCode(...midiBytes.slice(offset, offset + 4));
    if (magic !== 'MTrk') break;
    const length = (midiBytes[offset + 4] << 24) | (midiBytes[offset + 5] << 16) | (midiBytes[offset + 6] << 8) | midiBytes[offset + 7];
    const trackData = midiBytes.slice(offset + 8, offset + 8 + length);
    offset += 8 + length;

    console.log(`\n--- Track ${trackNum++} (Length: ${length} bytes) ---`);
    let pos = 0;
    let absTick = 0;

    while (pos < trackData.length) {
      // Read var-length delta
      let delta = 0;
      while (pos < trackData.length) {
        const b = trackData[pos++];
        delta = (delta << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      absTick += delta;

      const status = trackData[pos++];
      if (status === 0xff) {
        const metaType = trackData[pos++];
        let metaLen = 0;
        while (pos < trackData.length) {
          const b = trackData[pos++];
          metaLen = (metaLen << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        const metaData = trackData.slice(pos, pos + metaLen);
        pos += metaLen;
        if (metaType === 0x03) {
          console.log(`[Tick ${absTick}] Track Name: "${new TextDecoder().decode(metaData)}"`);
        } else if (metaType === 0x51) {
          const us = (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
          console.log(`[Tick ${absTick}] Set Tempo: ${(60000000 / us).toFixed(1)} BPM`);
        } else if (metaType === 0x2f) {
          console.log(`[Tick ${absTick}] End of Track`);
        }
      } else {
        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (type === 0x90) {
          const note = trackData[pos++];
          const vel = trackData[pos++];
          console.log(`[Tick ${absTick}] Note On: ch=${ch}, note=${note}, vel=${vel}`);
        } else if (type === 0x80) {
          const note = trackData[pos++];
          const vel = trackData[pos++];
          console.log(`[Tick ${absTick}] Note Off: ch=${ch}, note=${note}, vel=${vel}`);
        } else if (type === 0xe0) {
          const lsb = trackData[pos++];
          const msb = trackData[pos++];
          const val = ((msb << 7) | lsb) - 8192;
          console.log(`[Tick ${absTick}] Pitch Bend: ch=${ch}, val=${val}`);
        } else if (type === 0xb0) {
          const ctrl = trackData[pos++];
          const val = trackData[pos++];
          console.log(`[Tick ${absTick}] Control Change: ch=${ch}, ctrl=${ctrl}, val=${val}`);
        } else if (type === 0xc0) {
          const prog = trackData[pos++];
          console.log(`[Tick ${absTick}] Program Change: ch=${ch}, prog=${prog}`);
        }
      }
    }
  }
}

console.log('=== Verifying C4_E ===');
dumpMidiEvents(convertMmlToMidi(':0 L4 C4_E'));

console.log('\n=============================');
console.log('=== Verifying C&C_E ===');
dumpMidiEvents(convertMmlToMidi(':0 L4 C&C_E'));

console.log('\n=============================');
console.log('=== Verifying C&D_E ===');
dumpMidiEvents(convertMmlToMidi(':0 L4 C&D_E'));
