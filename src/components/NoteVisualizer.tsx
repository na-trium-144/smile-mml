/**
 * NoteVisualizer Component
 * Canvas-based real-time note visualizer inspired by VMML-LIB's VMFRAME function.
 * Displays note names (e.g. "C#4") for each channel on horizontal time tracks,
 * smoothly scrolling with the current playback position centered.
 *
 * Octave coloring: O4=white, higher→yellow→red, lower→cyan→blue.
 * Currently sounding notes get a green (--color-primary) background highlight.
 */

import {
  useRef,
  useEffect,
  useCallback,
  type FC,
  useMemo,
  useState,
} from "react";
import type { PostProcessedNote } from "../audio/types";
import clsx from "clsx";
import { centsToSbDetune } from "../audio/utils/conversion";

/**
 * Returns a CSS color string for the given octave.
 * O4 = white, higher octaves → yellow → red, lower octaves → cyan → blue.
 */
function octaveColor(octave: number): string {
  if (octave >= 8) return "#ff0000";
  else if (octave === 7) return "#ff5500";
  else if (octave === 6) return "#ffaa00";
  else if (octave === 5) return "#ffff00";
  else if (octave === 4) return "#ffffff";
  else if (octave === 3) return "#80ffff";
  else if (octave === 2) return "#00ee55";
  else /*if(octave <= 1)*/ return "#008000";
}

export interface NoteVisualizerProps {
  /** Active channel indices */
  channels: number[];
  /** Function that returns current playback time in ticks */
  getCurrentTick: () => number;
  /** Whether playback is currently active */
  isPlaying: boolean;
  /** Optional function to get notes for a channel directly from scheduler */
  getNotesForChannel: (channel: number) => PostProcessedNote[];
}

const CHANNEL_HEIGHT = 20;
const PADDING_X = 1;
const PIXELS_PER_TICK = 4; // horizontal scale
const FONT_SIZE = 16;

