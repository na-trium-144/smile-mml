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
} from "react";
import { InstrumentRegistry } from "../audio/banks/InstrumentRegistry.js";
import { SF2InstrumentBank } from "../audio/banks/SF2InstrumentBank.js";
import { NDSInstrumentBank } from "../audio/banks/NDSInstrumentBank.js";

interface InstrumentContextValue {
  registry: InstrumentRegistry;
  sf2Name: string | null;
  ndsName: string | null;
  ndsSdats: string[];
  selectedNdsSdat: string;
  loadingAsset: string | null;
  loadError: string | null;
  loadSF2: (file: File) => Promise<void>;
  loadNDS: (file: File) => Promise<void>;
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
  const selectBank = useCallback((bank: "sf2" | "nds") => {
    switch (bank) {
      case "sf2":
        if (sf2BankRef.current) {
          registryRef.current.register(sf2BankRef.current);
        }
        break;
      case "nds":
        if (ndsBankRef.current) {
          registryRef.current.register(ndsBankRef.current);
        }
        break;
    }
    setBankSelected(bank);
  }, []);
  const sf2BankRef = useRef<SF2InstrumentBank | null>(null);
  const ndsBankRef = useRef<NDSInstrumentBank | null>(null);

  const [sf2Name, setSf2Name] = useState<string | null>(null);
  const [ndsName, setNdsName] = useState<string | null>(null);
  const [ndsSdats, setNdsSdats] = useState<string[]>([]);
  const [selectedNdsSdat, setSelectedNdsSdat] = useState<string>("");
  const [loadingAsset, setLoadingAsset] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSF2 = useCallback(async (file: File) => {
    setLoadingAsset("SF2");
    setLoadError(null);
    setBankSelected("sf2");
    try {
      const buffer = await file.arrayBuffer();
      sf2BankRef.current = new SF2InstrumentBank(file.name);
      await sf2BankRef.current.load(buffer);
      registryRef.current.register(sf2BankRef.current);
      setSf2Name(file.name);
    } catch (err) {
      console.error("SF2 load error:", err);
      setLoadError(
        `SF2 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingAsset(null);
    }
  }, []);

  const selectSdat = useCallback((path: string) => {
    if (ndsBufferRef.current && path) {
      ndsBankRef.current = new NDSInstrumentBank(ndsBufferRef.current, path);
      registryRef.current.register(ndsBankRef.current);
      setSelectedNdsSdat(path);
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
      ndsBankRef.current = new NDSInstrumentBank(
        ndsBufferRef.current,
        sdats[0],
      );
      registryRef.current.register(ndsBankRef.current);
      setNdsName(file.name);
    } catch (err) {
      console.error("NDS ROM load error:", err);
      setLoadError(
        `NDS ROM 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingAsset(null);
    }
  }, []);

  const value: InstrumentContextValue = {
    registry: registryRef.current,
    sf2Name,
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
      <summary className="collapse-title collapse-card-like-title">
        <h2>音源設定</h2>
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
            <div key="sf2" className="flex items-center gap-2 mb-2">
              <span className="">SoundFont (.sf2 / .sf3)</span>
              <label
                htmlFor="SF2InstrumentInput"
                className="btn btn-info btn-sm"
              >
                ファイルを選択...
              </label>
              <input
                type="file"
                id="SF2InstrumentInput"
                className="hidden"
                accept=".sf2,.SF2"
                disabled={loadingAsset !== null}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    loadSF2(e.target.files[0]);
                  }
                }}
              />
              {sf2Name && (
                <div className="badge badge-success badge-sm">
                  ✓ {sf2Name}
                </div>
              )}
            </div>
            <div className="text-sm">
              <span className="text-sb3-label">@144</span> 〜{" "}
              <span className="text-sb3-label">@151</span> には{" "}
              <span className="badge badge-sm badge-warning">PSG音源</span>{" "}
              が生成されます。
            </div>
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
                accept=".nds,.NDS,.sdat,.SDAT"
                disabled={loadingAsset !== null}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    loadNDS(e.target.files[0]);
                  }
                }}
              />
              {ndsName && (
                <div className="badge badge-success badge-sm">
                  ✓ {ndsName}
                </div>
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
