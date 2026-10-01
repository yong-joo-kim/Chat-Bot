// 터미널 표시 폭 계산(ui-spec §9.1 "한글 폭") — 한글 완성형·한자·전각 = 2칸, ASCII = 1칸, 결합 문자 = 0칸.
// 문자 수 기준 padEnd는 한국어 콘솔에서 열이 어긋나므로 이 함수만 쓴다.

function charWidth(cp: number): number {
  if (cp === 0) return 0;
  // 제어 문자 · 결합 문자 · 폭 없는 문자
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // 한글 자모
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 부수 · 가나 · 한자 등
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 호환 한자
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // 전각
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // 이모지(하네스는 쓰지 않지만 방어)
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

/** 표시 폭 기준 오른쪽 채우기(넘으면 그대로). */
export function padEndWidth(text: string, width: number, fill = ' '): string {
  const w = displayWidth(text);
  return w >= width ? text : text + fill.repeat(width - w);
}

/** 표시 폭 기준 왼쪽 채우기. */
export function padStartWidth(text: string, width: number, fill = ' '): string {
  const w = displayWidth(text);
  return w >= width ? text : fill.repeat(width - w) + text;
}

/**
 * 표시 폭 기준 줄바꿈. 둘째 줄부터 indent를 붙인다. 공백이 없는 긴 낱말은 폭에서 강제로 자른다.
 * 한 줄 표시 폭은 78칸 이하(80칸 터미널 기본)가 되도록 호출자가 width를 정한다.
 */
export function wrapByWidth(text: string, width: number, indent = ''): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = '';
    let lineW = 0;
    for (const ch of rawLine) {
      const cw = charWidth(ch.codePointAt(0) ?? 0);
      const prefix = out.length === 0 ? '' : indent;
      const max = width - displayWidth(prefix);
      if (lineW + cw > max && line !== '') {
        const lastSpace = line.lastIndexOf(' ');
        if (ch !== ' ' && lastSpace > 0) {
          // 낱말 중간이면 직전 공백에서 끊는다
          out.push(prefix + line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1);
          lineW = displayWidth(line);
        } else {
          out.push(prefix + line.trimEnd());
          line = '';
          lineW = 0;
          if (ch === ' ') continue;
        }
      }
      line += ch;
      lineW += cw;
    }
    out.push((out.length === 0 ? '' : indent) + line);
  }
  return out;
}

/** "이름 ........ 상태" 형태의 점선 채움 줄(ui-spec §9.2). */
export function dotLeader(left: string, right: string, width = 78): string {
  const used = displayWidth(left) + displayWidth(right) + 2;
  const dots = Math.max(3, width - used);
  return `${left} ${'.'.repeat(dots)} ${right}`;
}
