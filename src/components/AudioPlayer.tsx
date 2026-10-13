/**
 * AudioPlayer Component
 * Provides Play/Pause/Stop UI with progress seek bar.
 * Receives MML text and InstrumentRegistry; parses MML in real-time within MMLScheduler.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { SynthEngine } from "../audio/synth/SynthEngine.js";
import { MMLScheduler } from "../audio/scheduler/MMLScheduler.js";
import { useInstrumentContext } from "./InstrumentContext.js";
import { NoteVisualizer } from "./NoteVisualizer.js";
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
  const [activeChannels, setActiveChannels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [schedulerError, setSchedulerError] = useState<string[]>([]);

  // Track last-parsed MML to recreate scheduler if MML text changes
  const lastParsedMml = useRef("");
  const mmlHasChanged = useCallback(() => mml !== lastParsedMml.current, [mml]);

  const synthRef = useRef<SynthEngine | null>(null);
  const schedulerRef = useRef<MMLScheduler | null>(null);

  // Provide a stable callback for NoteVisualizer to read current time from scheduler
  const getVisualizerTick = useCallback(
    () =>
      schedulerRef.current?.getCurrentTick() ??
      schedulerRef.current?.secondsToTick(currentTime) ?? 0,
    [currentTime],
  );

  const getNotesForChannel = useCallback(
    (ch: number) => schedulerRef.current?.getChannelVisualizerNotes(ch) ?? [],
    [],
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

  const buildScheduler = useCallback<() => MMLScheduler>(() => {
    setSchedulerError([]);

    const synth = getSynth();
    const scheduler = new MMLScheduler(
      synth,
      mml,
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

    setActiveChannels(scheduler.channels);
    setTotalTime(scheduler.duration);
    return scheduler;
  }, [getSynth, mml]);

  // Initialize or re-create scheduler when MML changes so totalTime is immediately known
  useEffect(() => {
    if (mmlHasChanged() || !schedulerRef.current) {
      schedulerRef.current?.stop();
      schedulerRef.current?.dispose();
      schedulerRef.current = buildScheduler();
      lastParsedMml.current = mml;
      setCurrentTime(0);
      setPlaybackState(null);
    }
  }, [mml, buildScheduler, mmlHasChanged]);

  // ── Play / Pause / Stop ──

  const handlePlay = useCallback(async () => {
    if (playbackState === "playing") return;
    setError(null);
    setSchedulerError([]);

    try {
      if (mmlHasChanged() || !schedulerRef.current) {
        schedulerRef.current?.stop();
        schedulerRef.current?.dispose();
        schedulerRef.current = buildScheduler();
        lastParsedMml.current = mml;
      }

      await schedulerRef.current.play();
      setPlaybackState("playing");
    } catch (err) {
      console.error("Playback error:", err);
      setError(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [playbackState, buildScheduler, mmlHasChanged, mml]);

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

  const seekMax = Math.max(totalTime, currentTime) || 1;

  return (
    <div className="card card-border w-full">
      <div className="card-body gap-4">
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
            max={seekMax}
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
          max={seekMax}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
        />

        {/* Note Visualizer */}
        {activeChannels.length > 0 && (
          <NoteVisualizer
            channels={activeChannels}
            getCurrentTick={getVisualizerTick}
            isPlaying={playbackState === "playing"}
            getNotesForChannel={getNotesForChannel}
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
