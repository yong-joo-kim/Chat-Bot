/**
 * [신규 No.35] 선제 안내(Proactive Messaging) 위젯 상수 — `proactive-messaging-ui-spec.md` §12.2.
 * `MESSAGES`(기존 대화 UI 문구)와는 별개 객체로 둔다(설계서 §2.1 구조를 그대로 따름 — 선제 안내는
 * 대화 로그를 만들지 않는 별도 UI라 문구 뭉치를 분리해 두는 편이 회귀 파급을 줄인다).
 */
export const PROACTIVE_MESSAGES = {
  defaultLabel: '챗봇 안내',
  dismissLabel: '안내 닫기',
  optOutLabel: '이번 방문 동안 안내 끄기',
  statusAnnounce: (text: string) => `챗봇 안내: ${text}`,
  bodyButtonAriaLabel: '대화 열기',
} as const;

/** 삽입 코드 속성 값(`data-proactive="on"`) — 이 값이 아니면 선제 코드는 전혀 초기화되지 않는다(FR-PA5-1). */
export const PROACTIVE_EMBED_ATTR_ON_VALUE = 'on';

/** 체류 판정 타이머 간격(ms) — 페이지당 1개(NFR-PAP4). */
export const PROACTIVE_TICK_MS = 1000;

/** 브라우저 저장 키 접두(`session.ts`의 `cb.sid.{slug}`류와 같은 작명 규약, §6.6). */
export function proactiveStorageKey(slug: string): string {
  return `cb.pa.${slug}`;
}
