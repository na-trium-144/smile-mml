/**
 * Instrument Context
 * Manages InstrumentRegistry, SF2/NDS loading state, and provides
 * loadSF2/loadNDS actions via React Context.
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type FC,
  useEffect,
} from "react";
import { InstrumentRegistry } from "../audio/banks/InstrumentRegistry.js";
import { SF2InstrumentBank } from "../audio/banks/SF2InstrumentBank.js";
import { NDSInstrumentBank } from "../audio/banks/NDSInstrumentBank.js";
import clsx from "clsx";

const presetSF2Names = ["GeneralUser GS", "FluidR3 GM"] as const;

interface InstrumentContextValue {
  registry: InstrumentRegistry;
  sf2Name: string | null;
  sf2IsPreset: boolean;
  ndsName: string | null;
  ndsSdats: string[];
  selectedNdsSdat: string;
  loadingAsset: string | null;
  loadError: string | null;
  loadSF2: (file: File | (typeof presetSF2Names)[number]) => Promise<void>;
  loadNDS: (file: File) => Promise<void>;
  sf2Bank: SF2InstrumentBank | null;
  ndsBank: NDSInstrumentBank | null;
  selectSdat: (path: string) => void;
  bankSelected: "sf2" | "nds";
  selectBank: (bank: "sf2" | "nds") => void;
}

const InstrumentContext = createContext<InstrumentContextValue | null>(null);

export function useInstrumentContext(): InstrumentContextValue {
  const ctx = useContext(InstrumentContext);
  if (!ctx) {
    throw new Error(
      "useInstrumentContext must be used within InstrumentProvider",
    );
  }
  return ctx;
}

export const InstrumentProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const registryRef = useRef<InstrumentRegistry>(new InstrumentRegistry());
  const ndsBufferRef = useRef<ArrayBuffer | null>(null);

  const [bankSelected, setBankSelected] = useState<"sf2" | "nds">("sf2");
  const [sf2Bank, setSf2Bank] = useState<SF2InstrumentBank | null>(null);
  const [ndsBank, setNdsBank] = useState<NDSInstrumentBank | null>(null);
  const selectBank = useCallback(
    (bank: "sf2" | "nds") => {
      switch (bank) {
        case "sf2":
          if (sf2Bank) {
            registryRef.current.register(sf2Bank);
          }
          break;
        case "nds":
          if (ndsBank) {
            registryRef.current.register(ndsBank);
          }
          break;
      }
      setBankSelected(bank);
    },
    [sf2Bank, ndsBank],
  );

  const [sf2IsPreset, setSf2IsPreset] = useState<boolean>(false);
  const [sf2Name, setSf2Name] = useState<string | null>(null);
  const [ndsName, setNdsName] = useState<string | null>(null);
  const [ndsSdats, setNdsSdats] = useState<string[]>([]);
  const [selectedNdsSdat, setSelectedNdsSdat] = useState<string>("");
  const [loadingAsset, setLoadingAsset] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const generalUserGS = useRef<ArrayBuffer | null>(null);
  const fluidR3GM = useRef<ArrayBuffer | null>(null);

  const loadSF2 = useCallback(
    async (file: File | (typeof presetSF2Names)[number]) => {
      setLoadingAsset("SF2");
      setLoadError(null);
      setBankSelected("sf2");
      let sf2Bank: SF2InstrumentBank;
      try {
        if (file === "GeneralUser GS") {
          if (!generalUserGS.current) {
            throw new Error("generalUserGS.current is null");
          }
          sf2Bank = new SF2InstrumentBank("GeneralUser GS");
          await sf2Bank.load(generalUserGS.current);
          setSf2IsPreset(true);
        } else if (file === "FluidR3 GM") {
          if (!fluidR3GM.current) {
            throw new Error("fluidR3GM.current is null");
          }
          sf2Bank = new SF2InstrumentBank("FluidR3 GM");
          await sf2Bank.load(fluidR3GM.current);
          setSf2IsPreset(true);
        } else {
          const buffer = await file.arrayBuffer();
          sf2Bank = new SF2InstrumentBank(file.name);
          await sf2Bank.load(buffer);
          setSf2IsPreset(false);
        }
        registryRef.current.register(sf2Bank);
        setSf2Name(sf2Bank.name);
        setSf2Bank(sf2Bank);
      } catch (err) {
        console.error("SF2 load error:", err);
        setLoadError(
          `SF2 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoadingAsset(null);
      }
    },
    [],
  );

  const selectSdat = useCallback((path: string) => {
    if (ndsBufferRef.current && path) {
      const ndsBank = new NDSInstrumentBank(ndsBufferRef.current, path);
      registryRef.current.register(ndsBank);
      setSelectedNdsSdat(path);
      setNdsBank(ndsBank);
    }
  }, []);

  const loadNDS = useCallback(async (file: File) => {
    setLoadingAsset("NDS ROM");
    setLoadError(null);
    setBankSelected("nds");
    try {
      const buffer = await file.arrayBuffer();
      const sdats = NDSInstrumentBank.parseRom(buffer);
      ndsBufferRef.current = buffer;
      setNdsSdats(sdats);
      setSelectedNdsSdat(sdats[0]);
      // Register first SDAT immediately
      const ndsBank = new NDSInstrumentBank(ndsBufferRef.current, sdats[0]);
      registryRef.current.register(ndsBank);
      setNdsName(file.name);
      setNdsBank(ndsBank);
    } catch (err) {
      console.error("NDS ROM load error:", err);
      setLoadError(
        `NDS ROM 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingAsset(null);
    }
  }, []);

  useEffect(() => {
    async function decompressIfNecessary(res: Response) {
      const reader = res.clone().body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      if (value && value[0] === 0x1f && value[1] === 0x8b) {
        const ds = new DecompressionStream("gzip");
        const decompressedStream = (await res.blob()).stream().pipeThrough(ds);
        return new Response(decompressedStream).arrayBuffer();
      } else {
        return res.arrayBuffer();
      }
    }
    fetch("/GeneralUser-GS.sf3.gz").then(async (res) => {
      generalUserGS.current = await decompressIfNecessary(res);
      loadSF2("GeneralUser GS");
    });
    fetch("/FluidR3_GM.sf3.gz").then(async (res) => {
      fluidR3GM.current = await decompressIfNecessary(res);
    });
  }, [loadSF2]);

  const value: InstrumentContextValue = {
    registry: registryRef.current,
    sf2Name,
    sf2IsPreset,
    ndsName,
    ndsSdats,
    selectedNdsSdat,
    loadingAsset,
    loadError,
    loadSF2,
    loadNDS,
    sf2Bank,
    ndsBank,
    selectSdat,
    bankSelected,
    selectBank,
  };

  return (
    <InstrumentContext.Provider value={value}>
      {children}
    </InstrumentContext.Provider>
  );
};

export function InstrumentSelect() {
  const {
    sf2Name,
    sf2IsPreset,
    ndsName,
    ndsSdats,
    selectedNdsSdat,
    loadingAsset,
    loadError,
    loadSF2,
    loadNDS,
    selectSdat,
    bankSelected,
    selectBank,
  } = useInstrumentContext();

  return (
    <details className="collapse collapse-card-like collapse-arrow collapse-card-like-border">
      <summary className="collapse-title collapse-card-like-title flex justify-between items-center">
        <h2>音源設定</h2>
        {bankSelected === "sf2"
          ? sf2Name && (
              <div>
                <span className="badge badge-success badge-sm">{sf2Name}</span>
                <span className="mx-1 text-sm">+</span>
                <span className="badge badge-warning badge-sm">PSG音源</span>
              </div>
            )
          : ndsName && (
              <div className="badge badge-accent badge-sm">{ndsName}</div>
            )}
      </summary>
      <div className="collapse-content flex flex-col">
        <div className="tabs tabs-border mb-2 -mt-3">
          <input
            type="radio"
            name="InstrumentSelect"
            className="tab"
            aria-label="SF2 + PSG"
            checked={bankSelected === "sf2"}
            onChange={(e) => {
              if (e.target.checked) {
                selectBank("sf2");
              }
            }}
          />
          <input
            type="radio"
            name="InstrumentSelect"
            className="tab"
            aria-label="NDS"
            checked={bankSelected === "nds"}
            onChange={(e) => {
              if (e.target.checked) {
                selectBank("nds");
              }
            }}
          />
        </div>

        {/* SF2 */}
        {bankSelected === "sf2" ? (
          <>
            <div key="sf2" className="flex flex-wrap items-center gap-2 mb-2">
              <span className="">サウンドフォント (.sf2 / .sf3) を選択</span>
              <select
                className="select select-success select-sm w-max"
                value={sf2IsPreset && sf2Name ? sf2Name : ""}
                onChange={(e) => {
                  if (
                    (presetSF2Names as Readonly<string[]>).includes(
                      e.target.value,
                    )
                  ) {
                    loadSF2(e.target.value as (typeof presetSF2Names)[number]);
                  }
                }}
              >
                <option disabled value="">
                  デフォルト音源から選択...
                </option>
                {presetSF2Names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <span>または</span>
              <div className={clsx(!sf2IsPreset && sf2Name && "join")}>
                <label
                  htmlFor="SF2InstrumentInput"
                  className={clsx(
                    "btn btn-success btn-sm",
                    !sf2IsPreset && sf2Name && "join-item",
                  )}
                >
                  ファイルを読み込む...
                </label>
                <input
                  type="file"
                  id="SF2InstrumentInput"
                  className="hidden"
                  accept=".sf2,.sf3"
                  disabled={loadingAsset !== null}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      loadSF2(e.target.files[0]);
                    }
                  }}
                />
                {!sf2IsPreset && sf2Name && (
                  <input
                    className="input input-sm join-item"
                    value={sf2Name}
                    readOnly
                  />
                )}
              </div>
            </div>
            <p className="mb-2 text-paragraph text-xs">
              ファイルをドラッグ&ドロップで読み込むこともできます。
            </p>
            <SF2InstrumentTable />
          </>
        ) : (
          <>
            <div key="nds" className="flex items-center gap-2 mb-2">
              <span className="">NDS ROM (.nds / .sdat)</span>
              <label
                htmlFor="NDSInstrumentInput"
                className="btn btn-accent btn-sm"
              >
                ファイルを選択...
              </label>
              <input
                type="file"
                className="hidden"
                accept=".nds,.sdat"
                disabled={loadingAsset !== null}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    loadNDS(e.target.files[0]);
                  }
                }}
              />
              {ndsName && (
                <div className="badge badge-success badge-sm">✓ {ndsName}</div>
              )}
              {ndsSdats.length >= 1 && (
                <select
                  className="select select-sm w-max"
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
            <p className="mb-2 text-paragraph text-xs">
              ファイルをドラッグ&ドロップで読み込むこともできます。
            </p>
          </>
        )}

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
    </details>
  );
}

