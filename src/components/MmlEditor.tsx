import AceEditor from "react-ace";
import "ace-builds/src-min-noconflict/theme-twilight";
import "ace-builds/src-min-noconflict/ext-searchbox";
import "./MmlHighlightRules.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type Ace from "ace-builds";
import { usePlaylist } from "./Playlist.js";
import { MmlSpec } from "./MmlSpec.js";
import clsx from "clsx";
import { extractSmileBasicMML } from "../parser/smilebasicPrg.js";

export const MMLEditor = () => {
  const { currentFile, updateContent, reParseAsPrg } = usePlaylist();
  const { content: mml } = currentFile;

  const editorRef = useRef<Ace.Editor | null>(null);

  useEffect(() => {
    (window as any).mmlHightlightRules_UpdateReferencedMacros(mml);
    editorRef.current?.session.bgTokenizer.start(0);
  }, [mml]);

  const [showSpec, setShowSpec] = useState(true);

  const parsedAsPrg = useMemo(() => extractSmileBasicMML(mml), [mml]);

  const normalizedMML = useMemo(
    () =>
      mml
        .replace(/([^\n])(:\d+)/g, "$1\n$2")
        .replace(/([^\n])({[^=}]+=)/g, "$1\n$2"),
    [mml],
  );

  return (
    <details className="collapse collapse-card-like collapse-arrow collapse-card-like-border">
      <summary className="collapse-title collapse-card-like-title flex flex-wrap items-baseline justify-between">
        <h2>MMLを編集</h2>
        <span className="text-sm text-right">{mml.length} 文字</span>
      </summary>
      <div className="collapse-content">
        <div className="flex flex-wrap flex-row mb-2 gap-1">
          {parsedAsPrg.length >= 1 && (
            <button className="btn btn-primary btn-sm" onClick={reParseAsPrg}>
              DATA 文から MML を取り出す
            </button>
          )}
          {normalizedMML !== mml && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => updateContent(normalizedMML)}
            >
              チャンネル・マクロごとに改行
            </button>
          )}
          <div className="flex-1" />
          <label className="label text-sm">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={showSpec}
              onChange={(e) => setShowSpec(e.target.checked)}
            />
            MMLコマンド一覧
          </label>
        </div>
        <div className="lg:h-[calc(100vh-8rem)] flex flex-col lg:flex-row justify-stretch">
          <div className="flex-1 textarea textarea-ghost w-[unset] touch-auto p-0">
            {/* <textarea> じゃないけどdaisyuiのtextareaクラスのborderなどのスタイルを適用 */}
            <AceEditor
              name="MMLEditor"
              value={mml}
              onLoad={(editor) => {
                editorRef.current = editor;
              }}
              onChange={(v) => updateContent(v)}
              className="max-lg:h-[calc(100vh-10rem)]!"
              width="100%"
              height="100%"
              theme="twilight"
              fontSize={16}
              wrapEnabled
              tabSize={1}
              showPrintMargin={false}
              setOptions={{ useWorker: false }}
              mode="mml"
            />
          </div>
          <div
            className={clsx(
              showSpec || "hidden",
              "divider lg:divider-horizontal",
            )}
          />
          <div
            className={clsx(showSpec || "hidden", "lg:w-64 lg:overflow-y-auto")}
          >
            <MmlSpec />
          </div>
        </div>
      </div>
    </details>
  );
};
