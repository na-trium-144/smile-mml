import { parseMML } from '../src/parser/vmmlParser.js';
import type { MMLEvent, NoteEvent } from '../src/parser/types.js';

console.log('--- Test 1: Simple Infinite Loop ---');
const mml1 = ':0 T120 L4 [C D E F] :1 [E F G A]';
const events1: MMLEvent[] = [];
for (const ev of parseMML(mml1, { stopOnInfiniteLoop: true })) {
  events1.push(ev);
}
console.log('Events in simple loop (stopped on infinite loop):', events1.length);
console.log('Event types:', events1.map(e => e.type));

console.log('\n--- Test 2: Dynamic Variables inside Loop ---');
const mml2 = ':0 $0=60 [ N$0,4 $0=$0+2 ]3'; // wait, $0=$0+2 is basic, but in MML: $0=60 [ N$0,4 ]3
const events2: MMLEvent[] = [];
for (const ev of parseMML(mml2)) {
  events2.push(ev);
}
const notes2 = events2.filter((e): e is NoteEvent => e.type === 'note');
console.log('Notes in variable loop:', notes2.map(n => ({ note: n.noteNumber, dur: n.duration })));

console.log('\n--- Test 3: Macro and Chord ---');
const mml3 = '{CH1=|C E G|4} :0 T150 {CH1} {CH1}';
const events3: MMLEvent[] = [];
for (const ev of parseMML(mml3)) {
  events3.push(ev);
}
const notes3 = events3.filter((e): e is NoteEvent => e.type === 'note');
console.log('Notes in chord macro:', notes3.map(n => ({ tick: n.tick, note: n.noteName, dur: n.duration })));

console.log('\n--- Test 4: Note Durations (Whole note = 192) ---');
const mml4 = ':0 L4 C1 C2 C4 C8 C16 C32 C64 C192 C12 C24';
const notes4 = Array.from(parseMML(mml4)).filter((e): e is NoteEvent => e.type === 'note');
console.log('Durations for [C1, C2, C4, C8, C16, C32, C64, C192, C12, C24]:', notes4.map(n => n.duration));

