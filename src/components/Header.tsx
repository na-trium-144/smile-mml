import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { usePlaylist } from "./Playlist";
import { convertMmlToMidi } from "../midi";

interface Props {
  children: ReactNode;
}

declare const _GIT_COMMIT_: string;
declare const _GIT_COMMIT_COUNT_: string;
declare const _BUILD_DATE_: string;
export function WithHeaderAndSidebar(props: Props) {
  return (
    <>
      <header className="navbar bg-base-100 border-b-2 border-base-border">
        <div className="navbar-start">
          <label
            htmlFor="SidebarToggle"
            className="lg:hidden btn btn-ghost w-max max-sm:px-2"
          >
            <svg
              aria-label="Menu"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              className="inline-block h-5 w-5 stroke-current"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16M4 18h16"
              ></path>
            </svg>
            ファイル
          </label>
        </div>
        <h1 className="navbar-center mx-4 text-2xl font-semibold">
          <img src="/favicon-white.svg" className="size-10 mr-2" />
          SmileMML
        </h1>
        <div className="relative navbar-end self-end">
          <a
            className={clsx(
              "max-sm:absolute max-sm:-bottom-2 max-sm:-right-1",
              "inline-block w-max text-sm opacity-75 link link-hover",
            )}
            href={`https://github.com/na-trium-144/smile-mml/commits/${_GIT_COMMIT_}`}
            target="_blank"
          >
            Build {_GIT_COMMIT_COUNT_}{" "}
            <span className="text-xs">
              ({_GIT_COMMIT_},{" "}
              {new Date(_BUILD_DATE_).toLocaleDateString("ja-JP")})
            </span>
          </a>
        </div>
      </header>

      <div className="drawer lg:drawer-open">
        <input type="checkbox" id="SidebarToggle" className="drawer-toggle" />
        <div className="drawer-content flex flex-col items-center p-2 sm:p-4 md:p-8">
          {/* Page content here */}
          {props.children}
        </div>
        <div className="drawer-side">
          <label
            htmlFor="SidebarToggle"
            aria-label="close sidebar"
            className="drawer-overlay"
          />
          <div
            className={clsx(
              "bg-base-200 h-full w-80 border-r-2 border-base-border max-lg:shadow-big",
              "p-2 sm:p-4 flex flex-col space-y-2",
            )}
          >
            <SidebarContent />
          </div>
        </div>
      </div>
    </>
  );
}

function SidebarContent() {
  const { files, currentIndex, setCurrentIndex, currentFile, loadFile, newFile } =
    usePlaylist();
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportMidi = () => {
    try {
      setExportError(null);
      const songTitle = currentFile.name.trim() || "Untitled";
      const midiBytes = convertMmlToMidi(currentFile.content, { songTitle });
      const blob = new Blob([new Uint8Array(midiBytes)], { type: "audio/midi" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${songTitle}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("MIDI export failed:", e);
      setExportError(`MIDIエクスポート失敗: ${e?.message || e}`);
    }
  };

  const handleExportMml = () => {
    try {
      setExportError(null);
      const songTitle = currentFile.name.trim() || "Untitled";
      const blob = new Blob([currentFile.content], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${songTitle}.mml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("MML export failed:", e);
      setExportError(`MMLエクスポート失敗: ${e?.message || e}`);
    }
  };

  return (
    <>
      <h3 className="font-semibold text-lg">MMLを選択</h3>
      <div
        className={clsx(
          "min-h-0 shrink overflow-y-auto bg-base-200",
          "scrollbar-thumb-current/35 scrollbar-track-transparent",
        )}
      >
        <ul className="menu w-full h-max p-0">
          {files.map((f, i) => (
            <li key={`${i}-${f.name}`}>
              <button
                className={clsx(
                  i === currentIndex && "menu-active",
                  f.isSample && i !== currentIndex && "text-base-content/70",
                )}
                onClick={() => setCurrentIndex(i)}
              >
                {f.name.trim() || "無題"}
              </button>
            </li>
          ))}
          <li>
            <button className="justify-center" onClick={() => newFile()}>
              + 新規作成
            </button>
          </li>
        </ul>
      </div>
      <div className="divider" />
      <h3 className="font-semibold text-lg">ファイルをインポート</h3>
      <p className="mx-2 text-paragraph text-sm">
        MML ファイル、SmileBASIC プログラム (DATA/BGMSET)、または MIDI ファイル (.mid) を読み込みます。
      </p>
      <div className="flex justify-center">
        <label
          htmlFor="SidebarImportMML"
          className="btn btn-primary btn-soft btn-sm"
        >
          ファイルを選択...
        </label>
        <input
          type="file"
          id="SidebarImportMML"
          accept=".mml,.txt,.prg,.mid,.midi"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              loadFile(e.target.files[0]);
              e.target.value = "";
            }
          }}
        />
      </div>
      <p className="mx-2 text-paragraph text-xs">
        ファイルをドラッグ&ドロップで読み込むこともできます。
      </p>
      <div className="divider" />
      <h3 className="font-semibold text-lg">ファイルをエクスポート</h3>
      <div className="flex flex-col gap-2 mx-1">
        <button
          className="btn btn-primary btn-soft btn-sm w-full"
          onClick={handleExportMidi}
          disabled={!currentFile.content.trim()}
        >
          MIDI ファイル (.mid) で保存
        </button>
        <button
          className="btn btn-neutral btn-soft btn-sm w-full"
          onClick={handleExportMml}
          disabled={!currentFile.content.trim()}
        >
          MML ファイル (.mml) で保存
        </button>
        {exportError && (
          <div className="alert alert-error text-xs p-2">
            <span>{exportError}</span>
          </div>
        )}
      </div>
    </>
  );
}
