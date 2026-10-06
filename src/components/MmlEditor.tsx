import { useRef, useState, type FC, type DragEvent, type ChangeEvent } from 'react';

interface MmlEditorProps {
  mml: string;
  onChange: (value: string) => void;
  fileName: string;
  onFileLoaded: (name: string, content: string) => void;
}

const SAMPLE_PRESETS: { name: string; mml: string }[] = [
  {
    name: 'Sample 1: Multi-Channel & Chords',
    mml: `{TITLE=Chords and Melody}
T130
{CH1=|C E G|2}
{CH2=|D F A|2}
{CH3=|G B <D>|2}
:0 @0 V110 O4 L8 [C D E F G A B <C>]2
:1 @48 V90 O3 {CH1} {CH2} {CH3} {CH1}
:2 @33 V100 O2 L4 C G <C> G`,
  },
  {
    name: 'Sample 2: Infinite Loop & Modulation',
    mml: `{TITLE=Looping Synth}
T140
:0 @MP40,2,16,18 @V110 O4 L16
[ C E G B <C D E G> ]
:1 @38 V100 O2 L8
[ [C <C>]2 [F <F>]2 [G <G>]2 [C <C>]2 ]`,
  },
  {
    name: 'Sample 3: Drums & Macro Expansion',
    mml: `{TITLE=Drum Beat & Bass}
T125
{BEAT=C4 D+4 C4 D+4}
{HH=[G+8A+8]4}
:2 @33 V120 O2 L8 C C <C> >A+ A+ A+ <C> >G
:9 @128 V110 O2 {BEAT}
:4 @128 V70 O2 {HH}`,
  },
];

export const MmlEditor: FC<MmlEditorProps> = ({
  mml,
  onChange,
  fileName,
  onFileLoaded,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      loadFile(e.target.files[0]);
    }
  };

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      onFileLoaded(file.name, content);
    };
    reader.readAsText(file);
  };

  return (
    <div className="editor-container">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInput}
          accept=".mml,.txt"
          style={{ display: 'none' }}
        />
        <div className="drop-icon">📂</div>
        <div className="drop-text">
          <strong>MMLファイルをドラッグ＆ドロップ</strong> または クリックして選択
        </div>
        <div className="drop-hint">対応形式: .mml, .txt (SmileBASIC MML)</div>
      </div>

      <div className="preset-bar">
        <span className="preset-label">プリセット:</span>
        {SAMPLE_PRESETS.map((p, idx) => (
          <button
            key={idx}
            type="button"
            className="preset-btn"
            onClick={() => onFileLoaded(p.name, p.mml)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="textarea-header">
        <span className="file-indicator">
          {fileName ? `📄 ${fileName}` : '📝 MMLエディタ'}
        </span>
        <span className="char-counter">{mml.length} 文字</span>
      </div>

      <textarea
        className="mml-textarea"
        value={mml}
        onChange={(e) => onChange(e.target.value)}
        placeholder="MMLコードをここに入力または貼り付け..."
        rows={14}
        spellCheck={false}
      />
    </div>
  );
};
