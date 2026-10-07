/**
 * VMML-LIB Faithful MML Parser Implementation in TypeScript
 * Faithfully ports DEF LD PS parsing logic from VMML-LIB (Visual MML ver1.1.2 by Na)
 * without using regex rewriting.
 */

import { extractMacro } from './exmml.js';
import type {
  ChannelParameters,
  EnvelopeParams,
  LFOParams,
  ModulationParams,
  MMLEvent,
  ParseOptions,
} from './types.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface ChordNoteItem {
  noteNumber: number;
  noteName: string;
}

export class MMLChannelParser {
  public channelIndex: number;
  public mmlText: string;
  public fullMML: string;
  public pos: number = 0; // CHP[P]
  public currentTick: number = 0; // CHHP[P] (in ticks, SPD=48 where quarter note = 48 ticks)
  public chorv: number = 1; // CHORV: octave direction (+1 or -1)
  public isFinished: boolean = false;

  // Parameters corresponding to CHPRM
  public params: ChannelParameters;

  // Portamento length tracking: CHPT[P]
  public portamentoLen: number = 0;
  // Tie note memory: CHT$[P]
  public tieNoteName: string = '';

  // Loop stacks: CHLPP$, CHLPC$
  public loopPosStack: number[] = [];
  public loopCountStack: number[] = [];

  // Chord buffer: CHW$, CHW2$
  public inChord: boolean = false;
  public chordNotes: ChordNoteItem[] = [];

  // Ticks per whole note: default 192 (quarter note = 48 ticks)
  public readonly spd: number;

  // Stop flag when infinite loop detected
  public infiniteLoopCount: number = 0;

  constructor(
    channelIndex: number,
    channelText: string,
    fullMML: string,
    initialKeyShift: number = 0,
    spd: number = 192
  ) {
    this.channelIndex = channelIndex;
    this.mmlText = channelText + ' ';
    this.fullMML = fullMML;
    this.spd = spd;

    const defaultEnvelope: EnvelopeParams = {
      enabled: false,
      a: 127,
      d: 127,
      s: 127,
      r: 127,
    };

    const defaultLfo = (): LFOParams => ({
      enabled: false,
      depth: -1,
      range: 0,
      speed: 0,
      delay: 0,
    });

    const defaultModulation: ModulationParams = {
      enabled: false,
      tremolo: defaultLfo(),
      vibrato: defaultLfo(),
      autoPan: defaultLfo(),
    };

    this.params = {
      length: 4, // 0: L
      octave: 4, // 1: O
      dots: 0, // 2: .
      gate: 8, // 3: Q
      volume: 127, // 4: V
      pan: 64, // 5: P
      program: 0, // 6: @
      detune: 0, // 7: @D
      velocity: 127, // 8: @V
      envelope: defaultEnvelope,
      modulation: defaultModulation,
      keyShift: initialKeyShift, // 30: K
      // outputOctave: 4, // 31: o
      variables: [0, 0, 0, 0, 0, 0, 0, 0], // 32-39: $0-$7
    };
  }

  /**
   * Reads 1 character at current pos converted to uppercase, matching LD1$(P)
   */
  public ld1(): string {
    if (this.pos >= this.mmlText.length) return '';
    const ch = this.mmlText[this.pos];
    if (ch >= 'a' && ch <= 'z') {
      return String.fromCharCode(ch.charCodeAt(0) - 32);
    }
    return ch;
  }

  /**
   * Reads a number or variable $0-$7 value, matching GTV P OUT V, V$
   */
  public gtv(): { num: number; str: string } {
    let v = 0;
    let vStr = '';

    if (this.ld1() === '$') {
      this.pos++; // skip '$'
      const varIndex = parseInt(this.ld1(), 10) || 0;
      this.pos++; // skip variable index
      v = this.params.variables[varIndex] ?? 0;
      vStr = String(v);
    } else {
      while (this.pos < this.mmlText.length) {
        const c = this.ld1();
        if (c >= '0' && c <= '9') {
          v = v * 10 + (c.charCodeAt(0) - 48);
          vStr += c;
          this.pos++;
        } else {
          break;
        }
      }
    }
    return { num: v, str: vStr };
  }

