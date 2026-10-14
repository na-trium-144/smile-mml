import { WithHeaderAndSidebar } from "./components/Header.js";
import { MMLEditor } from "./components/MmlEditor.js";
import { AudioPlayer } from "./components/AudioPlayer.js";
import { HandleDropFile } from "./components/HandleDropFile.js";
import { About } from "./components/About.js";
import { InstrumentSelect } from "./components/InstrumentContext.js";

export default function App() {
  return (
    <HandleDropFile className="w-full min-h-screen">
      <WithHeaderAndSidebar>
        <main className="w-full max-w-256 space-y-4">
          <AudioPlayer />
          <MMLEditor />
          <InstrumentSelect />
          <About />
        </main>
      </WithHeaderAndSidebar>
    </HandleDropFile>
  );
}
