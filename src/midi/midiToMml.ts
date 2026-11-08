import SMFToMML from '../../lib/pismf2mml/src/smf2mml/SMFToMML.js';
import Encoding from 'encoding-japanese';

export { SMFToMML };

/**
 * Decodes raw byte data (ArrayBuffer or Uint8Array) into a Unicode string.
 */
export function decodeMidiText(
  data: ArrayBuffer | Uint8Array | number[] | null | undefined,
  encoding = 'AUTO'
): string {
  if (!data) return '';
  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (uint8.length === 0) return '';
  try {
    const fromEncoding = encoding === 'AUTO' ? Encoding.detect(uint8) || 'SJIS' : encoding;
    return Encoding.convert(uint8, {
      to: 'UNICODE',
      from: fromEncoding as Encoding.Encoding,
      type: 'string',
    }).trim();
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(uint8).trim();
  }
}

export interface TrackConvertOption {
  trackIndex: number;
  name?: string;
  outputPoly?: number;
  volume?: number;
  transpose?: number;
  detune?: number;
}

export interface ConvertSmfToMmlOptions {
  encoding?: string;
  format?: 'mml' | 'smilebasic';
  maxChannels?: number;
  trackOptions?: TrackConvertOption[];
}

export interface ConvertSmfResult {
  title: string;
  mml: string;
  trackInfo: Array<{
    name: string;
    totalNotes: number;
    maxPoly: number;
    ticks: number;
  }>;
}

/**
 * High-level function to convert SMF (MIDI) ArrayBuffer to MML string.
 */
export function convertSmfToMml(
  smfBuffer: ArrayBuffer,
  options: ConvertSmfToMmlOptions = {}
): ConvertSmfResult {
  const converter = new SMFToMML(smfBuffer);
  const encoding = options.encoding || 'AUTO';
  const format = options.format || 'mml';
  const maxChannels = options.maxChannels ?? Infinity;

  const rawTitle = converter.title;
  const title = decodeMidiText(rawTitle, encoding);

  interface ProcessedTrackInfo {
    name: string;
    totalNotes: number;
    maxPoly: number;
    ticks: number;
    outputPoly: number;
    volume: number;
    transpose: number;
    detune: number;
  }

  const trackInfo: ProcessedTrackInfo[] = converter.trackInfo.map((tr, i) => {
    const opt = options.trackOptions?.find((o) => o.trackIndex === i);
    const decodedName = decodeMidiText(tr.name, encoding);
    const defaultName = decodedName || `Track ${i + 1}`;
    const name = opt?.name || defaultName;
    const outputPoly = opt?.outputPoly !== undefined
      ? opt.outputPoly
      : Math.min(8, Math.max(tr.totalNotes > 0 ? 1 : 0, tr.maxPoly));
    const volume = opt?.volume !== undefined ? opt.volume : 100;
    const transpose = opt?.transpose !== undefined ? opt.transpose : 0;
    const detune = opt?.detune !== undefined ? opt.detune : 0;

    return {
      name,
      totalNotes: tr.totalNotes,
      maxPoly: tr.maxPoly,
      ticks: tr.ticks,
      outputPoly,
      volume,
      transpose,
      detune,
    };
  });

  let currentChannel = 0;
  let tempoAdded = false;
  const channelOutputs: Array<{
    trackName: string;
    ticks: number;
    startChannel: number;
    mmlList: string[];
  }> = [];

  for (let i = 0; i < trackInfo.length; i++) {
    const info = trackInfo[i];
    if (info.outputPoly <= 0 || info.totalNotes === 0) {
      continue;
    }
    if (currentChannel >= maxChannels) {
      break;
    }

    const availablePoly = Math.min(info.outputPoly, maxChannels - currentChannel);
    const withTempo = !tempoAdded;
    const result = converter.convert(
      i,
      availablePoly,
      withTempo,
      info.volume / 100,
      info.transpose,
      info.detune
    );

    if (withTempo) {
      tempoAdded = true;
    }

    channelOutputs.push({
      trackName: info.name,
      ticks: result.ticks,
      startChannel: currentChannel,
      mmlList: result.mml,
    });

    currentChannel += result.mml.length;
  }

  let fullMml = '';

  if (format === 'smilebasic') {
    let output = '';
    let chars = 0;
    for (const group of channelOutputs) {
      const sanitizedName = group.trackName.replace(/\//g, '-');
      output += `'/[${sanitizedName}]/ ${group.ticks} ticks\n`;
      let ch = group.startChannel;
      for (const mml of group.mmlList) {
        output += `DATA ":${ch} ${mml}"\n`;
        chars += mml.length;
        ch++;
      }
    }
    if (!output) {
      output = `DATA 0\n`;
    } else {
      output += `DATA 0\n`;
    }
    const titleHeader = title ? `'Title: ${title} / ${chars} characters\n` : '';
    fullMml = `CLS\nBGMSETD 128,@MMLDATA: BGMPLAY 128\nREPEAT: WAIT: UNTIL BUTTON()\nSNDSTOP\n@MMLDATA\n${titleHeader}${output}`;
  } else {
    // format === 'mml'
    const headerLines = [];
    if (title && title.trim() !== '') {
      headerLines.push(`{TITLE=${title.trim()}}`);
    }

    const bodyLines = [];
    for (const group of channelOutputs) {
      const sanitizedName = group.trackName.replace(/\//g, '-');
      bodyLines.push(`/[${sanitizedName}]/`);
      let ch = group.startChannel;
      for (const mml of group.mmlList) {
        bodyLines.push(`:${ch} ${mml}`);
        ch++;
      }
      bodyLines.push('');
    }

    fullMml = (headerLines.length > 0 ? headerLines.join('\n') + '\n\n' : '') + bodyLines.join('\n').trim() + '\n';
  }

  return {
    title,
    mml: fullMml,
    trackInfo: trackInfo.map((t) => ({
      name: t.name,
      totalNotes: t.totalNotes,
      maxPoly: t.maxPoly,
      ticks: t.ticks,
    })),
  };
}

export default {
  SMFToMML,
  decodeMidiText,
  convertSmfToMml,
};
