/**
 * 식별 토큰 보관(ADR-0042 §6.8). 봉투(`session.ts`의 `cb.state.{slug}`)·상담 토큰(`cb.handoff.{slug}`)
 * 과 **분리된** 별도 `sessionStorage` 키 `cb.idt.{slug}`에 원문 토큰 문자열만 담는다. 호스트 페이지의
 * 쿠키·localStorage는 쓰지 않는다(NFR-S8). 프라이빗 모드 등으로 접근이 불가하면 메모리로 폴백한다.
 */
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
  return `cb.idt.${slug}`;
}

export function loadIdentityToken(slug: string): string | undefined {
  const s = trySessionStorage();
  const raw = s ? s.getItem(storageKey(slug)) : (memoryStore.get(storageKey(slug)) ?? null);
  return raw ?? undefined;
}

export function saveIdentityToken(slug: string, token: string): void {
  const s = trySessionStorage();
  if (s) {
    s.setItem(storageKey(slug), token);
    return;
  }
  memoryStore.set(storageKey(slug), token);
}

export function clearIdentityToken(slug: string): void {
  const s = trySessionStorage();
  if (s) {
    s.removeItem(storageKey(slug));
    return;
  }
  memoryStore.delete(storageKey(slug));
}