export const NoteVisualizer: FC<NoteVisualizerProps> = ({
  channels,
  getCurrentTick,
  isPlaying,
  getNotesForChannel,
}) => {
  const canvasRectRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRectRef2 = useRef<HTMLDivElement>(null);
  const canvasRef2 = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const colorBase100 = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-base-100",
      ),
    [],
  );
  const colorPrimary = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-primary",
      ),
    [],
  );
  const colorStatement = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-sb3-statement",
      ),
    [],
  );
  const colorLabel = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-sb3-label",
      ),
    [],
  );

  const soundingNotes = useRef<(PostProcessedNote | undefined)[]>([]);
  const [currentPrograms, setCurrentPrograms] = useState<
    (
      | {
          program: number;
          type: "sf2" | "nds" | "basicWave" | undefined;
          envelopeEnabled: boolean;
        }
      | undefined
    )[]
  >([]);

  const draw = useCallback(() => {
    const canvasRect = canvasRectRef.current;
    const canvas = canvasRef.current;
    const canvasRect2 = canvasRectRef2.current;
    const canvas2 = canvasRef2.current;
    if (!canvasRect || !canvas || !canvasRect2 || !canvas2) return;

    const ctx = canvas.getContext("2d");
    const ctx2 = canvas2.getContext("2d");
    if (!ctx || !ctx2) return;

    const currentTick = getCurrentTick();

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasRect.getBoundingClientRect();
    const width = rect.width;
    const height = channels.length * CHANNEL_HEIGHT;

    // Resize canvas if needed
    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = colorBase100;
    ctx.fillRect(0, 0, width, height);

    // The center of the canvas corresponds to currentTime
    const halfWidth = width / 2;
    const viewStartTick = currentTick - halfWidth / PIXELS_PER_TICK;
    const viewEndTick = currentTick + halfWidth / PIXELS_PER_TICK;

    // Draw channel separators
    ctx.strokeStyle = "#ffffff20";
    ctx.lineWidth = 1;
    for (let i = 1; i < channels.length; i++) {
      const y = i * CHANNEL_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw channel labels
    ctx.font = `${FONT_SIZE}px 'League Mono'`;
    ctx.textBaseline = "middle";

    // For each channel, draw visible notes
    for (let ci = 0; ci < channels.length; ci++) {
      const chIdx = channels[ci];
      const chNotes = getNotesForChannel(chIdx);
      if (!chNotes || chNotes.length === 0) continue;

      const yBase = ci * CHANNEL_HEIGHT;
      const yCenter = yBase + CHANNEL_HEIGHT / 2;

      // Binary search for first note that could be visible
      // A note is visible if its startSec < viewEndSec (it starts before the right edge)
      // and its text could extend into view (we need to check noteEndSec or at least
      // a reasonable range)
      let lo = 0;
      let hi = chNotes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        // Notes end at durationEndSec; if durationEndSec < viewStartSec, skip
        if (chNotes[mid].tick + chNotes[mid].duration < viewStartTick) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }

      for (let ni = chNotes.length - 1; ni >= lo; ni--) {
        const note = chNotes[ni];
        // if (note.tick > viewEndTick) break; // past right edge
        if (note.tick + note.duration < viewStartTick) break;

        // Check if note is currently sounding (between start and gate end)
        const isSounding =
          currentTick >= note.tick &&
          currentTick <
            note.tick +
              note.gateDuration +
              (note.duration / (note.synth.durationSec ?? 1)) *
                (note.synth.envelope?.releaseTime ?? 0);

        if (isSounding) {
          // Draw green background for the note's sounding range
          const bgX = halfWidth + (note.tick - currentTick) * PIXELS_PER_TICK;

          const tickPerSecond = note.duration / note.synth.durationSec!;
          const pixelPerSecond = PIXELS_PER_TICK * tickPerSecond;

          // const bgW = note.duration * PIXELS_PER_TICK;
          ctx.save();
          ctx.fillStyle = colorPrimary;
          // ctx.beginPath();
          // ctx.roundRect(bgX, yBase, bgW, CHANNEL_HEIGHT, SOUNDING_RADIUS);
          // ctx.fill();
          ctx.translate(bgX, yBase);
          note.synth.envelope?.drawADSR(
            ctx,
            pixelPerSecond,
            CHANNEL_HEIGHT - 1,
          );
          ctx.restore();
          soundingNotes.current[ci] = note;

          // modulation
          if(note.synth.modulation?.enabled && note.synth.envelope){
            ctx.fillStyle = colorLabel;
            for(let sec = note.synth.modulation.delay; sec < (note.synth.gateDurationSec ?? 0) + note.synth.envelope.releaseTime * 0.25; sec += note.synth.modulation.period){
            ctx.beginPath();
            ctx.roundRect(
              bgX + sec * pixelPerSecond,
              yBase + CHANNEL_HEIGHT - 3,
              note.synth.modulation.period / 2 * pixelPerSecond,
              2,
              2,
            );
            ctx.fill();
            }
          }

          // 次のノートの開始タイミングで表示をカット
          const nextNote = chNotes.at(ni + 1);
          if (nextNote) {
            ctx.save();
            ctx.fillStyle = colorBase100;
            ctx.globalAlpha = 0.5;
            ctx.fillRect(
              halfWidth + (nextNote.tick - currentTick) * PIXELS_PER_TICK,
              yBase,
              halfWidth,
              CHANNEL_HEIGHT - 1,
            );
            ctx.restore();
          }


          break;
        }
      }
      for (let ni = 0; ni < chNotes.length; ni++) {
        const note = chNotes[ni];
        if (note.tick > viewEndTick) break; // past right edge
        // if(note.tick + note.duration < viewStartTick) break;

        const x = halfWidth + (note.tick - currentTick) * PIXELS_PER_TICK;

        // Draw note name
        for (const seg of note.segments) {
          const segmentX = x + seg.tickOffset * PIXELS_PER_TICK;
          ctx.fillStyle = octaveColor(seg.octave);
          ctx.textAlign = "left";
          ctx.fillText(seg.noteStr, segmentX + PADDING_X, yCenter);
        }
        if (note.segments.at(-1)?.portamentoTargetNoteStr) {
          // 長さのないポルタメントの場合だけ、直前の音符と重ねて右寄せにする
          const endX = x + note.duration * PIXELS_PER_TICK;
          ctx.fillStyle = octaveColor(
            note.segments.at(-1)!.portamentoTargetOctave!,
          );
          ctx.textAlign = "right";
          ctx.fillText(
            note.segments.at(-1)!.portamentoTargetNoteStr!,
            endX - PADDING_X,
            yCenter,
          );
        }
      }
    }

    // Draw center line (current time marker)
    ctx.strokeStyle = "#ffffffc0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(halfWidth, 0);
    ctx.lineTo(halfWidth, height);
    ctx.stroke();

    const VEL_WIDTH = 32;
    const PAN_WIDTH = 32;
    const NOTE_WIDTH = 26;
    const DETUNE_WIDTH = 26;
    const cw2 = Math.round(
      (VEL_WIDTH + PAN_WIDTH + NOTE_WIDTH + DETUNE_WIDTH) * dpr,
    );
    if (canvas2.width !== cw2 || canvas2.height !== ch) {
      canvas2.width = cw2;
      canvas2.height = ch;
      canvas2.style.height = `${height}px`;
    }

    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx2.clearRect(0, 0, width, height);
    ctx2.textBaseline = "alphabetic";

    for (let ci = 0; ci < channels.length; ci++) {
      const p = soundingNotes.current[ci];
      if (p) {
        const s =
          p.segments.findLast((s) => p.tick + s.tickOffset <= currentTick) ??
          p.segments[0];

        const yBase = ci * CHANNEL_HEIGHT;
        const yBaseline = yBase + CHANNEL_HEIGHT * 0.75;
        const tickPerSecond = p.duration / (p.synth.durationSec ?? 1);

        const vel = s.velocity * s.volume;
        const pan = s.pan;
        let noteNumber: number = s.noteNumber;
        let detune: number = Math.round(centsToSbDetune(s.detuneCents));
        let detuneChangedByPortamento = false;
        if (
          s.isPortamento &&
          s.portamentoTargetNote !== undefined &&
          s.portamentoTargetDetuneCents !== undefined
        ) {
          const prevNoteNumber64 = s.noteNumber * 64 + detune;
          const nextNoteNumber64 =
            s.portamentoTargetNote * 64 +
            Math.round(centsToSbDetune(s.portamentoTargetDetuneCents));
          const currentNoteNumber64 =
            prevNoteNumber64 +
            Math.round(
              (nextNoteNumber64 - prevNoteNumber64) *
                Math.max(
                  0,
                  Math.min(
                    1,
                    (currentTick - s.tickOffset - p.tick) / s.durationTicks,
                  ),
                ),
            );
          detuneChangedByPortamento = prevNoteNumber64 !== currentNoteNumber64;
          if (nextNoteNumber64 > prevNoteNumber64) {
            noteNumber = Math.floor((currentNoteNumber64 - detune) / 64);
          } else {
            noteNumber = Math.ceil((currentNoteNumber64 - detune) / 64);
          }
          detune = currentNoteNumber64 - noteNumber * 64;
        }

        const moduletionValue = p.synth.modulation?.getValue((currentTick - p.tick) / tickPerSecond) ?? 0;
        const beforeRelease = (currentTick - p.tick) / tickPerSecond < (p.synth.gateDurationSec ?? 0) + (p.synth.envelope?.releaseTime ?? 0);

        let velDisplay = vel;
        ctx2.fillStyle = colorPrimary;
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "tremolo" && moduletionValue !== 0 && beforeRelease){
          ctx2.fillStyle = colorLabel;
          // tremoloのdepthもvolumeも線形でないので単位があっていないが、変換面倒なので一旦これで
          velDisplay += moduletionValue * 127 * 127;
        }
        ctx2.beginPath();
        ctx2.roundRect(
          0,
          yBase + CHANNEL_HEIGHT - 2,
          (VEL_WIDTH * velDisplay) / 127 / 127,
          2,
          2,
        );
        ctx2.fill();

        let panDisplay = pan;
        ctx2.fillStyle = colorPrimary;
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "autoPan" && moduletionValue !== 0 && beforeRelease){
          ctx2.fillStyle = colorLabel;
          panDisplay += moduletionValue * 64;
        }
        ctx2.beginPath();
        if (panDisplay > 64) {
          ctx2.roundRect(
            VEL_WIDTH + PAN_WIDTH / 2,
            yBase + CHANNEL_HEIGHT - 2,
            ((PAN_WIDTH / 2) * (panDisplay - 64)) / 64,
            2,
            2,
          );
        } else {
          ctx2.roundRect(
            VEL_WIDTH + PAN_WIDTH / 2 - ((PAN_WIDTH / 2) * (64 - panDisplay)) / 64,
            yBase + CHANNEL_HEIGHT - 2,
            ((PAN_WIDTH / 2) * (64 - panDisplay)) / 64,
            2,
            2,
          );
        }
        ctx2.fill();

        let detuneDisplay = detune;
        ctx2.fillStyle = colorPrimary;
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "vibrato" && moduletionValue !== 0 && beforeRelease){
          ctx2.fillStyle = colorLabel;
          detuneDisplay += moduletionValue * 64;
        }
        if (detuneChangedByPortamento) {
          ctx2.fillStyle = "#ffffff";
        }
        ctx2.beginPath();
        if (detuneDisplay > 0) {
          ctx2.roundRect(
            VEL_WIDTH + PAN_WIDTH + (NOTE_WIDTH + DETUNE_WIDTH) / 2,
            yBase + CHANNEL_HEIGHT - 2,
            // 表示スケールをvel,panとそろえる
            // このスケールでは全体が表示できないが、D+127のような大きなデチューンは使用頻度が低いのでまあ良いでしょう
            ((PAN_WIDTH / 2) * detuneDisplay) / 64,
            2,
            2,
          );
        } else {
          ctx2.roundRect(
            VEL_WIDTH +
              PAN_WIDTH +
              (NOTE_WIDTH + DETUNE_WIDTH) / 2 +
              ((PAN_WIDTH / 2) * detuneDisplay) / 64,
            yBase + CHANNEL_HEIGHT - 2,
            -((PAN_WIDTH / 2) * detuneDisplay) / 64,
            2,
            2,
          );
        }
        ctx2.fill();

        ctx2.font = `14px "M+ 1p", "M+ 1c", "M PLUS 1p"`;
        ctx2.fillStyle = colorStatement;
        ctx2.textAlign = "center";
        ctx2.fillText(
          Math.round(vel / 127).toString(),
          VEL_WIDTH / 2,
          yBaseline,
        );

        ctx2.fillText(
          Math.round(pan).toString(),
          VEL_WIDTH + PAN_WIDTH / 2,
          yBaseline,
        );

        ctx2.fillStyle = "#ffffff";
        ctx2.textAlign = "right";
        if (p.tick <= currentTick && p.tick + p.duration > currentTick) {
          ctx2.fillText(
            noteNumber.toString(),
            VEL_WIDTH + PAN_WIDTH + NOTE_WIDTH,
            yBaseline,
          );
        }
        if (detune !== 0) {
          ctx2.fillStyle = colorStatement;
          ctx2.font = `10px "M+ 1p", "M+ 1c", "M PLUS 1p"`;
          ctx2.textAlign = "left";
          ctx2.fillText(
            detune.toLocaleString("en", {
              signDisplay: "always",
              useGrouping: false,
            }),
            VEL_WIDTH + PAN_WIDTH + NOTE_WIDTH,
            yBaseline,
          );
        }

        ctx2.fillStyle = colorLabel;
        ctx2.font = `10px "M+ 1p", "M+ 1c", "M PLUS 1p"`;
          ctx2.textAlign = "left";
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "tremolo"){
          ctx2.fillText(
            "A",
            VEL_WIDTH * 0.9,
            yBase + CHANNEL_HEIGHT * 0.6,
          );
        }
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "autoPan"){
          ctx2.fillText(
            "L",
            VEL_WIDTH + PAN_WIDTH * 0.9,
            yBase + CHANNEL_HEIGHT * 0.6,
          );
        }
        if(p.synth.modulation?.enabled && p.synth.modulation.type === "vibrato"){
          ctx2.fillText(
            "P",
            VEL_WIDTH + PAN_WIDTH + NOTE_WIDTH,
            yBase + CHANNEL_HEIGHT * 0.6,
          );
        }
      }
    }

    setCurrentPrograms((prev) => {
      let changed = false;
      for (let ci = 0; ci < soundingNotes.current.length; ci++) {
        const currentProgram = soundingNotes.current[ci]
          ? ({
              program: soundingNotes.current[ci]!.program,
              type: soundingNotes.current[ci]!.synth.voiceType,
              envelopeEnabled: soundingNotes.current[ci]!.envelope.enabled,
            } satisfies (typeof prev)[number])
          : undefined;
        if (
          currentProgram !== undefined &&
          (prev[ci]?.program !== currentProgram.program ||
            prev[ci]?.type !== currentProgram.type ||
            prev[ci]?.envelopeEnabled !== currentProgram.envelopeEnabled)
        ) {
          changed = true;
          prev[ci] = currentProgram;
        }
      }
      if (changed) {
        return prev.slice();
      } else {
        return prev;
      }
    });
  }, [
    channels,
    getCurrentTick,
    colorBase100,
    colorPrimary,
    colorStatement,
    colorLabel,
    getNotesForChannel,
  ]);

  // Animation loop
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };

    if (isPlaying) {
      loop();
    } else {
      // Draw once when not playing (e.g. after seek)
      document.fonts
        .load(`${FONT_SIZE}px 'League Mono'`)
        .catch(() => undefined)
        .then(() => draw());
    }

    return () => {
      running = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [isPlaying, draw]);

  // Redraw when notes/channels change (even while paused)
  useEffect(() => {
    draw();
  }, [channels, draw]);

  const canvasHeight = channels.length * CHANNEL_HEIGHT;

  return (
    <div className="flex gap-1">
      <div className="flex flex-col justify-around text-sm/0 items-end">
        {channels.map((c) => (
          <span key={c}>{c}:</span>
        ))}
      </div>
      <div
        ref={canvasRectRef}
        className="flex-1 min-w-0"
        style={{ height: `${canvasHeight}px` }}
      >
        <canvas ref={canvasRef} style={{ imageRendering: "auto" }} />
      </div>
      <div className="relative hidden sm:flex flex-col text-center items-center whitespace-nowrap w-12">
        <span className="absolute bottom-full inset-x-0 flex text-xs">
          <span className="text-sb3-label w-full">@</span>
        </span>
        {channels.map((_, ci) =>
          currentPrograms[ci] !== undefined ? (
            <span
              key={ci}
              style={{
                height: CHANNEL_HEIGHT - 2,
                marginTop: 1,
                marginBottom: 1,
              }}
              className="flex justify-center items-baseline gap-0.5"
            >
              <span
                className={clsx(
                  "h-full rounded-sm px-0.5 badge badge-sm",
                  currentPrograms[ci].type === "sf2"
                    ? "badge-success"
                    : currentPrograms[ci].type === "basicWave"
                      ? "badge-warning"
                      : currentPrograms[ci].type === "nds"
                        ? "badge-accent"
                        : "badge-ghost text-sb3-label",
                )}
              >
                {currentPrograms[ci].program}
              </span>
              {currentPrograms[ci].envelopeEnabled && (
                <span className="text-sb3-label text-[0.6rem]">E</span>
              )}
            </span>
          ) : (
            <span
              key={ci}
              style={{ height: CHANNEL_HEIGHT }}
              className="flex-1 basis-0 min-h-0"
            />
          ),
        )}
      </div>
      <div
        ref={canvasRectRef2}
        className="relative hidden md:block -mr-3 text-center whitespace-nowrap"
        style={{ height: `${canvasHeight}px` }}
      >
        <span className="absolute bottom-full inset-x-0 flex items-baseline text-xs">
          <span className="text-sb3-statement w-[32px]">V*@V</span>
          <span className="text-sb3-statement w-[32px]">P</span>
          <span className="text-sb3-text w-[26px] text-right">N</span>
          <span className="text-sb3-statement w-[26px] text-[0.6rem] text-left">
            @D
          </span>
        </span>
        <canvas ref={canvasRef2} style={{ imageRendering: "auto" }} />
      </div>
    </div>
  );
};
