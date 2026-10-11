import { useState, type ReactNode, useRef } from "react";

interface Props {
  className: string;
  children: ReactNode;
  loadFile: (file: File) => void;
}
export function HandleDropFile(props: Props) {
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <div
        className={props.className}
        onDragOver={(e) => {
          console.log("onDragOver");
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          console.log("onDragLeav");
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          console.log("onDrop");
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            props.loadFile(e.dataTransfer.files[0]);
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
          MMLファイルをドラッグ&ドロップで読み込む
        </div>
      </div>
    </>
  );
}
