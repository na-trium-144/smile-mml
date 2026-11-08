declare module '*SMFToMML.js' {
  export interface SMFTrackInfo {
    name?: ArrayBuffer | Uint8Array;
    totalNotes: number;
    maxPoly: number;
    ticks: number;
  }

  export default class SMFToMML {
    constructor(smfBuffer: ArrayBuffer);
    readonly trackInfo: SMFTrackInfo[];
    readonly title: ArrayBuffer | Uint8Array | null;
    convert(
      trackNumber: number,
      numChannels: number,
      withTempo: boolean,
      volume: number,
      transpose: number,
      detune: number
    ): { mml: string[]; ticks: number };
  }
}
