import {
  createContext,
  useContext,
  type ReactNode,
  useState,
  useCallback,
  useEffect,
} from "react";
import { extractMacro } from "../parser";
import sample1 from "../samples/sample1.mml?raw";
import sample2 from "../samples/get_started_merged.mml?raw";
import sample3 from "../samples/NA_NN.MML?raw";
import { extractSmileBasicMML } from "../parser/smilebasicPrg";
import { useInstrumentContext } from "./InstrumentContext.js";
import { MidiImportModal } from "./MidiImportModal.js";

interface MmlFile {
  isSample?: boolean;
  name: string;
  content: string;
}
interface Playlist {
  files: Readonly<MmlFile>[];
  currentFile: Readonly<MmlFile>;
  currentIndex: number;
  setCurrentIndex: (id: number) => void;
  loadFile: (file: File) => void;
  addFile: (name: string, content: string) => void;
  newFile: () => void;
  updateContent: (content: string) => void;
  reParseAsPrg: () => void;
}
const PlaylistContext = createContext<Playlist | null>(null);

export function usePlaylist() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) {
    throw new Error("usePlaylist must be used within PlaylistProvider");
  }
  return ctx;
}

export function PlaylistProvider({ children }: { children: ReactNode }) {
  const { loadWavset } = useInstrumentContext();
  const [files, setFiles] = useState<Readonly<MmlFile>[]>([
    { isSample: true, name: "サンプル1", content: sample1 },
    { isSample: true, name: "サンプル2", content: sample2 },
    { isSample: true, name: "サンプル3", content: sample3 },
  ]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [pendingMidi, setPendingMidi] = useState<{
    file: File;
    buffer: ArrayBuffer;
  } | null>(null);

  const addFile = useCallback((name: string, content: string) => {
    loadWavset(content);
    setFiles((prev) => {
      const nextIndex = prev.length;
      setCurrentIndex(nextIndex);
      return prev.concat([
        {
          name: extractMacro(content, "TITLE", false) || name || "無題",
          content,
        },
      ]);
    });
  }, [loadWavset]);

  const loadFile = useCallback(
    async (file: File) => {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (ext === ".mid" || ext === ".midi") {
        try {
          const buffer = await file.arrayBuffer();
          setPendingMidi({ file, buffer });
        } catch (e) {
          console.error("Failed to read MIDI file:", e);
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        loadWavset(content);
        const parsedAsPrg = extractSmileBasicMML(content);
        if (parsedAsPrg.length >= 1) {
          setFiles((prev) => {
            const nextIndex = prev.length;
            setCurrentIndex(nextIndex);
            return prev.concat(
              parsedAsPrg.map(({ label, content }) => ({
                name:
                  extractMacro(content, "TITLE", false) || label || file.name,
                content: content,
              })),
            );
          });
        } else {
          setFiles((prev) => {
            const nextIndex = prev.length;
            setCurrentIndex(nextIndex);
            return prev.concat([
              {
                name: extractMacro(content, "TITLE", false) || file.name,
                content: content,
              },
            ]);
          });
        }
      };
      reader.readAsText(file);
    },
    [loadWavset],
  );

  const newFile = useCallback(() => {
    setFiles((prev) => prev.concat([{ name: "", content: "" }]));
    setCurrentIndex(files.length);
  }, [files]);

  let currentFile = files[currentIndex];
  if (!currentFile) {
    currentFile = files.at(-1)!;
    setCurrentIndex(files.length - 1);
  }

  const reParseAsPrg = useCallback(() => {
    loadWavset(currentFile.content);
    const parsedAsPrg = extractSmileBasicMML(currentFile.content);
    if (!currentFile.isSample && parsedAsPrg.length >= 1) {
      setFiles((prev) => [
        ...prev.slice(0, currentIndex),
        ...parsedAsPrg.map(({ label, content }) => ({
          name:
            extractMacro(content, "TITLE", false) || label || currentFile.name,
          content: content,
        })),
        ...prev.slice(currentIndex + 1),
      ]);
    }
  }, [currentIndex, currentFile, loadWavset]);

  const updateContent = useCallback(
    (content: string) => {
      if (currentFile.isSample && currentFile.content !== content) {
        // サンプルを編集しようとしたら複製する
        setFiles((prev) =>
          prev.concat([
            {
              name:
                extractMacro(content, "TITLE", false) ||
                currentFile.name + " のコピー",
              content,
            },
          ]),
        );
        setCurrentIndex(files.length);
      } else {
        setFiles((prev) =>
          prev.map((f, i) =>
            i === currentIndex
              ? {
                  ...f,
                  name: extractMacro(content, "TITLE", false) || f.name,
                  content: content,
                }
              : f,
          ),
        );
      }
    },
    [currentIndex, files, currentFile],
  );

  useEffect(() => {
    // PWAのfile_handlersで開こうとしたファイル
    if ("launchQueue" in window) {
      (window.launchQueue as any).setConsumer(async (launchParams: any) => {
        if (launchParams.files && launchParams.files.length) {
          for (const file of launchParams.files) {
            loadFile(await file.getFile());
          }
        }
      });
    }
  }, [loadFile]);

  return (
    <PlaylistContext.Provider
      value={{
        files,
        currentIndex,
        setCurrentIndex,
        currentFile,
        loadFile,
        addFile,
        newFile,
        updateContent,
        reParseAsPrg,
      }}
    >
      {children}
      {pendingMidi && (
        <MidiImportModal
          file={pendingMidi.file}
          buffer={pendingMidi.buffer}
          onImport={(importedTitle, mml) => {
            addFile(importedTitle, mml);
            setPendingMidi(null);
          }}
          onClose={() => setPendingMidi(null)}
        />
      )}
    </PlaylistContext.Provider>
  );
}
