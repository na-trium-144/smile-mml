import { useState, type FC } from 'react';
import type { MMLEvent, NoteEvent } from '../parser/types.js';

interface MidiPreviewProps {
  events: MMLEvent[];
  midiBytes: Uint8Array | null;
  fileName: string;
  conversionTimeMs: number;
}

export const MidiPreview: FC<MidiPreviewProps> = ({
  events,
  midiBytes,
  fileName,
  conversionTimeMs,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'events'>('summary');
  const [filterChannel, setFilterChannel] = useState<number | 'all'>('all');

  const notes = events.filter((e): e is NoteEvent => e.type === 'note');
  const tempos = events.filter((e) => e.type === 'tempo');
  const loops = events.filter((e) => e.type === 'loop');

  // Channel statistics
  const channelStats: Record<number, { notes: number; program: number; maxTick: number }> = {};
  for (const n of notes) {
    if (!channelStats[n.channel]) {
      channelStats[n.channel] = { notes: 0, program: n.program, maxTick: 0 };
    }
    channelStats[n.channel].notes++;
    channelStats[n.channel].program = n.program;
    channelStats[n.channel].maxTick = Math.max(
      channelStats[n.channel].maxTick,
      n.tick + n.duration
    );
  }

  const handleDownload = () => {
    if (!midiBytes) return;
    const blob = new Blob([midiBytes as unknown as BlobPart], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const outName = fileName.replace(/\.[^/.]+$/, '') || 'output';
    a.href = url;
    a.download = `${outName}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredEvents = events.filter((e) => {
    if (filterChannel === 'all') return true;
    if ('channel' in e) {
      return e.channel === filterChannel;
    }
    return true;
  });

  return (
    <div className="preview-container">
      <div className="preview-header">
        <div className="preview-title">
          <h2>📊 変換結果 & MIDI ダウンロード</h2>
          <span className="conversion-badge">
            ⚡ 変換時間: {conversionTimeMs.toFixed(1)}ms
          </span>
        </div>

        {midiBytes && (
          <button type="button" className="download-btn" onClick={handleDownload}>
            💾 Standard MIDI (.mid) をダウンロード
            <span className="file-size">({(midiBytes.length / 1024).toFixed(1)} KB)</span>
          </button>
        )}
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          サマリー情報
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          パースイベント一覧 ({events.length})
        </button>
      </div>

      {activeTab === 'summary' && (
        <div className="summary-section">
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">総ノート数</span>
              <span className="stat-value">{notes.length.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">使用チャンネル数</span>
              <span className="stat-value">{Object.keys(channelStats).length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">テンポ変更数</span>
              <span className="stat-value">{tempos.length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">ループ検出数</span>
              <span className="stat-value">{loops.length}</span>
            </div>
          </div>

          <h3>チャンネル別統計</h3>
          <div className="channel-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ch</th>
                  <th>音色 (@)</th>
                  <th>ノート数</th>
                  <th>総Ticks</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(channelStats).map(([chStr, stat]) => {
                  const ch = parseInt(chStr, 10);
                  return (
                    <tr key={ch}>
                      <td>
                        <span className="channel-badge">:{ch}</span>
                      </td>
                      <td>@{stat.program}</td>
                      <td>{stat.notes.toLocaleString()}</td>
                      <td>{stat.maxTick.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="events-section">
          <div className="filter-bar">
            <label>チャンネル絞り込み: </label>
            <select
              value={filterChannel}
              onChange={(e) =>
                setFilterChannel(
                  e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10)
                )
              }
            >
              <option value="all">すべてのチャンネル</option>
              {Object.keys(channelStats).map((ch) => (
                <option key={ch} value={ch}>
                  チャンネル :{ch}
                </option>
              ))}
            </select>
            <span className="events-count">表示中: {Math.min(500, filteredEvents.length)} 件</span>
          </div>

          <div className="events-table-wrapper">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Tick</th>
                  <th>Ch</th>
                  <th>イベント</th>
                  <th>詳細パラメータ</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 500).map((ev, idx) => {
                  const ch = 'channel' in ev ? ev.channel : '-';
                  return (
                    <tr key={idx} className={`ev-row ev-${ev.type}`}>
                      <td className="tick-cell">{ev.tick}</td>
                      <td>{ch !== '-' ? <span className="channel-badge">:{ch}</span> : '-'}</td>
                      <td>
                        <span className={`type-tag type-${ev.type}`}>{ev.type}</span>
                      </td>
                      <td className="details-cell">
                        {ev.type === 'note' && (
                          <>
                          <div>
                            <strong>{ev.noteName}</strong> (#{ev.noteNumber}) | 長さ:{ev.duration} |
                            Vel:{ev.velocity} | Vol:{ev.volume} | Pan:{ev.pan} | @{ev.program}
                          </div>
                          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "break-word", width: 800 }}>
                            {JSON.stringify(ev)}
                          </pre>
                          </>
                        )}
                        {ev.type === 'tempo' && <span>BPM: {ev.bpm}</span>}
                        {ev.type === 'program' && <span>プログラム: @{ev.program}</span>}
                        {ev.type === 'control' && (
                          <span>
                            CC#{ev.controller}: {ev.value}
                          </span>
                        )}
                        {ev.type === 'pitchBend' && <span>ピッチベンド: {ev.value}</span>}
                        {ev.type === 'loop' && (
                          <span>
                            {ev.isInfinite ? '無限ループ' : `ループ ${ev.loopCount}/${ev.targetCount}`}
                          </span>
                        )}
                        {ev.type === 'end' && <span>チャンネル終端</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredEvents.length > 500 && (
            <div className="table-footnote">
              ※ パフォーマンスのため最初の 500 件を表示しています（全 {filteredEvents.length} 件）
            </div>
          )}
        </div>
      )}
    </div>
  );
};
