import { useState } from 'react';
import { Header } from './components/Header.js';
import { MmlEditor } from './components/MmlEditor.js';
import { MidiPreview } from './components/MidiPreview.js';
import { parseMML } from './parser/vmmlParser.js';
import { convertMmlToMidi } from './midi/mmlToMidi.js';
import type { MMLEvent } from './parser/types.js';
import './App.css';

const DEFAULT_MML = `{TITLE=Example Song}
T130
{CH1=|C E G|2}
{CH2=|D F A|2}
{CH3=|G B <D>|2}
:0 @0 V110 O4 L8 [C D E F G A B <C>]2
:1 @48 V90 O3 {CH1} {CH2} {CH3} {CH1}
:2 @33 V100 O2 L4 C G <C> G
:9 @128 V110 O2 [C4 D+4 C4 D+4]2`;

function performConversion(
  mmlText: string,
  fileNameStr: string,
  shift: number,
  mapDrumsFlag: boolean
) {
  const t0 = performance.now();
  const collectedEvents: MMLEvent[] = [];
  const gen = parseMML(mmlText, {
    stopOnInfiniteLoop: true,
    keyShift: shift,
  });

  for (const ev of gen) {
    collectedEvents.push(ev);
  }

  const midiData = convertMmlToMidi(mmlText, {
    songTitle: fileNameStr.replace(/\.[^/.]+$/, ''),
    stopOnInfiniteLoop: true,
    keyShift: shift,
    mapDrumsToChannel9: mapDrumsFlag,
  });

  const t1 = performance.now();
  return {
    events: collectedEvents,
    midiBytes: midiData,
    conversionTime: t1 - t0,
  };
}

export function App() {
  const [mml, setMml] = useState(DEFAULT_MML);
  const [fileName, setFileName] = useState('example.mml');
  const [keyShift, setKeyShift] = useState<number>(0);
  const [mapDrums, setMapDrums] = useState<boolean>(true);

  // Initialize with pre-computed initial conversion result
  const initialResult = useState(() => performConversion(DEFAULT_MML, 'example.mml', 0, true))[0];
  const [events, setEvents] = useState<MMLEvent[]>(initialResult.events);
  const [midiBytes, setMidiBytes] = useState<Uint8Array | null>(initialResult.midiBytes);
  const [conversionTime, setConversionTime] = useState<number>(initialResult.conversionTime);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleConvert = () => {
    if (!mml.trim()) {
      setError('MMLコードを入力してください');
      return;
    }

    setIsConverting(true);
    setError(null);

    try {
      const result = performConversion(mml, fileName, keyShift, mapDrums);
      setConversionTime(result.conversionTime);
      setEvents(result.events);
      setMidiBytes(result.midiBytes);
    } catch (err: unknown) {
      console.error(err);
      setError(`変換エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsConverting(false);
    }
  };

  const handleFileLoaded = (name: string, content: string) => {
    setFileName(name);
    setMml(content);
  };

  return (
    <div className="app-layout">
      <Header />

      <main className="main-content">
        <section className="editor-section">
          <MmlEditor
            mml={mml}
            onChange={setMml}
            fileName={fileName}
            onFileLoaded={handleFileLoaded}
          />

          <div className="controls-panel">
            <div className="options-row">
              <div className="option-item">
                <label htmlFor="keyShift">キー移調 (半音):</label>
                <input
                  id="keyShift"
                  type="number"
                  value={keyShift}
                  onChange={(e) => setKeyShift(parseInt(e.target.value, 10) || 0)}
                  min={-36}
                  max={36}
                />
              </div>

              <div className="option-item checkbox-item">
                <label>
                  <input
                    type="checkbox"
                    checked={mapDrums}
                    onChange={(e) => setMapDrums(e.target.checked)}
                  />
                  ドラム音色 (@128等) を MIDI Ch10 に自動マッピング
                </label>
              </div>
            </div>

            <button
              type="button"
              className="convert-btn"
              onClick={handleConvert}
              disabled={isConverting}
            >
              {isConverting ? '⏳ 変換中...' : '▶ MMLをパース & MIDIに変換'}
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </section>

        {events.length > 0 && (
          <section className="results-section">
            <MidiPreview
              events={events}
              midiBytes={midiBytes}
              fileName={fileName}
              conversionTimeMs={conversionTime}
            />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>Visual MML Parser in TypeScript &copy; Antigravity</p>
      </footer>
    </div>
  );
}

export default App;