  /**
   * Counts dots (.) and sharps/flats (+, #, -), matching LDN2 P OUT VD, VN
   */
  public ldn2(): { dots: number; accidentals: number } {
    let vd = 0;
    let vn = 0;

    while (this.pos < this.mmlText.length) {
      const c = this.ld1();
      if (c === '.') {
        vd++;
        this.pos++;
        continue;
      }
      if (c === '+' || c === '#') {
        vn++;
        this.pos++;
        continue;
      }
      if (c === '-') {
        vn--;
        this.pos++;
        continue;
      }
      break;
    }
    return { dots: vd, accidentals: vn };
  }

  /**
   * Clones current channel parameters for snapshot in NoteEvent
   */
  private cloneParams(): {
    envelope: EnvelopeParams;
    modulation: ModulationParams;
  } {
    return {
      envelope: { ...this.params.envelope },
      modulation: {
        enabled: this.params.modulation.enabled,
        tremolo: { ...this.params.modulation.tremolo },
        vibrato: { ...this.params.modulation.vibrato },
        autoPan: { ...this.params.modulation.autoPan },
      },
    };
  }

  /**
   * Yields the next event from this channel
   */
  public *nextEvent(): Generator<MMLEvent, void, unknown> {
    while (this.pos < this.mmlText.length) {
      let c = this.ld1();
      this.pos++;

      // Skip special characters: star marker, space, LF, CR
      if (c === '☆' || c === ' ' || c === '\n' || c === '\r') {
        continue;
      }

      // Chord start |
      if (c === '|' && !this.inChord) {
        this.inChord = true;
        this.chordNotes = [];
        continue;
      }

      // Variable assignment: $0=val to $7=val
      if (c === '$') {
        const varChar = this.ld1();
        this.pos++; // var index
        this.pos++; // '='
        const valRes = this.gtv();
        const varIdx = parseInt(varChar, 10);
        if (varIdx >= 0 && varIdx <= 7) {
          this.params.variables[varIdx] = valRes.num;
        }
        continue;
      }

      // Octave down >
      if (c === '>') {
        this.params.octave -= this.chorv;
        continue;
      }

      // Octave up <
      if (c === '<') {
        this.params.octave += this.chorv;
        continue;
      }

      // Tie &
      if (c === '&') {
        // Tie symbol: mark previous note
        continue;
      }

      // Octave invert !
      if (c === '!') {
        this.chorv = -this.chorv;
        continue;
      }

      // Velocity up (
      if (c === '(') {
        const { num, str } = this.gtv();
        const delta = str === '' ? 1 : num;
        this.params.velocity = Math.min(127, this.params.velocity + delta);
        continue;
      }

      // Velocity down )
      if (c === ')') {
        const { num, str } = this.gtv();
        const delta = str === '' ? 1 : num;
        this.params.velocity = Math.max(0, this.params.velocity - delta);
        continue;
      }

      // Comment / ... /
      if (c === '/') {
        const nextSlash = this.mmlText.indexOf('/', this.pos);
        if (nextSlash === -1) {
          this.pos = this.mmlText.length;
        } else {
          this.pos = nextSlash + 1;
        }
        continue;
      }

      // Macro replacement {TAG} or definition {TAG=...}
      if (c === '{') {
        const s = this.pos - 1;
        let k = 0;
        let e = s + 1;
        for (; e < this.mmlText.length; e++) {
          if (this.mmlText[e] === '{') k++;
          if (this.mmlText[e] === '}') {
            if (k === 0) break;
            k--;
          }
        }
        e = e + 1;
        const eqIdx = this.mmlText.indexOf('=', s);
        // If '=' exists inside { ... }, it's a definition, skip it
        if (s < eqIdx && eqIdx < e) {
          this.pos = e;
          continue;
        }
        // It's a macro reference: {TAG}
        const tag = this.mmlText.slice(s + 1, e - 1);
        const repl = extractMacro(this.fullMML, tag);
        this.mmlText = this.mmlText.slice(0, s) + repl + this.mmlText.slice(e);
        this.pos = s;
        continue;
      }

      // Loop start [
      if (c === '[') {
        this.loopPosStack.push(this.pos);
        this.loopCountStack.push(0);

        // Backup current parameter state into MML string (matching VMML-LIB line 693-701)
        if (this.mmlText[this.pos] !== '☆') {
          const backupStr =
            `☆O${this.params.octave}` +
            `L${this.params.length}${'.'.repeat(this.params.dots)}` +
            `Q${this.params.gate}` +
            `V${this.params.velocity}` +
            `K${this.params.keyShift}`;
          this.mmlText = this.mmlText.slice(0, this.pos) + backupStr + this.mmlText.slice(this.pos);
        }
        continue;
      }

      // Loop end ]
      if (c === ']') {
        const { num: targetLoopCount } = this.gtv();
        const currentCount = (this.loopCountStack.pop() ?? 0) + 1;
        const loopStartPos = this.loopPosStack[this.loopPosStack.length - 1] ?? 0;

        if (targetLoopCount === 0 || currentCount < targetLoopCount) {
          // Continue looping (or infinite loop)
          this.loopCountStack.push(currentCount);
          this.pos = loopStartPos;

          if (targetLoopCount === 0) {
            this.infiniteLoopCount++;
          }

          yield {
            type: 'loop',
            channel: this.channelIndex,
            tick: this.currentTick,
            loopCount: currentCount,
            targetCount: targetLoopCount,
            isInfinite: targetLoopCount === 0,
          };
          continue;
        }

        // Loop finished: pop start pos
        this.loopPosStack.pop();
        continue;
      }

      // @ commands
      if (c === '@') {
        const nextC = this.ld1();
        if (nextC === 'V') {
          this.pos++;
          const { num } = this.gtv();
          this.params.volume = num;
          yield {
            type: 'control',
            channel: this.channelIndex,
            tick: this.currentTick,
            controller: 7,
            value: num,
          };
          continue;
        }
        if (nextC === 'D') {
          this.pos++;
          let sg = 1;
          if (this.ld1() === '-') {
            sg = -1;
            this.pos++;
          }
          const { num } = this.gtv();
          this.params.detune = sg * num;
          yield {
            type: 'pitchBend',
            channel: this.channelIndex,
            tick: this.currentTick,
            value: Math.round((sg * num * 8192) / 128),
          };
          continue;
        }
        if (nextC === 'E') {
          this.pos++;
          if (this.ld1() === 'R') {
            this.pos++;
            this.params.envelope.enabled = false;
          } else {
            this.params.envelope.enabled = true;
            const a = this.gtv();
            this.pos++; // skip comma
            const d = this.gtv();
            this.pos++; // skip comma
            const s = this.gtv();
            this.pos++; // skip comma
            const r = this.gtv();
            this.params.envelope.a = a.num;
            this.params.envelope.d = d.num;
            this.params.envelope.s = s.num;
            this.params.envelope.r = r.num;
          }
          continue;
        }
        if (nextC === 'M') {
          this.pos++;
          const mType = this.ld1();
          if (mType === 'O') {
            this.pos++;
            const onOff = this.ld1();
            this.pos++;
            if (onOff === 'N') {
              this.params.modulation.enabled = true;
            } else if (onOff === 'F') {
              this.params.modulation.enabled = false;
            }
          } else if (mType === 'A') {
            this.pos++;
            if (this.ld1() === 'O') {
              this.pos++;
              if (this.ld1() === 'F') this.pos++;
              this.params.modulation.tremolo.enabled = false;
            } else {
              this.params.modulation.enabled = true;
              this.params.modulation.tremolo.enabled = true;
              // @MA, @MP, @ML are mutually exclusive; disable the other two
              this.params.modulation.vibrato.enabled = false;
              this.params.modulation.autoPan.enabled = false;
              const depth = this.gtv();
              this.pos++;
              const range = this.gtv();
              this.pos++;
              const speed = this.gtv();
              this.pos++;
              const delay = this.gtv();
              this.params.modulation.tremolo.depth = depth.num;
              this.params.modulation.tremolo.range = range.num;
              this.params.modulation.tremolo.speed = speed.num;
              this.params.modulation.tremolo.delay = delay.num;
            }
          } else if (mType === 'P') {
            this.pos++;
            if (this.ld1() === 'O') {
              this.pos++;
              if (this.ld1() === 'F') this.pos++;
              this.params.modulation.vibrato.enabled = false;
            } else {
              this.params.modulation.enabled = true;
              this.params.modulation.vibrato.enabled = true;
              // @MA, @MP, @ML are mutually exclusive; disable the other two
              this.params.modulation.tremolo.enabled = false;
              this.params.modulation.autoPan.enabled = false;
              const depth = this.gtv();
              this.pos++;
              const range = this.gtv();
              this.pos++;
              const speed = this.gtv();
              this.pos++;
              const delay = this.gtv();
              this.params.modulation.vibrato.depth = depth.num;
              this.params.modulation.vibrato.range = range.num;
              this.params.modulation.vibrato.speed = speed.num;
              this.params.modulation.vibrato.delay = delay.num;
            }
          } else if (mType === 'L') {
            this.pos++;
            if (this.ld1() === 'O') {
              this.pos++;
              if (this.ld1() === 'F') this.pos++;
              this.params.modulation.autoPan.enabled = false;
            } else {
              this.params.modulation.enabled = true;
              this.params.modulation.autoPan.enabled = true;
              // @MA, @MP, @ML are mutually exclusive; disable the other two
              this.params.modulation.tremolo.enabled = false;
              this.params.modulation.vibrato.enabled = false;
              const depth = this.gtv();
              this.pos++;
              const range = this.gtv();
              this.pos++;
              const speed = this.gtv();
              this.pos++;
              const delay = this.gtv();
              this.params.modulation.autoPan.depth = depth.num;
              this.params.modulation.autoPan.range = range.num;
              this.params.modulation.autoPan.speed = speed.num;
              this.params.modulation.autoPan.delay = delay.num;
            }
          }
          continue;
        }

        // Program change: @<num>
        const { num } = this.gtv();
        this.params.program = num;
        yield {
          type: 'program',
          channel: this.channelIndex,
          tick: this.currentTick,
          program: num,
        };
        continue;
      }

      // Vocal text *lyric,
      if (c === '*') {
        while (this.pos < this.mmlText.length && this.ld1() !== ',') {
          this.pos++;
        }
        if (this.ld1() === ',') this.pos++;
        c = this.ld1();
        this.pos++;
      }

      let vn = 0;
      let vd = 0;
      let trailingPortamento = false; // PT in VMML-LIB

      // Restore C2&4 omitted note name matching VMML-LIB line 892-900
      if (this.tieNoteName !== '' && (c < 'A' || c > 'Z') && c !== '@' && c !== '|') {
        this.pos--;
        this.mmlText = this.mmlText.slice(0, this.pos) + this.tieNoteName + this.mmlText.slice(this.pos);
        c = this.ld1();
        this.pos++;
      }
      this.tieNoteName = '';

      // Get base note index 0-11
      let n = -1;
      for (let i = 0; i < 12; i++) {
        if (c === NOTE_NAMES[i]) {
          n = i + (this.params.octave + 1) * 12;
          break;
        }
      }

      // Count . # + - (1st pass)
      if ((c >= 'A' && c <= 'G') || c === 'R' || c === 'L' || c === '|') {
        const { dots, accidentals } = this.ldn2();
        vd += dots;
        vn += accidentals;
      }

      // Get number (for O command allow negative number)
      let v = 0;
      let vStr = '';
      if (c === 'O' && this.ld1() === '-') {
        this.pos++;
        const gtvRes = this.gtv();
        v = -gtvRes.num;
        vStr = '-' + gtvRes.str;
      } else {
        const gtvRes = this.gtv();
        v = gtvRes.num;
        vStr = gtvRes.str;
      }

      // For N<note>,<len>
      let v2 = 0;
      let v2Str = '';
      if (this.ld1() === ',') {
        this.pos++;
        const gtvRes2 = this.gtv();
        v2 = gtvRes2.num;
        v2Str = gtvRes2.str;
      }

      // Count . # + - (2nd pass)
      if ((c >= 'A' && c <= 'G') || c === 'R' || c === 'L' || c === '|') {
        const { dots, accidentals } = this.ldn2();
        vd += dots;
        vn += accidentals;
      }

      // Portamento length restoration C4_C
      if (this.portamentoLen > 0 && ((c >= 'A' && c <= 'G') || c === 'N' || c === 'R' || c === '|')) {
        if (vStr === '' && c !== 'R') {
          trailingPortamento = true;
          v = this.portamentoLen;
        }
        if (c !== 'N') {
          this.portamentoLen = 0;
        }
      }

      if (this.ld1() === '&') {
        trailingPortamento = false;
      }

      // Restore length from L command if omitted (not when trailingPortamento=true)
      if (c !== '@' && !trailingPortamento && vStr === '') {
        v = this.params.length;
        vd += this.params.dots;
        vStr = String(v);
      }
      if (c === 'N' && !trailingPortamento && v2Str === '') {
        v2 = this.params.length;
        vd += this.params.dots;
        v2Str = String(v2);
      }

      // Divisor of 192 alignment: WHILE 192 MOD V != 0: INC V: WEND
      if ((c >= 'A' && c <= 'G') || c === 'R' || c === '|' || c === 'L') {
        if (v <= 0) v = 4;
        while (192 % v !== 0) {
          v++;
        }
        if (vStr !== '') vStr = String(v);
      }
      if (c === 'N') {
        if (v2 <= 0) v2 = 4;
        while (192 % v2 !== 0) {
          v2++;
        }
        if (v2Str !== '') v2Str = String(v2);
      }

      // Check if this note triggers portamento into the next note (_)
      let hasPortamento = false;
      if (this.ld1() === '_') {
        this.portamentoLen = v;
        this.pos++; // skip '_'
        hasPortamento = true;
        trailingPortamento = false;
      }

      // Calculate note number with accidentals and key shift
      if (c >= 'A' && c <= 'G') {
        n += vn + this.params.keyShift;
      }

      // Tie check: if followed by &, remember note name for next note
      if (this.ld1() === '&') {
        this.tieNoteName = c;
      }

      // Chord accumulation or finish
      if (c === '|') {
        // Chord end: emit all notes in chordNotes with duration calculated from this |
        let noteDuration = 0;
        if (!trailingPortamento) {
          noteDuration = Math.round(this.spd / v);
          let remVd = vd;
          let tempV = v;
          while (remVd > 0) {
            tempV *= 2;
            noteDuration += Math.round(this.spd / tempV);
            remVd--;
          }
        }

        const startTick = this.currentTick;
        const gateRatio = this.params.gate / 8;
        const gateDur = trailingPortamento ? 0 : Math.max(1, Math.round(noteDuration * gateRatio));
        const { envelope, modulation } = this.cloneParams();

        for (const chordNote of this.chordNotes) {
          yield {
            type: 'note',
            channel: this.channelIndex,
            tick: startTick,
            noteNumber: chordNote.noteNumber,
            noteName: chordNote.noteName,
            duration: noteDuration,
            gateDuration: gateDur,
            velocity: this.params.velocity,
            volume: this.params.volume,
            pan: this.params.pan,
            program: this.params.program,
            detune: this.params.detune,
            gate: this.params.gate,
            envelope,
            modulation,
            isTie: this.ld1() === '&',
            isPortamento: hasPortamento,
          };
        }

        if (!trailingPortamento) {
          this.currentTick += noteDuration;
        }
        this.inChord = false;
        this.chordNotes = [];
        continue;
      } else if (this.inChord) {
        // Collect note into chordNotes
        if (c >= 'A' && c <= 'G') {
          const octaveStr = Math.floor(n / 12) - 1;
          const noteNameOnly = NOTE_NAMES[((n % 12) + 12) % 12];
          this.chordNotes.push({
            noteNumber: Math.max(0, Math.min(127, n)),
            noteName: `${noteNameOnly}${octaveStr}`,
          });
        }
        continue;
      }

      // Output Note (A-G)
      if (c >= 'A' && c <= 'G') {
        let noteDuration = 0;
        if (!trailingPortamento) {
          noteDuration = Math.round(this.spd / v);
          let remVd = vd;
          let tempV = v;
          while (remVd > 0) {
            tempV *= 2;
            noteDuration += Math.round(this.spd / tempV);
            remVd--;
          }
        }

        const startTick = this.currentTick;
        const gateRatio = this.params.gate / 8;
        const gateDur = trailingPortamento ? 0 : Math.max(1, Math.round(noteDuration * gateRatio));
        const { envelope, modulation } = this.cloneParams();

        const clampedNote = Math.max(0, Math.min(127, n));
        const octaveStr = Math.floor(clampedNote / 12) - 1;
        const noteNameOnly = NOTE_NAMES[((clampedNote % 12) + 12) % 12];

        yield {
          type: 'note',
          channel: this.channelIndex,
          tick: startTick,
          noteNumber: clampedNote,
          noteName: `${noteNameOnly}${octaveStr}`,
          duration: noteDuration,
          gateDuration: gateDur,
          velocity: this.params.velocity,
          volume: this.params.volume,
          pan: this.params.pan,
          program: this.params.program,
          detune: this.params.detune,
          gate: this.params.gate,
          envelope,
          modulation,
          isTie: this.ld1() === '&',
          isPortamento: hasPortamento,
        };

        if (!trailingPortamento) {
          this.currentTick += noteDuration;
        }
        continue;
      }

      // Rest (R)
      if (c === 'R') {
        let restDuration = Math.round(this.spd / v);
        let remVd = vd;
        let tempV = v;
        while (remVd > 0) {
          tempV *= 2;
          restDuration += Math.round(this.spd / tempV);
          remVd--;
        }

        yield {
          type: 'rest',
          channel: this.channelIndex,
          tick: this.currentTick,
          duration: restDuration,
        };

        this.currentTick += restDuration;
        continue;
      }

      // Direct Note Number N<note>[,<len>]
      if (c === 'N') {
        // trailingPortamento is not considered here in original VMML-LIB
        let noteDuration = Math.round(this.spd / v2);
        let remVd = vd;
        let tempV = v2;
        while (remVd > 0) {
          tempV *= 2;
          noteDuration += Math.round(this.spd / tempV);
          remVd--;
        }

        const startTick = this.currentTick;
        const gateRatio = this.params.gate / 8;
        const gateDur = Math.max(1, Math.round(noteDuration * gateRatio));
        const { envelope, modulation } = this.cloneParams();

        const noteNum = Math.max(0, Math.min(127, v + this.params.keyShift));
        const octaveStr = Math.floor(noteNum / 12) - 1;
        const noteNameOnly = NOTE_NAMES[((noteNum % 12) + 12) % 12];

        yield {
          type: 'note',
          channel: this.channelIndex,
          tick: startTick,
          noteNumber: noteNum,
          noteName: `${noteNameOnly}${octaveStr}`,
          duration: noteDuration,
          gateDuration: gateDur,
          velocity: this.params.velocity,
          volume: this.params.volume,
          pan: this.params.pan,
          program: this.params.program,
          detune: this.params.detune,
          gate: this.params.gate,
          envelope,
          modulation,
          isTie: this.ld1() === '&',
          isPortamento: hasPortamento,
        };

        this.currentTick += noteDuration;
        continue;
      }

      // Tempo T<bpm>
      if (c === 'T') {
        yield {
          type: 'tempo',
          tick: this.currentTick,
          bpm: v,
        };
        continue;
      }

      // Length L<len>
      if (c === 'L') {
        this.params.length = v;
        this.params.dots = vd;
        continue;
      }

      // Octave O<octave>
      if (c === 'O') {
        this.params.octave = v;
        continue;
      }

      // Gate Q<gate>
      if (c === 'Q') {
        this.params.gate = v;
        continue;
      }

      // Velocity V<vel>
      if (c === 'V') {
        this.params.velocity = v;
        continue;
      }

      // Pan P<pan>
      if (c === 'P') {
        this.params.pan = v;
        yield {
          type: 'control',
          channel: this.channelIndex,
          tick: this.currentTick,
          controller: 10,
          value: v,
        };
        continue;
      }

      // Key shift K<shift>
      if (c === 'K') {
        this.params.keyShift = v;
        continue;
      }
    }

    this.isFinished = true;
    yield {
      type: 'end',
      channel: this.channelIndex,
      tick: this.currentTick,
    };
  }
}