function SF2InstrumentTable() {
  const { sf2Bank } = useInstrumentContext();
  const sf2Programs = sf2Bank?.getAllPrograms() ?? [];
  const hiddenPresetMapped = SF2InstrumentBank.sb3HiddenPresets
    .map((program) => ({
      program,
      ...SF2InstrumentBank.resolveBankPreset(program),
    }))
    .map((pMap) => ({
      pMap,
      pSf2: sf2Programs.find(
        (pSf2) => pSf2.bank === (pMap.bank ?? 0) && pSf2.preset === pMap.preset,
      ),
    }));
  hiddenPresetMapped.sort((a, b) => a.pMap.program - b.pMap.program);
  return (
    <>
      <p className="my-1 text-paragraph text-sm">
        <span className="text-sb3-label">@0</span> 〜{" "}
        <span className="text-sb3-label">@127</span> はGM音源と同一です。{" "}
        <span className="text-sb3-label">@128</span>{" "}
        以降の隠し音源はGM音源の近い音色またはドラムセットで置き換えています。
        (BEEP音など置き換え先を用意していない音色もあります。)
      </p>
      <p className="my-1 text-paragraph text-sm">
        <span className="text-sb3-label">@144</span> 〜{" "}
        <span className="text-sb3-label">@151</span> には{" "}
        <span className="badge badge-sm badge-warning">PSG音源</span>{" "}
        が生成されます。
      </p>
      <p className="my-1 text-paragraph text-sm">
        SmileMML 独自の拡張として <span className="text-sb3-label">@131</span>{" "}
        〜 <span className="text-sb3-label">@143</span>{" "}
        にGM2標準のドラムセットを追加しています。 また、{" "}
        <span className="text-sb3-label">
          @ バンク番号 × 1000 + プリセット番号
        </span>{" "}
        でSF2音源に含まれるその他の非標準の音色を使用できます。
      </p>
      <h3 className="mt-2">使用可能な音色一覧</h3>
      <div className="tabs tabs-border tabs-sm">
        <label className="tab">
          <input type="radio" name="SF2InstrumentTable" defaultChecked />
          @0 〜 @127 (GM音源)
        </label>
        <div className="tab-content bg-base-100 rounded-field">
          <table className="table table-xs text-center">
            <thead>
              <tr>
                <th>音色番号</th>
                <th>名前</th>
              </tr>
            </thead>
            <tbody>
              {sf2Programs.map(
                ({ program, name }) =>
                  program < 128 && (
                    <tr key={program}>
                      <th className="text-sb3-label">@{program}</th>
                      <td className="text-success-content">{name}</td>
                    </tr>
                  ),
              )}
            </tbody>
          </table>
        </div>

        <label className="tab">
          <input type="radio" name="SF2InstrumentTable" />
          @128 〜 (ドラム / 隠し音源)
        </label>
        <div className="tab-content bg-base-100 rounded-field">
          <table className="table table-xs text-center">
            <thead>
              <tr>
                <th>音色番号</th>
                <th>置き換え先</th>
                <th>名前</th>
              </tr>
            </thead>
            <tbody>
              {hiddenPresetMapped.map(
                ({ pMap, pSf2 }) =>
                  pSf2 && (
                    <tr key={pMap.program}>
                      <th className="text-sb3-label">@{pMap.program}</th>
                      <td className="text-success-content">
                        @{pSf2.program}{" "}
                        {pMap.keyShift && (
                          <span className="inline-block text-base-content">
                            (キー{" "}
                            {pMap.keyShift.toLocaleString("ja-JP", {
                              signDisplay: "always",
                              useGrouping: false,
                            })}
                            )
                          </span>
                        )}
                      </td>
                      <td className="text-success-content">{pSf2.name}</td>
                    </tr>
                  ),
              )}
            </tbody>
          </table>
        </div>

        <label className="tab">
          <input type="radio" name="SF2InstrumentTable" />
          @1000 〜 (SF2 バンク指定)
        </label>
        <div className="tab-content bg-base-100 rounded-field">
          <table className="table table-xs text-center">
            <thead>
              <tr>
                <th>音色番号</th>
                <th>名前</th>
              </tr>
            </thead>
            <tbody>
              {sf2Bank?.getAllPrograms().map(
                ({ program, name }) =>
                  program >= 1000 && (
                    <tr key={program}>
                      <th className="text-sb3-label">
                        @ {Math.floor(program / 1000)}{" "}
                        {(program % 1000).toString().padStart(3, "0")}
                      </th>
                      <td className="text-success-content">{name}</td>
                    </tr>
                  ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
