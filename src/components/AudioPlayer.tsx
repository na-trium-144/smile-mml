/**
 * AudioPlayer Component
 * Provides Play/Pause/Stop UI with progress seek bar.
 * Receives MML text and InstrumentRegistry; parses MML on play if changed.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { MMLEvent } from "../parser/types.js";
import { parseMML } from "../parser/vmmlParser.js";
import { SynthEngine } from "../audio/synth/SynthEngine.js";
import { MMLScheduler } from "../audio/scheduler/MMLScheduler.js";
import { preparePlaybackEvents } from "../audio/track/trackProcessor.js";
import { useInstrumentContext } from "./InstrumentContext.js";
import { NoteVisualizer, buildVisualizerNotes } from "./NoteVisualizer.js";
import clsx from "clsx";

interface AudioPlayerProps {
  /** MML source text */
  mml: string;
}

type PlaybackState = null | "playing" | "paused";

const TICKS_PER_WHOLE_NOTE = 192;

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function AudioPlayer({ mml }: AudioPlayerProps) {
  const { registry } = useInstrumentContext();

  const [playbackState, setPlaybackState] = useState<PlaybackState>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [schedulerError, setSchedulerError] = useState<string[]>([]);

  // Track last‐parsed MML to avoid redundant parsing
  const lastParsedMml = useRef("");
  const eventsRef = useRef<MMLEvent[]>([]);
  const mmlHasChanged = useCallback(() => mml !== lastParsedMml.current, [mml]);
  const parseMml = useCallback<() => MMLEvent[]>(() => {
    const events: MMLEvent[] = [];
    for (const ev of parseMML(mml, { stopOnInfiniteLoop: true })) {
      events.push(ev);
    }
    lastParsedMml.current = mml;
    return events;
  }, [mml]);

  const synthRef = useRef<SynthEngine | null>(null);
  const schedulerRef = useRef<MMLScheduler | null>(null);

  // Build visualizer data from parsed events
  const visualizerData = useMemo(
    () => buildVisualizerNotes(eventsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsRef.current],
  );

  // Provide a stable callback for NoteVisualizer to read current time from scheduler
  const getVisualizerTick = useCallback(
    () =>
      schedulerRef.current?.getCurrentTick() ??
      schedulerRef.current?.secondsToTick(currentTime) ?? 0,
    [currentTime],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
    };
  }, []);

  const getSynth = useCallback(() => {
    if (!synthRef.current) {
      synthRef.current = new SynthEngine(registry);
    }
    return synthRef.current;
  }, [registry]);

  const buildScheduler = useCallback<(events: MMLEvent[]) => MMLScheduler>(
    (events) => {
      setSchedulerError([]);

      const synth = getSynth();
      const preparedEvents = preparePlaybackEvents(events);
      const scheduler = new MMLScheduler(
        synth,
        preparedEvents,
        TICKS_PER_WHOLE_NOTE,
        (e) => {
          console.error("MMLScheduler error:", e);
          setSchedulerError((prev) => {
            if (prev.includes(String(e))) {
              return prev;
            } else {
              return prev.concat([String(e)]);
            }
          });
        },
      );

      scheduler.onProgress = (curSec, totalSec) => {
        setCurrentTime(curSec);
        setTotalTime(totalSec);
      };

      scheduler.onEnded = () => {
        setPlaybackState("paused");
        setCurrentTime(0);
      };

      setTotalTime(scheduler.duration);
      return scheduler;
    },
    [getSynth],
  );

  // ── Play / Pause / Stop ──

  const handlePlay = useCallback(async () => {
    if (playbackState === "playing") return;
    setError(null);
    setSchedulerError([]);

    try {
      if (mmlHasChanged()) {
        schedulerRef.current?.stop();
        schedulerRef.current?.dispose();
        schedulerRef.current = null;
        setPlaybackState(null);
        eventsRef.current = parseMml();
      }

      // If not initialized, parse MML and rebuild scheduler
      if (!schedulerRef.current) {
        schedulerRef.current = buildScheduler(eventsRef.current);
      }

      await schedulerRef.current.play();
      setPlaybackState("playing");
    } catch (err) {
      console.error("Playback error:", err);
      setError(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [playbackState, parseMml, buildScheduler, mmlHasChanged]);

  const handlePause = useCallback(() => {
    schedulerRef.current?.pause();
    setPlaybackState("paused");
  }, []);

  const handleStop = useCallback(() => {
    schedulerRef.current?.pause();
    setPlaybackState("paused");
    schedulerRef.current?.seek(0);
    setCurrentTime(0);
  }, []);

  // ── Seek ──

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTo = parseFloat(e.target.value);
    schedulerRef.current?.seek(seekTo);
    setCurrentTime(seekTo);
  }, []);

  return (
    <div className="card card-border w-full">
      <div className="card-body gap-4">
        {/*<h2 className="card-title">オーディオ再生</h2>*/}

        {/* Transport Controls + Progress */}
        <div className="flex items-center gap-2">
          <div className="join">
            {playbackState !== "playing" ? (
              <button
                type="button"
                className="btn btn-primary join-item"
                onClick={handlePlay}
                title="再生"
              >
                ▶
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-warning join-item"
                onClick={handlePause}
                title="一時停止"
              >
                ⏸
              </button>
            )}
            <button
              type="button"
              className="btn btn-soft join-item"
              onClick={handleStop}
              disabled={playbackState === null}
              title="停止"
            >
              ⏹
            </button>
          </div>

          {/* Progress Bar */}
          <span className="max-sm:flex-1 text-sm min-w-12 text-right">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            className="max-sm:hidden range range-primary range-xs flex-1"
            min={0}
            max={totalTime || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
          />
          <span className="sm:hidden mx-2">/</span>
          <span className="text-sm min-w-12">
            {formatTime(totalTime)}
          </span>
        </div>
        <input
            type="range"
            className="sm:hidden w-full range range-primary range-xs"
            min={0}
            max={totalTime || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
          />

        {/* Note Visualizer */}
        {visualizerData.channels.length > 0 && (
          <NoteVisualizer
            notes={visualizerData.notes}
            channels={visualizerData.channels}
            getCurrentTick={getVisualizerTick}
            isPlaying={playbackState === "playing"}
          />
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <span>{error}</span>
          </div>
        )}
        {schedulerError.length > 0 && (
          <div
            role="alert"
            className={clsx(
              "alert alert-warning alert-vertical gap-1 text-left justify-start",
              "max-h-[20vh] overflow-y-auto",
            )}
          >
            {schedulerError.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