/**
 * Splits MML string into 16 channels, matching VMSTART logic
 */
export function splitMMLChannels(mml: string): { channels: string[]; initialKeyShift: number } {
  const channels: string[] = Array(16).fill('');
  let op = -1;
  let s = 0;
  let initialKeyShift = 0;

  for (let i = 0; i < mml.length; i++) {
    // Skip inside { ... }
    if (mml[i] === '{') {
      let depth = 0;
      let j = i + 1;
      for (; j < mml.length; j++) {
        if (mml[j] === '{') depth++;
        if (mml[j] === '}') {
          if (depth === 0) break;
          depth--;
        }
      }
      i = j;
      continue;
    }

    // Key setting before :0
    if (op === -1 && (mml[i] === 'K' || mml[i] === 'k')) {
      let k = 0;
      i++;
      let sign = 1;
      if (mml[i] === '-') {
        sign = -1;
        i++;
      }
      while (i < mml.length && mml[i] >= '0' && mml[i] <= '9') {
        k = k * 10 + (mml[i].charCodeAt(0) - 48);
        i++;
      }
      initialKeyShift = sign * k;
      i--;
      continue;
    }

    if (mml[i] !== ':') continue;

    let p = -1;
    const e = i;
    i++;
    while (i < mml.length && mml[i] >= '0' && mml[i] <= '9') {
      if (p === -1) p = 0;
      p = p * 10 + (mml[i].charCodeAt(0) - 48);
      i++;
    }
    if (p === -1 || p < 0 || p > 15) continue;

    if (op === -1) op = 0;
    channels[op] += mml.slice(s, e) + ' ';
    s = i;
    op = p;
  }

  if (op === -1) op = 0;
  channels[op] += mml.slice(s) + ' ';

  return { channels, initialKeyShift };
}

