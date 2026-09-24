/**
 * 상담 토큰 보관(P-5 · ADR-0036 §6.1). 봉투(`session.ts`의 `cb.state.{slug}`)와 **분리된** 별도
 * `sessionStorage` 키(`cb.handoff.{slug}`)에 `{ token, cursor }`만 담는다 — 토큰은 신원 값이라
 * 봉투에 섞지 않는다(ADR-0009 §3). 원문은 절대 담지 않는다(§9.7). 프라이빗 모드 등으로 접근이
 * 불가하면 메모리로 폴백한다(`session.ts`와 동일한 방식·인스턴스는 분리).
 */
export interface StoredHandoffToken {
  token: string;
  cursor: number;
}

const memoryStore = new Map<string, string>();

function trySessionStorage(): Storage | null {
  try {
    const probeKey = '__cb_probe__';
    window.sessionStorage.setItem(probeKey, '1');
    window.sessionStorage.removeItem(probeKey);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(slug: string): string {
  return `cb.handoff.${slug}`;
}

export function loadHandoffToken(slug: string): StoredHandoffToken | undefined {
  const s = trySessionStorage();
  const raw = s ? s.getItem(storageKey(slug)) : (memoryStore.get(storageKey(slug)) ?? null);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHandoffToken>;
    if (typeof parsed.token === 'string' && typeof parsed.cursor === 'number') {
      return { token: parsed.token, cursor: parsed.cursor };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function saveHandoffToken(slug: string, value: StoredHandoffToken): void {
  const raw = JSON.stringify(value);
  const s = trySessionStorage();
  if (s) {
    s.setItem(storageKey(slug), raw);
    return;
  }
  memoryStore.set(storageKey(slug), raw);
}

export function clearHandoffToken(slug: string): void {
  const s = trySessionStorage();
  if (s) {
    s.removeItem(storageKey(slug));
    return;
  }
  memoryStore.delete(storageKey(slug));
}
