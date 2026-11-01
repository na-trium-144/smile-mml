import { useState, useMemo, type FC } from "react";
import {
  SMFToMML,
  decodeMidiText,
  convertSmfToMml,
  type TrackConvertOption,
} from "../midi/index.js";

interface TrackItem {
  trackIndex: number;
  name: string;
  totalNotes: number;
  maxPoly: number;
  ticks: number;
  outputPoly: number;
  volume: number;
  transpose: number;
  detune: number;
}

interface Props {
  file: File;
  buffer: ArrayBuffer;
  onImport: (title: string, mml: string) => void;
  onClose: () => void;
}

export const MidiImportModal: FC<Props> = ({
  file,
  buffer,
  onImport,
  onClose,
}) => {
  const [encoding, setEncoding] = useState<string>("AUTO");
  const [format, setFormat] = useState<"mml" | "smilebasic">("mml");
  const [actionError, setActionError] = useState<string | null>(null);

  const { converter, parseError } = useMemo(() => {
    try {
      return { converter: new SMFToMML(buffer), parseError: null };
    } catch (e: any) {
      console.error("SMF parsing failed:", e);
      return { converter: null, parseError: String(e?.message || e) };
    }
  }, [buffer]);

  const [title, setTitle] = useState<string>(() => {
    if (!converter) return file.name.replace(/\.[^/.]+$/, "");
    return (
      decodeMidiText(converter.title, "AUTO") ||
      file.name.replace(/\.[^/.]+$/, "")
    );
  });

  const [tracks, setTracks] = useState<TrackItem[]>(() => {
    if (!converter) return [];
    return converter.trackInfo.map((tr, i) => {
      const decodedName = decodeMidiText(tr.name, "AUTO");
      return {
        trackIndex: i,
        name: decodedName || `Track ${i + 1}`,
        totalNotes: tr.totalNotes,
        maxPoly: tr.maxPoly,
        ticks: tr.ticks,
        outputPoly: tr.totalNotes > 0 ? Math.min(8, tr.maxPoly) : 0,
        volume: 100,
        transpose: 0,
        detune: 0,
      };
    });
  });

  const handleEncodingChange = (newEncoding: string) => {
    setEncoding(newEncoding);
    if (!converter) return;
    const newTitle =
      decodeMidiText(converter.title, newEncoding) ||
      file.name.replace(/\.[^/.]+$/, "");
    setTitle(newTitle);
    setTracks((prev) =>
      prev.map((t) => {
        const tr = converter.trackInfo[t.trackIndex];
        const decodedName = decodeMidiText(tr?.name, newEncoding);
        return {
          ...t,
          name: decodedName || `Track ${t.trackIndex + 1}`,
        };
      })
    );
  };

  const totalPoly = useMemo(
    () =>
      tracks.reduce(
        (sum, tr) => sum + (tr.totalNotes > 0 ? tr.outputPoly : 0),
        0
      ),
    [tracks]
  );

  const handleUpdateTrack = (
    index: number,
    field: keyof TrackItem,
    value: number | string
  ) => {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const handleExecuteImport = () => {
    if (!converter) return;
    try {
      setActionError(null);
      const trackOptions: TrackConvertOption[] = tracks.map((t) => ({
        trackIndex: t.trackIndex,
        name: t.name,
        outputPoly: t.outputPoly,
        volume: t.volume,
        transpose: t.transpose,
        detune: t.detune,
      }));

      const result = convertSmfToMml(buffer, {
        encoding,
        format,
        trackOptions,
      });

      onImport(title || result.title || file.name, result.mml);
      onClose();
    } catch (e: any) {
      console.error("Convert to MML failed:", e);
      setActionError(String(e?.message || e));
    }
  };

  const currentError = parseError || actionError;

  return (
    <div className="modal modal-open z-50" role="dialog">
      <div className="modal-box w-11/12 max-w-4xl max-h-[90vh] flex flex-col p-4 sm:p-6">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <h3 className="font-bold text-lg">MIDIインポート設定</h3>
          <button
            className="btn btn-sm btn-circle btn-ghost"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {currentError ? (
          <div className="alert alert-error my-4">
            <span>{currentError}</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="label text-xs font-semibold">
                  曲名 / タイトル
                </label>
                <input
                  type="text"
                  className="input input-sm input-bordered w-full"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="曲名"
                />
              </div>

              <div>
                <label className="label text-xs font-semibold">
                  文字コード (エンコーディング)
                </label>
                <select
                  className="select select-sm select-bordered w-full"
                  value={encoding}
                  onChange={(e) => handleEncodingChange(e.target.value)}
                >
                  <option value="AUTO">自動判別 (Auto)</option>
                  <option value="SJIS">Shift-JIS (CP932)</option>
                  <option value="UTF-8">UTF-8</option>
                  <option value="UTF-16">UTF-16</option>
                </select>
              </div>

              <div>
                <label className="label text-xs font-semibold">
                  出力フォーマット
                </label>
                <select
                  className="select select-sm select-bordered w-full"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as any)}
                >
                  <option value="mml">Visual MML (:0, :1 ...)</option>
                  <option value="smilebasic">SmileBASIC DATA文形式</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <span className="text-sm font-semibold">トラック設定</span>
              <span
                className={`badge ${
                  totalPoly > 16
                    ? "badge-error"
                    : totalPoly > 0
                      ? "badge-primary"
                      : "badge-neutral"
                }`}
              >
                合計出力チャンネル数: {totalPoly} / 16
              </span>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <table className="table table-xs sm:table-sm w-full">
                <thead>
                  <tr className="bg-base-200">
                    <th>#</th>
                    <th>トラック名</th>
                    <th className="text-right">ノート数</th>
                    <th className="text-right">MaxPoly</th>
                    <th className="text-center">出力Poly</th>
                    <th className="text-center">音量 (%)</th>
                    <th className="text-center">移調</th>
                    <th className="text-center">デチューン</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((t, idx) => (
                    <tr
                      key={t.trackIndex}
                      className={t.totalNotes === 0 ? "opacity-40" : ""}
                    >
                      <td>{idx + 1}</td>
                      <td>
                        <input
                          type="text"
                          className="input input-xs input-ghost w-full"
                          value={t.name}
                          onChange={(e) =>
                            handleUpdateTrack(idx, "name", e.target.value)
                          }
                        />
                      </td>
                      <td className="text-right font-mono">{t.totalNotes}</td>
                      <td className="text-right font-mono">{t.maxPoly}</td>
                      <td className="text-center">
                        <input
                          type="number"
                          className="input input-xs input-bordered w-16 text-right"
                          min={0}
                          max={16}
                          disabled={t.totalNotes === 0}
                          value={t.outputPoly}
                          onChange={(e) =>
                            handleUpdateTrack(
                              idx,
                              "outputPoly",
                              Math.max(
                                0,
                                Math.min(16, parseInt(e.target.value, 10) || 0)
                              )
                            )
                          }
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="number"
                          className="input input-xs input-bordered w-16 text-right"
                          min={1}
                          max={100}
                          disabled={t.totalNotes === 0}
                          value={t.volume}
                          onChange={(e) =>
                            handleUpdateTrack(
                              idx,
                              "volume",
                              Math.max(
                                1,
                                Math.min(100, parseInt(e.target.value, 10) || 100)
                              )
                            )
                          }
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="number"
                          className="input input-xs input-bordered w-16 text-right"
                          min={-24}
                          max={24}
                          disabled={t.totalNotes === 0}
                          value={t.transpose}
                          onChange={(e) =>
                            handleUpdateTrack(
                              idx,
                              "transpose",
                              Math.max(
                                -24,
                                Math.min(24, parseInt(e.target.value, 10) || 0)
                              )
                            )
                          }
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="number"
                          className="input input-xs input-bordered w-16 text-right"
                          min={-64}
                          max={64}
                          disabled={t.totalNotes === 0}
                          value={t.detune}
                          onChange={(e) =>
                            handleUpdateTrack(
                              idx,
                              "detune",
                              Math.max(
                                -64,
                                Math.min(64, parseInt(e.target.value, 10) || 0)
                              )
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPoly > 16 && (
              <p className="text-xs text-error">
                ※ 出力チャンネル数の合計が16を超えています。16チャンネル（:0 〜
                :15）までに収まるよう出力Polyを調整してください。
              </p>
            )}
          </div>
        )}

        <div className="modal-action border-t pt-3 mt-4">
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!converter || totalPoly === 0}
            onClick={handleExecuteImport}
          >
            MMLに変換してインポート
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
};
