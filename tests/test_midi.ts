import fs from 'node:fs';
import { convertMmlToMidi } from '../src/midi/mmlToMidi.js';

const mmlPath = '/tmp/NA_NN.MML';
const mmlContent = fs.readFileSync(mmlPath, 'utf-8');

console.log('--- Converting /tmp/NA_NN.MML to MIDI ---');
const startTime = performance.now();

const midiBytes = convertMmlToMidi(mmlContent, {
  songTitle: 'Night of Knights',
  stopOnInfiniteLoop: true,
});

const elapsed = performance.now() - startTime;
console.log(`MIDI Conversion completed in ${elapsed.toFixed(2)}ms`);
console.log(`Generated MIDI binary size: ${midiBytes.length} bytes`);

// Verify MIDI Header
const headerStr = String.fromCharCode(...midiBytes.slice(0, 4));
console.log(`Header magic: "${headerStr}" (expected "MThd")`);
const format = (midiBytes[8] << 8) | midiBytes[9];
const tracks = (midiBytes[10] << 8) | midiBytes[11];
const division = (midiBytes[12] << 8) | midiBytes[13];
console.log(`MIDI Format: ${format}, Tracks: ${tracks}, Division (TPQN): ${division}`);

if (headerStr === 'MThd' && format === 1 && tracks > 0 && division === 480) {
  console.log('✓ MIDI header is valid!');
} else {
  console.error('✗ Invalid MIDI header!');
  process.exit(1);
}

// Write to scratch file for verification
const outPath = '/tmp/test_output.mid';
fs.writeFileSync(outPath, Buffer.from(midiBytes));
console.log(`Wrote MIDI file to ${outPath}`);
