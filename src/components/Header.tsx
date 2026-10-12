import type { ReactNode } from "react";
import { useInstrumentContext } from "../components/InstrumentContext.js";

interface Props {
  children: ReactNode;
  loadFile: (file: File) => void;
}

export function WithHeaderAndSidebar(props: Props) {
  return (
    <>
      <header className="navbar bg-base-100">
        <div className="navbar-start">
          <label htmlFor="SidebarToggle" className="lg:hidden btn btn-ghost w-max">
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
        <h1 className="navbar-center text-2xl font-semibold">SmileMML</h1>
        <div className="navbar-end"></div>
      </header>

      <div className="drawer lg:drawer-open">
        <input type="checkbox" id="SidebarToggle" className="drawer-toggle" />
        <div className="drawer-content flex flex-col items-center p-8">
          {/* Page content here */}
          {props.children}
        </div>
        <div className="drawer-side">
          <label
            htmlFor="SidebarToggle"
            aria-label="close sidebar"
            className="drawer-overlay"
          />
          <div className="bg-base-200 min-h-full w-80 p-4 space-y-4">
            <SidebarContent {...props} />
          </div>
        </div>
      </div>
    </>
  );
}

function SidebarContent(props: Props) {
  const {
    sf2Name,
    ndsName,
    ndsSdats,
    selectedNdsSdat,
    loadingAsset,
    loadError,
    loadSF2,
    loadNDS,
    selectSdat,
  } = useInstrumentContext();
  return (
    <>
      {/* ── MML File ── */}
      <div>
        <h3 className="font-bold mb-2">📄 MMLファイル</h3>
        <input
          type="file"
          className="file-input file-input-bordered file-input-sm w-full"
          accept=".mml,.txt"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              props.loadFile(e.target.files[0]);
            }
          }}
        />
      </div>

      <div className="divider my-1" />

      {/* ── Sound Sources ── */}
      <div className="space-y-3">
        <h3 className="font-bold">🎵 音源設定</h3>

        {/* SF2 */}
        <div>
          <label className="label">
            <span className="label-text text-sm">🎹 SoundFont (.sf2)</span>
          </label>
          <input
            type="file"
            className="file-input file-input-bordered file-input-sm w-full"
            accept=".sf2,.SF2"
            disabled={loadingAsset !== null}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                loadSF2(e.target.files[0]);
              }
            }}
          />
          {sf2Name && (
            <div className="badge badge-success badge-sm mt-1">✓ {sf2Name}</div>
          )}
        </div>

        {/* NDS */}
        <div>
          <label className="label">
            <span className="label-text text-sm">
              🎮 NDS ROM (.nds / .sdat)
            </span>
          </label>
          <input
            type="file"
            className="file-input file-input-bordered file-input-sm w-full"
            accept=".nds,.NDS,.sdat,.SDAT"
            disabled={loadingAsset !== null}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                loadNDS(e.target.files[0]);
              }
            }}
          />
          {ndsName && (
            <div className="badge badge-success badge-sm mt-1">✓ {ndsName}</div>
          )}
          {ndsSdats.length > 1 && (
            <select
              className="select select-bordered select-sm w-full mt-1"
              value={selectedNdsSdat}
              onChange={(e) => selectSdat(e.target.value)}
            >
              {ndsSdats.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* PSG Info */}
        <p className="text-xs opacity-70">
          💡 PSG音源 (@144〜@151) は常に利用可能です。
          {!sf2Name &&
            !ndsName &&
            " SF2/ROM が未読み込みの場合、矩形波でフォールバック再生します。"}
        </p>

        {/* Loading State */}
        {loadingAsset && (
          <div className="flex items-center gap-2 text-sm">
            <span className="loading loading-spinner loading-sm" />
            {loadingAsset} を読み込み中...
          </div>
        )}

        {/* Error */}
        {loadError && (
          <div role="alert" className="alert alert-error alert-sm text-xs">
            <span>{loadError}</span>
          </div>
        )}
      </div>
    </>
  );
}
