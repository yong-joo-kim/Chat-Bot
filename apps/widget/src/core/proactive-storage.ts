import { proactiveStorageKey } from '../constants/proactive';

/**
 * [신규 No.35] 선제 안내 브라우저 저장(§6.6) — `sessionStorage` 키 `cb.pa.{slug}` 1개.
 * `core/session.ts`와 같은 원칙(탐침 후 실패하면 메모리 폴백, PA-11 — `localStorage`·`document.cookie`
 * 사용 0)을 따르되 **이 파일 자체가 전용 저장 모듈**이다(session.ts를 재사용하지 않고 분리 — 노출
 * 횟수·닫음 기록은 대화 세션 상태와 별개 개념이라 서로 다른 파일에 둔다, 설계서 §6.6).
 */
export interface ProactiveRecord {
  shownCount: number;
  lastShownAtMs?: number;
  /** 이 세션에서 닫힌(또는 끄기 대상) 규칙 id 목록(최근 20개까지만 보관). */
  closedRuleIds: string[];
  optedOut: boolean;
  lastUserSendAtMs?: number;
}

const memoryStore = new Map<string, string>();

function trySessionStorage(): Storage | null {
  try {
    const probeKey = '__cb_pa_probe__';
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

function defaultRecord(): ProactiveRecord {
  return { shownCount: 0, closedRuleIds: [], optedOut: false };
}

/** 형식이 불량하면 초기값으로 취급한다(§6.6 — "형식 불량 = 초기값"). */
export function loadProactiveRecord(slug: string): ProactiveRecord {
  const raw = getItem(proactiveStorageKey(slug));
  if (!raw) return defaultRecord();
  try {
    const parsed = JSON.parse(raw) as Partial<ProactiveRecord> & { v?: number };
    if (parsed.v !== 1) return defaultRecord();
    return {
      shownCount: typeof parsed.shownCount === 'number' ? parsed.shownCount : 0,
      lastShownAtMs: typeof parsed.lastShownAtMs === 'number' ? parsed.lastShownAtMs : undefined,
      closedRuleIds: Array.isArray(parsed.closedRuleIds) ? parsed.closedRuleIds.filter((v): v is string => typeof v === 'string').slice(-20) : [],
      optedOut: parsed.optedOut === true,
      lastUserSendAtMs: typeof parsed.lastUserSendAtMs === 'number' ? parsed.lastUserSendAtMs : undefined,
    };
  } catch {
    return defaultRecord();
  }
}

function saveProactiveRecord(slug: string, record: ProactiveRecord): void {
  setItem(proactiveStorageKey(slug), JSON.stringify({ v: 1, ...record }));
}

export function recordShown(slug: string, nowMs: number): ProactiveRecord {
  const rec = loadProactiveRecord(slug);
  const next: ProactiveRecord = { ...rec, shownCount: rec.shownCount + 1, lastShownAtMs: nowMs };
  saveProactiveRecord(slug, next);
  return next;
}

export function recordClosed(slug: string, ruleId: string): ProactiveRecord {
  const rec = loadProactiveRecord(slug);
  if (rec.closedRuleIds.includes(ruleId)) return rec;
  const next: ProactiveRecord = { ...rec, closedRuleIds: [...rec.closedRuleIds, ruleId].slice(-20) };
  saveProactiveRecord(slug, next);
  return next;
}

export function recordOptedOut(slug: string): ProactiveRecord {
  const rec = loadProactiveRecord(slug);
  const next: ProactiveRecord = { ...rec, optedOut: true };
  saveProactiveRecord(slug, next);
  return next;
}

export function recordUserSend(slug: string, nowMs: number): ProactiveRecord {
  const rec = loadProactiveRecord(slug);
  const next: ProactiveRecord = { ...rec, lastUserSendAtMs: nowMs };
  saveProactiveRecord(slug, next);
  return next;
}
