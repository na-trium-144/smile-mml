import {
  createContext,
  useContext,
  type ReactNode,
  useState,
  useCallback,
} from "react";
import { extractMacro } from "../parser";

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
  newFile: () => void;
  updateContent: (content: string) => void;
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
  const [files, setFiles] = useState<Readonly<MmlFile>[]>([
    { isSample: true, name: "sample1", content: "c" },
  ]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const loadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFiles((prev) =>
        prev.concat([
          {
            name: extractMacro(content, "TITLE", false) || file.name,
            content: content,
          },
        ]),
      );
    };
    reader.readAsText(file);
  }, []);

  const newFile = useCallback(() => {
    setFiles((prev) => prev.concat([{ name: "", content: "" }]));
    setCurrentIndex(files.length);
  }, [files]);

  let currentFile = files[currentIndex];
  if (!currentFile) {
    currentFile = files.at(-1)!;
    setCurrentIndex(files.length - 1);
  }

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

  return (
    <PlaylistContext.Provider
      value={{
        files,
        currentIndex,
        setCurrentIndex,
        currentFile,
        loadFile,
        newFile,
        updateContent,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
}
