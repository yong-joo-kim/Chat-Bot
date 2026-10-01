// 시각 표기 도우미 — 무대·보고서·터미널이 같은 표기(HH:mm:ss · mm:ss)를 쓴다(ui-spec §9.1).

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 로컬 시각 HH:mm:ss */
export function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 초 → mm:ss (예: 71 → "01:11") */
export function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** runId용 로컬 시각 스탬프 YYYYMMDD-HHmmss */
export function stampOf(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** 오프셋이 붙은 ISO 문자열(+09:00 형태) — result.json 용. */
export function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

const RUN_ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
export function isRunId(s: string): boolean {
  return RUN_ID_RE.test(s);
}

export function makeRunId(now: Date = new Date(), rand: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(rand() * alphabet.length)];
  return `${stampOf(now)}-${suffix}`;
}