/**
 * Main MML Generator: parses all channels concurrently and yields events in chronological tick order.
 */
export function* parseMML(mml: string, options?: ParseOptions): Generator<MMLEvent, void, unknown> {
  const { channels, initialKeyShift } = splitMMLChannels(mml);
  const globalKeyShift = (options?.keyShift ?? 0) + initialKeyShift;
  const spd = options?.ticksPerWholeNote ?? 192;

  const channelParsers: MMLChannelParser[] = [];
  const channelGenerators: Array<Generator<MMLEvent, void, unknown> | null> = [];
  const nextEvents: Array<IteratorResult<MMLEvent, void> | null> = [];

  // Active channels that have non-empty MML string
  const activeChannels = new Set<number>();
  const loopedChannels = new Set<number>();

  for (let ch = 0; ch < 16; ch++) {
    if (channels[ch].trim() !== '') {
      const parser = new MMLChannelParser(ch, channels[ch], mml, globalKeyShift, spd);
      channelParsers.push(parser);
      const gen = parser.nextEvent();
      channelGenerators.push(gen);
      nextEvents.push(gen.next());
      activeChannels.add(ch);
    } else {
      channelGenerators.push(null);
      nextEvents.push(null);
    }
  }

  while (true) {
    // Find the event with the earliest tick
    let minTick = Infinity;
    let selectedCh = -1;

    for (let ch = 0; ch < 16; ch++) {
      const cur = nextEvents[ch];
      if (cur && !cur.done && cur.value) {
        const tick = cur.value.tick;
        if (tick < minTick) {
          minTick = tick;
          selectedCh = ch;
        }
      }
    }

    if (selectedCh === -1) {
      // All channels completed
      break;
    }

    const eventResult = nextEvents[selectedCh]!;
    const event = eventResult.value!;

    // Advance selected channel generator
    const gen = channelGenerators[selectedCh]!;
    nextEvents[selectedCh] = gen.next();

    // Check for loop event
    if (event.type === 'loop' && event.isInfinite) {
      loopedChannels.add(selectedCh);
      if (options?.stopOnInfiniteLoop) {
        // If all active channels looped or ended, we can stop
        let allLoopedOrEnded = true;
        for (const ch of activeChannels) {
          const res = nextEvents[ch];
          if (!loopedChannels.has(ch) && res && !res.done) {
            allLoopedOrEnded = false;
            break;
          }
        }
        if (allLoopedOrEnded) {
          yield event;
          break;
        }
      }
    }

    yield event;
  }
}
