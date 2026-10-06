import { parseMML } from '../src/parser/vmmlParser.js';
import { convertMmlToMidi } from '../src/midi/mmlToMidi.js';
import type { NoteEvent } from '../src/parser/types.js';

console.log('=== Portamento & Tie Verification Tests ===\n');

// Test 1: C4_E vs C4_E4
console.log('--- Test 1: C4_E (length 0) vs C4_E4 (length 48) ---');
const mml1a = ':0 L4 C4_E';
const notes1a = Array.from(parseMML(mml1a)).filter((e): e is NoteEvent => e.type === 'note');
console.log('C4_E notes:');
for (const n of notes1a) {
  console.log(`  Note:${n.noteName}(#${n.noteNumber}) Tick:${n.tick} Dur:${n.duration} Portamento:${n.isPortamento}`);
}

const mml1b = ':0 L4 C4_E4';
const notes1b = Array.from(parseMML(mml1b)).filter((e): e is NoteEvent => e.type === 'note');
console.log('C4_E4 notes:');
for (const n of notes1b) {
  console.log(`  Note:${n.noteName}(#${n.noteNumber}) Tick:${n.tick} Dur:${n.duration} Portamento:${n.isPortamento}`);
}

// Test 2: C&C_E (same pitch tie)
console.log('\n--- Test 2: C&C_E (Same Pitch Tie + Portamento) ---');
const mml2 = ':0 L4 C&C_E';
const notes2 = Array.from(parseMML(mml2)).filter((e): e is NoteEvent => e.type === 'note');
console.log('C&C_E parsed notes:');
for (const n of notes2) {
  console.log(`  Note:${n.noteName}(#${n.noteNumber}) Tick:${n.tick} Dur:${n.duration} Tie:${n.isTie} Portamento:${n.isPortamento}`);
}

// Test 3: C&D_E (different pitch tie)
console.log('\n--- Test 3: C&D_E (Different Pitch Tie + Portamento) ---');
const mml3 = ':0 L4 C&D_E';
const notes3 = Array.from(parseMML(mml3)).filter((e): e is NoteEvent => e.type === 'note');
console.log('C&D_E parsed notes:');
for (const n of notes3) {
  console.log(`  Note:${n.noteName}(#${n.noteNumber}) Tick:${n.tick} Dur:${n.duration} Tie:${n.isTie} Portamento:${n.isPortamento}`);
}

// Test 4: MIDI conversion check for C4_E, C4_E4, C&C_E, C&D_E
console.log('\n--- Test 4: MIDI Binary Generation ---');
const midi1a = convertMmlToMidi(mml1a);
console.log(`C4_E MIDI size: ${midi1a.length} bytes`);

const midi1b = convertMmlToMidi(mml1b);
console.log(`C4_E4 MIDI size: ${midi1b.length} bytes`);

const midi2 = convertMmlToMidi(mml2);
console.log(`C&C_E MIDI size: ${midi2.length} bytes`);

const midi3 = convertMmlToMidi(mml3);
console.log(`C&D_E MIDI size: ${midi3.length} bytes`);

console.log('\n✓ All Portamento and Tie tests completed successfully!');
