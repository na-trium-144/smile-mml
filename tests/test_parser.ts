import fs from 'node:fs';
import { parseMML } from '../src/parser/vmmlParser.js';
import type { NoteEvent } from '../src/parser/types.js';

const mmlPath = '/tmp/NA_NN.MML';
const mmlContent = fs.readFileSync(mmlPath, 'utf-8');

console.log('--- Testing MML Parser on /tmp/NA_NN.MML ---');
const startTime = performance.now();

let noteCount = 0;
let tempoCount = 0;
let loopCount = 0;
let endCount = 0;
const notesByChannel: Record<number, number> = {};

const gen = parseMML(mmlContent, { stopOnInfiniteLoop: true });
const firstFewNotes: NoteEvent[] = [];

for (const event of gen) {
  if (event.type === 'note') {
    noteCount++;
    notesByChannel[event.channel] = (notesByChannel[event.channel] || 0) + 1;
    if (firstFewNotes.length < 10) {
      firstFewNotes.push(event);
    }
  } else if (event.type === 'tempo') {
    tempoCount++;
    console.log(`[Tempo] tick=${event.tick}, bpm=${event.bpm}`);
  } else if (event.type === 'loop') {
    loopCount++;
    console.log(`[Loop] channel=${event.channel}, tick=${event.tick}, isInfinite=${event.isInfinite}`);
  } else if (event.type === 'end') {
    endCount++;
  }
}

const elapsed = performance.now() - startTime;
console.log(`\nParsing completed in ${elapsed.toFixed(2)}ms`);
console.log(`Total Notes: ${noteCount}`);
console.log(`Total Tempo events: ${tempoCount}`);
console.log(`Total Loops: ${loopCount}`);
console.log(`Total Channel Ends: ${endCount}`);
console.log('Notes by channel:', notesByChannel);

console.log('\nFirst 5 notes parsed:');
for (let i = 0; i < Math.min(5, firstFewNotes.length); i++) {
  const n = firstFewNotes[i];
  console.log(`Ch:${n.channel} Tick:${n.tick} Note:${n.noteName}(#${n.noteNumber}) Dur:${n.duration} Vel:${n.velocity} Vol:${n.volume} Prog:${n.program}`);
}
