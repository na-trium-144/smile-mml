import AceEditor from "react-ace";
import "ace-builds/src-noconflict/theme-twilight";
import "ace-builds/src-noconflict/ext-searchbox";

interface MMLEditorProps {
  mml: string;
  onChange: (value: string) => void;
}

export const MMLEditor = ({ mml, onChange }: MMLEditorProps) => {
  return (
    <div className="card card-border w-full h-screen">
      <div className="card-body">
        <div className="card-title flex flex-wrap items-baseline justify-between">
          <h2>MMLを編集</h2>
          <span className="text-sm text-right">{mml.length} 文字</span>
        </div>

        <div className="flex-1 textarea textarea-ghost w-[unset] touch-auto p-0">
          {/* <textarea> じゃないけどdaisyuiのtextareaクラスのborderなどのスタイルを適用 */}
          <AceEditor
            name="MMLEditor"
            value={mml}
            onChange={(v) => onChange(v)}
            width="full"
            height="100%"
            theme="twilight"
            fontSize={14}
            wrapEnabled
            tabSize={1}
            showPrintMargin={false}
            setOptions={{ useWorker: false }}
          />
        </div>
      </div>
    </div>
  );
};
