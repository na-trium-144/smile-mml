/**
 * AudioPlayer Component
 * Provides Play/Pause/Stop UI, progress seek bar, optional SF2/NDS ROM loading,
 * and wires MMLEvents through the audio engine pipeline for WebAudio playback.
 */

import { useState, useRef, useCallback, useEffect, type FC } from 'react';
import type { MMLEvent } from '../parser/types.js';
import { InstrumentRegistry } from '../audio/banks/InstrumentRegistry.js';
import { SF2InstrumentBank } from '../audio/banks/SF2InstrumentBank.js';
import { NDSInstrumentBank } from '../audio/banks/NDSInstrumentBank.js';
import { SynthEngine } from '../audio/synth/SynthEngine.js';
import { MMLScheduler } from '../audio/scheduler/MMLScheduler.js';
import { preparePlaybackEvents } from '../audio/track/trackProcessor.js';

interface AudioPlayerProps {
  /** MML events from the parser */
  events: MMLEvent[];
  /** Ticks per whole note from parser (default: 192) */
  ticksPerWholeNote?: number;
}

type PlaybackState = 'stopped' | 'playing' | 'paused';

export const AudioPlayer: FC<AudioPlayerProps> = ({
  events,
  ticksPerWholeNote = 192,
}) => {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [sf2Name, setSf2Name] = useState<string | null>(null);
  const [ndsName, setNdsName] = useState<string | null>(null);
  const [loadingAsset, setLoadingAsset] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Persistent audio engine instances (survive across play/stop cycles)
  const registryRef = useRef<InstrumentRegistry | null>(null);
  const synthRef = useRef<SynthEngine | null>(null);
  const schedulerRef = useRef<MMLScheduler | null>(null);

  // Ensure registry and synth are initialized once
  const getRegistry = useCallback(() => {
    if (!registryRef.current) {
      registryRef.current = new InstrumentRegistry();
    }
    return registryRef.current;
  }, []);

  const getSynth = useCallback(() => {
    if (!synthRef.current) {
      synthRef.current = new SynthEngine(getRegistry());
    }
    return synthRef.current;
  }, [getRegistry]);

  // Stop and clean up scheduler when events change
  useEffect(() => {
    return () => {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
    };
  }, [events]);

  // ── SF2 SoundFont Loading ──
  const handleSF2Load = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLoadingAsset('SF2');
      setLoadError(null);

      try {
        const buffer = await file.arrayBuffer();
        const sf2Bank = new SF2InstrumentBank(file.name);
        await sf2Bank.load(buffer);
        getRegistry().register(sf2Bank);
        setSf2Name(file.name);
      } catch (err) {
        console.error('SF2 load error:', err);
        setLoadError(`SF2 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoadingAsset(null);
      }
    },
    [getRegistry]
  );

  // ── NDS ROM Loading ──
  const handleNDSLoad = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLoadingAsset('NDS ROM');
      setLoadError(null);

      try {
        const buffer = await file.arrayBuffer();
        const ndsBank = new NDSInstrumentBank();
        await ndsBank.load(buffer);
        getRegistry().register(ndsBank);
        setNdsName(file.name);
      } catch (err) {
        console.error('NDS ROM load error:', err);
        setLoadError(`NDS ROM 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoadingAsset(null);
      }
    },
    [getRegistry]
  );

  // ── Build or Rebuild Scheduler from current events ──
  const buildScheduler = useCallback(() => {
    // Dispose old scheduler
    schedulerRef.current?.dispose();
    schedulerRef.current = null;

    if (events.length === 0) return null;

    const synth = getSynth();
    const preparedEvents = preparePlaybackEvents(events);
    const scheduler = new MMLScheduler(synth, preparedEvents, ticksPerWholeNote);

    scheduler.onProgress = (curSec, totalSec) => {
      setCurrentTime(curSec);
      setTotalTime(totalSec);
    };

    scheduler.onEnded = () => {
      setPlaybackState('stopped');
      setCurrentTime(0);
    };

    schedulerRef.current = scheduler;
    setTotalTime(scheduler.duration);
    return scheduler;
  }, [events, ticksPerWholeNote, getSynth]);

  // ── Play / Pause / Stop ──
  const handlePlay = useCallback(async () => {
    if (playbackState === 'playing') return;

    let scheduler = schedulerRef.current;

    // If stopped (not paused), rebuild scheduler fresh
    if (!scheduler || playbackState === 'stopped') {
      scheduler = buildScheduler();
    }

    if (!scheduler) return;

    try {
      await scheduler.play();
      setPlaybackState('playing');
    } catch (err) {
      console.error('Playback error:', err);
      setLoadError(`再生エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [playbackState, buildScheduler]);

  const handlePause = useCallback(() => {
    schedulerRef.current?.pause();
    setPlaybackState('paused');
  }, []);

  const handleStop = useCallback(() => {
    schedulerRef.current?.stop();
    setPlaybackState('stopped');
    setCurrentTime(0);
  }, []);

  // ── Seek ──
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTo = parseFloat(e.target.value);
    schedulerRef.current?.seek(seekTo);
    setCurrentTime(seekTo);
  }, []);

  // ── Time Formatting ──
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const hasEvents = events.length > 0;

  return (
    <div className="audio-player">
      <h3>🔊 オーディオ再生</h3>

      {/* Sound Source Files */}
      <div className="sound-sources">
        <div className="source-row">
          <label className="source-label">
            🎹 SoundFont (.sf2):
            <input
              type="file"
              accept=".sf2,.SF2"
              onChange={handleSF2Load}
              disabled={loadingAsset !== null}
            />
          </label>
          {sf2Name && <span className="source-badge loaded">✓ {sf2Name}</span>}
        </div>

        <div className="source-row">
          <label className="source-label">
            🎮 NDS ROM (.nds / .sdat):
            <input
              type="file"
              accept=".nds,.NDS,.sdat,.SDAT"
              onChange={handleNDSLoad}
              disabled={loadingAsset !== null}
            />
          </label>
          {ndsName && <span className="source-badge loaded">✓ {ndsName}</span>}
        </div>

        <div className="source-info">
          💡 PSG音源 (@144〜@151) は常に利用可能です。
          {!sf2Name && !ndsName && ' SF2/ROM が未読み込みの場合、矩形波でフォールバック再生します。'}
        </div>

        {loadingAsset && (
          <div className="loading-indicator">⏳ {loadingAsset} を読み込み中...</div>
        )}
        {loadError && <div className="audio-error">{loadError}</div>}
      </div>

      {/* Transport Controls */}
      <div className="transport-controls">
        <div className="transport-buttons">
          {playbackState !== 'playing' ? (
            <button
              type="button"
              className="transport-btn play-btn"
              onClick={handlePlay}
              disabled={!hasEvents}
              title="再生"
            >
              ▶
            </button>
          ) : (
            <button
              type="button"
              className="transport-btn pause-btn"
              onClick={handlePause}
              title="一時停止"
            >
              ⏸
            </button>
          )}

          <button
            type="button"
            className="transport-btn stop-btn"
            onClick={handleStop}
            disabled={playbackState === 'stopped'}
            title="停止"
          >
            ⏹
          </button>
        </div>

        {/* Progress Bar */}
        <div className="progress-section">
          <span className="time-display">{formatTime(currentTime)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={totalTime || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            disabled={!hasEvents}
          />
          <span className="time-display">{formatTime(totalTime)}</span>
        </div>
      </div>
    </div>
  );
};
