/**
 * DATA文内の要素（文字列・数値・コメント）を正しくトークン化する関数
 */
function parseDataItems(restOfLine: string): {type: "string" | "value", value: string}[] {
  const items: {type: "string" | "value", value: string}[] = [];
  let i = 0;

  while (i < restOfLine.length) {
    // 空白のスキップ
    while (i < restOfLine.length && /\s/.test(restOfLine[i])) i++;
    if (i >= restOfLine.length) break;

    // シングルクォート以降は行末までコメント
    if (restOfLine[i] === "'") break;

    if (restOfLine[i] === '"') {
      // 文字列の開始
      i++; // 開始の " をスキップ
      let str = "";
      while (i < restOfLine.length && restOfLine[i] !== '"') {
        str += restOfLine[i];
        i++;
      }
      if (i < restOfLine.length && restOfLine[i] === '"') {
        i++; // 閉じ " をスキップ
      }
      items.push({ type: "string", value: str });
    } else {
      // 数値やその他の識別子（例: 0）
      let val = "";
      while (
        i < restOfLine.length &&
        restOfLine[i] !== "," &&
        restOfLine[i] !== "'" &&
        !/\s/.test(restOfLine[i])
      ) {
        val += restOfLine[i];
        i++;
      }
      if (val !== "") {
        items.push({ type: "value", value: val.trim() });
      }
    }

    // カンマのスキップ
    while (i < restOfLine.length && /\s/.test(restOfLine[i])) i++;
    if (i < restOfLine.length && restOfLine[i] === ",") {
      i++;
    }
  }

  return items;
}

/**
 * SmileBASICのコードから [ラベル名, MML文字列] のペアを取り出す関数
 */
export function extractSmileBasicMML(code: string): {label: string; content: string}[] {
  const lines = code.split(/\r?\n/);
  const results: {label: string; content: string}[] = [];
  const wavMacros = new Map<number, string>();

  let currentLabel = "";
  let currentMML = "";

  // 現在蓄積中のラベルとMMLを結果に登録する内部処理
  function flush() {
    const strippedMML = currentMML.replace(/\/.*?\//sg, "").replace(/{.*?}/sg, "");
    if(
      // マクロとコメントを除くと、ASCII文字のみで構成されており、空ではない
      /^[\x00-\x7F]+$/.test(strippedMML) && strippedMML.trim()
    ){
      const wavHeader = Array.from(wavMacros.values()).join("\n");
      const fullContent = wavHeader ? `${wavHeader}\n${currentMML}` : currentMML;
      results.push({label: currentLabel, content: fullContent});
    }
    currentLabel = "";
    currentMML = "";
  }

  for (let rawLine of lines) {
    const line = rawLine.trim();

    // 空行または行頭コメントのスキップ
    if (!line || line.startsWith("'") || /^REM\b/i.test(line)) {
      continue;
    }

    // 0. WAVSET の判定 (例: WAVSET 定義番号,A,D,S,R,"波形文字列"[,基準音程])
    const wavsetRegex = /\bWAVSET\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:"([^"]*)"|'([^']*)'|([^\s,;:]+))(?:\s*,\s*(\d+))?/gi;
    let wavsetMatch: RegExpExecArray | null;
    let foundWavset = false;
    while ((wavsetMatch = wavsetRegex.exec(line)) !== null) {
      foundWavset = true;
      const defNum = parseInt(wavsetMatch[1], 10);
      const a = wavsetMatch[2];
      const d = wavsetMatch[3];
      const s = wavsetMatch[4];
      const r = wavsetMatch[5];
      const wavStr = wavsetMatch[6] ?? wavsetMatch[7] ?? wavsetMatch[8] ?? "";
      const basePitch = wavsetMatch[9];
      const macro = basePitch !== undefined
        ? `{WAV${defNum}=${a},${d},${s},${r},${wavStr},${basePitch}}`
        : `{WAV${defNum}=${a},${d},${s},${r},${wavStr}}`;
      wavMacros.set(defNum, macro);
    }
    if (foundWavset && !/^BGMSET\b/i.test(line) && !line.startsWith("@") && !/^DATA\b/i.test(line)) {
      continue;
    }

    // 1. BGMSET の判定 (例: BGMSET 128,"MML文字列")
    const bgmsetMatch = line.match(/^BGMSET\s+([^,]+)\s*,\s*"([^"]*)/i);
    if (bgmsetMatch) {
      const bgmNum = bgmsetMatch[1].trim();
      const content = bgmsetMatch[2];
      const wavHeader = Array.from(wavMacros.values()).join("\n");
      const fullContent = wavHeader ? `${wavHeader}\n${content}` : content;
      results.push({label: `${bgmNum}`, content: fullContent});
      continue;
    }

    // 2. ラベルの判定 (例: @ラベル名)
    if (line.startsWith("@")) {
      flush(); // 前のラベルを確定
      const labelMatch = line.match(/^(@[^\s']+)/);
      if (labelMatch) {
        currentLabel = labelMatch[1];
      }
      continue;
    }

    // 3. DATA文の判定
    const dataMatch = line.match(/^DATA\b(.*)/i);
    if (dataMatch) {
      const items = parseDataItems(dataMatch[1]);

      for (const item of items) {
        if (item.type === "string") {
          currentMML += item.value + "\n";
        } else if (currentMML && item.type === "value" && item.value === "0") {
          // DATA 0 が来たら終端として現在のMMLを確定
          flush();
          break;
        }
      }
      continue;
    }

  }

  // ファイル末尾に達した際の確定処理
  flush();

  if (results.length === 0 && wavMacros.size > 0) {
    results.push({
      label: "WAV",
      content: Array.from(wavMacros.values()).join("\n"),
    });
  }

  return results;
}
