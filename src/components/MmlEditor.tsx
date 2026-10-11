import { useRef, useState, type DragEvent, type ChangeEvent } from "react";

interface MMLEditorProps {
  mml: string;
  onChange: (value: string) => void;
}

export const MMLEditor = ({ mml, onChange }: MMLEditorProps) => {
  return (
    <div className="card card-border w-full">
      <div className="card-body">
        <h2 className="card-title">MMLを編集</h2>
        <p className="text-right">{mml.length} 文字</p>

        <textarea
          value={mml}
          onChange={(e) => onChange(e.target.value)}
          placeholder="MMLコードをここに入力または貼り付け..."
          rows={14}
          spellCheck={false}
        />
      </div>
    </div>
  );
};
