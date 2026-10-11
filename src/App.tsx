import { useState } from "react";
import { WithHeaderAndSidebar } from "./components/Header.js";
import { MMLEditor } from "./components/MmlEditor.js";
import { AudioPlayer } from "./components/AudioPlayer.js";
import { HandleDropFile } from "./components/HandleDropFile.js";

export default function App() {
  const [mml, setMml] = useState("");

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setMml(content);
    };
    reader.readAsText(file);
  };

  return (
    <HandleDropFile className="min-w-screen min-h-screen" loadFile={loadFile}>
      <WithHeaderAndSidebar loadFile={loadFile}>
        <main className="w-full max-w-256 space-y-4">
          <AudioPlayer mml={mml} />
          <MMLEditor mml={mml} onChange={setMml} />
        </main>
      </WithHeaderAndSidebar>
    </HandleDropFile>
  );
}
