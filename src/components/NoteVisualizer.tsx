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


/**
 * Returns a CSS color string for the given octave.
 * O4 = white, higher octaves → yellow → red, lower octaves → cyan → blue.
 */
function octaveColor(octave: number): string {
  const diff = octave - 4;
  if (diff === 0) return "#ffffff";
  if (diff > 0) {
    // white → yellow → red
    const t = Math.min(diff / 4, 1);
    if (t <= 0.5) {
      // white → yellow: decrease blue
      const ratio = t * 2;
      const b = Math.round(255 * (1 - ratio));
      return `rgb(255,255,${b})`;
    } else {
      // yellow → red: decrease green
      const ratio = (t - 0.5) * 2;
      const g = Math.round(255 * (1 - ratio));
      return `rgb(255,${g},0)`;
    }
  } else {
    // white → cyan → blue
    const t = Math.min(-diff / 4, 1);
    if (t <= 0.5) {
      // white → cyan: decrease red
      const ratio = t * 2;
      const r = Math.round(255 * (1 - ratio));
      return `rgb(${r},255,255)`;
    } else {
      // cyan → blue: decrease green
      const ratio = (t - 0.5) * 2;
      const g = Math.round(255 * (1 - ratio));
      return `rgb(0,${g},255)`;
    }
  }
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
const SOUNDING_RADIUS = 4;
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

  const soundingNotes = useRef<(PostProcessedNote | undefined)[]>([]);
  const [currentPrograms, setCurrentPrograms] = useState<
    (number | undefined)[]
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

      for (let ni = lo; ni < chNotes.length; ni++) {
        const note = chNotes[ni];
        if (note.tick > viewEndTick) break; // past right edge

        const x = halfWidth + (note.tick - currentTick) * PIXELS_PER_TICK;

        // Check if note is currently sounding (between start and gate end)
        const isSounding =
          currentTick >= note.tick && currentTick < note.tick + note.duration;

        if (isSounding) {
          // Draw green background for the note's sounding range
          const bgX =
            halfWidth + (note.tick - currentTick) * PIXELS_PER_TICK;
          const bgW = note.duration * PIXELS_PER_TICK;
          ctx.fillStyle = colorPrimary;
          ctx.beginPath();
          ctx.roundRect(bgX, yBase, bgW, CHANNEL_HEIGHT, SOUNDING_RADIUS);
          ctx.fill();

          soundingNotes.current[ci] = note;
        }

        // Draw note name
        for(const seg of note.segments){
          const segmentX = x + seg.tickOffset * PIXELS_PER_TICK;
          ctx.fillStyle = octaveColor(seg.octave);
          ctx.textAlign = "left";
          ctx.fillText(seg.noteStr, segmentX + PADDING_X, yCenter);
        }
        if(note.segments.at(-1)?.portamentoTargetNoteStr){
          // 長さのないポルタメントの場合だけ、直前の音符と重ねて右寄せにする
          const endX = x + note.duration * PIXELS_PER_TICK;
          ctx.fillStyle = octaveColor(note.segments.at(-1)!.portamentoTargetOctave!);
          ctx.textAlign = "right";
          ctx.fillText(note.segments.at(-1)!.portamentoTargetNoteStr!, endX - PADDING_X, yCenter);
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
    const cw2 = Math.round((VEL_WIDTH + PAN_WIDTH) * dpr);
    if (canvas2.width !== cw2 || canvas2.height !== ch) {
      canvas2.width = cw2;
      canvas2.height = ch;
      canvas2.style.height = `${height}px`;
    }

    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx2.clearRect(0, 0, width, height);
    ctx2.font = `14px "M+ 1p", "M+ 1c", "M PLUS 1p"`;
    ctx2.textBaseline = "middle";

    for (let ci = 0; ci < channels.length; ci++) {
      const p = soundingNotes.current[ci];
      if (p) {
        const yBase = ci * CHANNEL_HEIGHT;
        const yCenter = yBase + CHANNEL_HEIGHT / 2;

        ctx2.fillStyle = colorPrimary;
        ctx2.beginPath();
        ctx2.roundRect(
          0,
          yBase + CHANNEL_HEIGHT - 2,
          (VEL_WIDTH * (p.velocity * p.volume)) / 127 / 127,
          2,
          2,
        );
        ctx2.fill();

        ctx2.beginPath();
        if (p.pan > 64) {
          ctx2.roundRect(
            VEL_WIDTH + PAN_WIDTH / 2,
            yBase + CHANNEL_HEIGHT - 2,
            ((PAN_WIDTH / 2) * (p.pan - 64)) / 64,
            2,
            2,
          );
        } else {
          ctx2.roundRect(
            VEL_WIDTH + PAN_WIDTH / 2 - (PAN_WIDTH * (64 - p.pan)) / 64,
            yBase + CHANNEL_HEIGHT - 2,
            (PAN_WIDTH * (64 - p.pan)) / 64,
            2,
            2,
          );
        }
        ctx2.fill();

        ctx2.fillStyle = colorStatement;
        ctx2.textAlign = "center";
        ctx2.fillText(
          Math.round((p.velocity * p.volume) / 127).toString(),
          VEL_WIDTH / 2,
          yCenter,
        );

        ctx2.fillText(
          Math.round(p.pan).toString(),
          VEL_WIDTH + PAN_WIDTH / 2,
          yCenter,
        );
      }
    }

    setCurrentPrograms((prev) => {
      let changed = false;
      for (let ci = 0; ci < soundingNotes.current.length; ci++) {
        const currentProgram = soundingNotes.current[ci]?.program;
        if (currentProgram !== undefined && prev[ci] !== currentProgram) {
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
  }, [channels, getCurrentTick, colorBase100, colorPrimary, colorStatement, getNotesForChannel]);

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
      draw();
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
      <div className="relative hidden md:flex flex-col text-sm text-center whitespace-nowrap w-10">
        {channels.map((_, ci) =>
          currentPrograms[ci] !== undefined ? (
            <span key={ci} className="flex-1 basis-0 text-sb3-label">
              @{currentPrograms[ci]}
            </span>
          ) : (
            <span key={ci} className="flex-1" />
          ),
        )}
      </div>
      <div
        ref={canvasRectRef2}
        className="relative hidden md:block text-center whitespace-nowrap"
        style={{ height: `${canvasHeight}px` }}
      >
        <span className="absolute bottom-full inset-x-0 flex text-xs">
          <span className="text-sb3-statement w-8">V*@V</span>
          <span className="text-sb3-statement w-8">P</span>
        </span>
        <canvas ref={canvasRef2} style={{ imageRendering: "auto" }} />
      </div>
    </div>
  );
};
