import { useState, type ReactNode } from "react";
import { useInstrumentContext } from "../components/InstrumentContext.js";

interface Props {
  className: string;
  children: ReactNode;
  loadFile: (file: File) => void;
}

const SF2_EXTENSIONS = [".sf2"];
const NDS_EXTENSIONS = [".nds", ".sdat"];

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function HandleDropFile(props: Props) {
  const [dragging, setDragging] = useState(false);
  const { loadSF2, loadNDS } = useInstrumentContext();

  const handleFile = (file: File) => {
    const ext = getExtension(file.name);
    if (SF2_EXTENSIONS.includes(ext)) {
      loadSF2(file);
    } else if (NDS_EXTENSIONS.includes(ext)) {
      loadNDS(file);
    } else {
      props.loadFile(file);
    }
  };

  return (
    <>
      <div
        className={props.className}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
          }
        }}
      >
        {props.children}
      </div>
      <input
        checked={dragging}
        onChange={() => undefined}
        type="checkbox"
        className="modal-toggle"
      />
      <div className="modal pointer-events-none" role="dialog">
        <div className="modal-box">
          ファイルをドラッグ&ドロップで読み込む
        </div>
      </div>
    </>
  );
}
