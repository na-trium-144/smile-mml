import type { FC } from 'react';

export const Header: FC = () => {
  return (
    <header className="app-header">
      <div className="logo-badge">VMML</div>
      <h1>Visual MML to MIDI Converter</h1>
      <p className="subtitle">
        SmileBASIC <code>VMML-LIB</code> (<code>DEF LD PS</code>) 準拠のパーサージェネレーターによるMML→Standard MIDI変換ツール
      </p>
    </header>
  );
};
