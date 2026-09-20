import type { ConversationState } from '@chat-bot/shared-types';

/**
 * 세션 보관(FR-W-8, DD-18, §9.4). `sessionStorage`에 `sessionId`/`state`를 보관하고,
 * 프라이빗 모드 등으로 접근 불가하면 메모리로 폴백한다(EX-W-7). 호스트 페이지의 쿠키·localStorage는
 * 절대 쓰지 않는다(NFR-S8).
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

function getItem(key: string): string | null {
  const s = trySessionStorage();
  return s ? s.getItem(key) : (memoryStore.get(key) ?? null);
}

function setItem(key: string, value: string): void {
  const s = trySessionStorage();
  if (s) {
    s.setItem(key, value);
    return;
  }
  memoryStore.set(key, value);
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 매우 오래된 브라우저 폴백(암호학적으로 강하지 않지만 sessionId는 인증 수단이 아니다, §9.4).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateSessionId(slug: string): string {
  const key = `cb.sid.${slug}`;
  const existing = getItem(key);
  if (existing) return existing;
  const id = generateUuid();
  setItem(key, id);
  return id;
}

export function loadConversationState(slug: string): ConversationState | undefined {
  const raw = getItem(`cb.state.${slug}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ConversationState;
  } catch {
    return undefined;
  }
}

export function saveConversationState(slug: string, state: ConversationState | undefined): void {
  const key = `cb.state.${slug}`;
  setItem(key, state === undefined ? '' : JSON.stringify(state));
}
