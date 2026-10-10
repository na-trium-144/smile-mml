/**
 * Extended MML Macro and Tag Handling
 * Faithful port of EXMML$ from VMML-LIB (ver1.6)
 */

/**
 * Extracts a macro definition from MML string by tag name: {TAG=content}
 * Handles nested brackets and escape sequences according to Extended MML specs.
 */
export function extractMacro(mml: string, tag: string): string {
  const searchPrefix = `{${tag}=`;
  const i = mml.indexOf(searchPrefix);
  if (i === -1) {
    return '';
  }

  const start = i + searchPrefix.length;
  let depth = 0;
  let end = mml.length;

  for (let j = start; j < mml.length; j++) {
    const ch = mml[j];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (depth === 0) {
        end = j;
        break;
      }
      depth--;
    }
  }

  let r = mml.slice(start, end);

  // Escape sequence handling matching EXMML$
  let j = 0;
  let k = r.length - 2;

  const findNext = (fromIdx: number): number => {
    const p1 = r.indexOf('\\', fromIdx);
    const p2 = r.indexOf('\x7f', fromIdx);
    const p3 = r.indexOf('/', fromIdx);

    const minValid = (a: number, b: number): number => {
      if (a < 0) return b;
      if (b < 0) return a;
      return Math.min(a, b);
    };

    return minValid(p1, minValid(p2, p3));
  };

  let matchIdx = findNext(j);
  while (matchIdx >= 0) {
    if (k >= matchIdx) {
      const charAtI = r[matchIdx];
      const nextChar = matchIdx + 1 < r.length ? r[matchIdx + 1] : '';

      if (charAtI !== '/') {
        const pTable = "();'/\x7fn\\";
        const p = pTable.indexOf(nextChar);
        if (p === 0) {
          // \( -> \{
          r = r.slice(0, matchIdx) + '\\{' + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p === 1) {
          // \) -> \}
          r = r.slice(0, matchIdx) + '\\}' + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p === 2) {
          // \; -> \;
          r = r.slice(0, matchIdx) + '\\;' + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p === 3) {
          // \' -> \'
          r = r.slice(0, matchIdx) + "\\'" + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p === 4) {
          // \/ -> \/
          if (charAtI !== '\x7f') {
            r = r.slice(0, matchIdx) + '\\/' + r.slice(matchIdx + 2);
            j = matchIdx + 1;
          }
        } else if (p === 5) {
          // \\x7f -> \\x7f
          r = r.slice(0, matchIdx) + '\\\x7f' + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p === 6) {
          // \n -> \LF
          r = r.slice(0, matchIdx) + '\\\n' + r.slice(matchIdx + 2);
          j = matchIdx + 1;
        } else if (p !== 7) {
          // Other -> \\
          r = r.slice(0, matchIdx) + '\\\\' + r.slice(matchIdx + 1);
          j = matchIdx + 2;
          k++;
        }
      } else if (nextChar === 'n') {
        r = r.slice(0, matchIdx) + '\\\n' + r.slice(matchIdx + 2);
        j = matchIdx + 1;
      }
      j++;
      matchIdx = findNext(j);
    } else {
      break;
    }
  }

  // Remove escape backslashes
  let slashIdx = r.indexOf('\\');
  while (slashIdx >= 0) {
    if (k >= slashIdx) {
      r = r.slice(0, slashIdx) + r.slice(slashIdx + 1);
      k--;
    }
    slashIdx = r.indexOf('\\', slashIdx + 1);
  }

  return r;
}
