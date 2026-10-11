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

  const [sf2Name, setSf2Name] = useState<string | null>(null);
  const [ndsName, setNdsName] = useState<string | null>(null);
  const [ndsSdats, setNdsSdats] = useState<string[]>([]);
  const [selectedNdsSdat, setSelectedNdsSdat] = useState<string>("");
  const [loadingAsset, setLoadingAsset] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectSdat = useCallback((path: string) => {
    if (ndsBufferRef.current && path) {
      const ndsBank = new NDSInstrumentBank(ndsBufferRef.current, path);
      registryRef.current.register(ndsBank);
      setSelectedNdsSdat(path);
    }
  }, []);

  const loadSF2 = useCallback(async (file: File) => {
    setLoadingAsset("SF2");
    setLoadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const sf2Bank = new SF2InstrumentBank(file.name);
      await sf2Bank.load(buffer);
      registryRef.current.register(sf2Bank);
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

  const loadNDS = useCallback(
    async (file: File) => {
      setLoadingAsset("NDS ROM");
      setLoadError(null);
      try {
        const buffer = await file.arrayBuffer();
        const sdats = NDSInstrumentBank.parseRom(buffer);
        ndsBufferRef.current = buffer;
        setNdsSdats(sdats);
        setSelectedNdsSdat(sdats[0]);
        // Register first SDAT immediately
        const ndsBank = new NDSInstrumentBank(buffer, sdats[0]);
        registryRef.current.register(ndsBank);
        setNdsName(file.name);
      } catch (err) {
        console.error("NDS ROM load error:", err);
        setLoadError(
          `NDS ROM 読み込みエラー: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoadingAsset(null);
      }
    },
    [],
  );

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
  };

  return (
    <InstrumentContext.Provider value={value}>
      {children}
    </InstrumentContext.Provider>
  );
};
