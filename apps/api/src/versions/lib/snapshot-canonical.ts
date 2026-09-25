import { createHash } from 'node:crypto';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * 정규 직렬화 · `contentHash`(§5.2, FR-H1-11) — DB·Nest 무의존 순수 함수.
 * 해시 범위는 `assets` + `answerSetting` + `profile`만이다. `schemaVersion`·`capturedAt`·`chatbotId`·
 * 모든 타임스탬프는 제외한다(같은 자산 상태 → 같은 해시, AC-H1-5).
 */

/**
 * 프로토타입이 `Object.prototype` 또는 `null`인 순수 객체 리터럴인가(L-2). `Buffer`·`Uint8Array`·
 * `Map`·`Set`·`RegExp`·커스텀 클래스 인스턴스 등은 이 검사를 통과하지 못한다 — 키를 재귀 순회하면
 * `Date`가 `{}`로 파괴되던 것과 같은 종류의 조용한 손상이 재발할 수 있기 때문이다(M-2).
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value; // Date는 리프 값 — JSON.stringify가 toJSON()으로 직렬화한다.
  if (Array.isArray(value)) return value.map(sortKeysDeep);

  if (!isPlainObject(value)) {
    // L-2: 스냅샷은 도메인 스키마(zod)에서 나온 순수 객체/배열/원시값/Date만 담아야 한다. 그 밖의
    // 타입(Buffer/Map/Set 등)이 여기까지 들어오면 원인 모를 직렬화 손상으로 이어지므로 즉시 실패시킨다.
    const ctorName = (value as { constructor?: { name?: string } }).constructor?.name ?? 'Unknown';
    throw new Error(`sortKeysDeep: 지원하지 않는 객체 타입(${ctorName})입니다 — 스냅샷 정규화는 일반 객체·배열·Date·원시값만 지원합니다.`);
  }

  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // undefined 키는 생략(값 null은 유지) — §5.2
    sorted[key] = sortKeysDeep(v);
  }
  return sorted;
}

function byIdAsc<T extends { id: string }>(arr: readonly T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 임의 객체에서 지정된 키를 제외한 얕은 복사본을 만든다 — 해시(`toHashComparable`)와 차이 계산
 * (`version-diff.ts` `comparableOf`)이 "타임스탬프 제외" 규칙을 공유하는 단일 지점이다(M-2).
 */
export function omitKeys<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const clone: Partial<T> = { ...obj };
  for (const key of keys) delete clone[key];
  return clone as Omit<T, K>;
}

/**
 * 저장 봉투와 같은 형태(§5.1)의 정규형 객체 — **`createdAt`을 포함한다**. `payload` 컬럼 직렬화
 * (`serializeEnvelopeForStorage`)가 이 형태를 그대로 쓴다(createdAt 보존 — 목록 정렬이 복원으로
 * 뒤섞이지 않게 한다, FR-H1-3). ⚠ 해시 계산에는 이 함수가 아니라 `toHashComparable`을 쓴다.
 */
export function toCanonicalComparable(envelope: SnapshotEnvelope): unknown {
  return {
    assets: {
      intents: byIdAsc(envelope.assets.intents),
      keywords: byIdAsc(envelope.assets.keywords),
      homonyms: byIdAsc(envelope.assets.homonyms),
      dialogNodes: byIdAsc(envelope.assets.dialogNodes).map((n) => ({
        ...n,
        // 조인 intentIds/keywordIds는 오름차순 정렬(§5.2) — 조인 테이블에는 순서 의미가 없다.
        intentIds: [...n.intentIds].sort(),
        keywordIds: [...n.keywordIds].sort(),
      })),
      contexts: byIdAsc(envelope.assets.contexts),
      faqs: byIdAsc(envelope.assets.faqs),
    },
    answerSetting: envelope.answerSetting ?? null,
    profile: envelope.profile,
    // [신규 No.40] 해시 밖 보조 필드(C-1) — `toHashComparable`은 이 키를 보지 않는다(아래 참고).
    // `sortKeysDeep`이 `undefined` 키를 생략하므로 과거 봉투(tiebreak 없음)의 저장 바이트는 불변이다.
    tiebreak: envelope.tiebreak ?? undefined,
  };
}

/**
 * 해시 범위(§5.2) 전용 정규형 — `toCanonicalComparable`에서 항목별 `createdAt`을 추가로 제외한다.
 * `id`는 유지한다(항목의 정체성은 해시에 반영되어야 한다 — 이름 맞바꿈처럼 내용은 같고 id만 다른
 * 상태는 다른 해시여야 한다). `M-2`: 이전에는 `createdAt`이 해시 범위에 포함되어 있어 설계서
 * §5.2("모든 createdAt/updatedAt 제외")와 어긋났다 — 캡처 시각이 다르면 해시도 달라지는 결함이었다.
 */
function toHashComparable(envelope: SnapshotEnvelope): unknown {
  const comparable = toCanonicalComparable(envelope) as {
    assets: Record<string, ReadonlyArray<Record<string, unknown>>>;
    answerSetting: unknown;
    profile: unknown;
  };
  const stripCreatedAt = (item: Record<string, unknown>) => omitKeys(item, ['createdAt']);
  return {
    assets: {
      intents: comparable.assets.intents.map(stripCreatedAt),
      keywords: comparable.assets.keywords.map(stripCreatedAt),
      homonyms: comparable.assets.homonyms.map(stripCreatedAt),
      dialogNodes: comparable.assets.dialogNodes.map(stripCreatedAt),
      contexts: comparable.assets.contexts.map(stripCreatedAt),
      faqs: comparable.assets.faqs.map(stripCreatedAt),
    },
    answerSetting: comparable.answerSetting,
    profile: comparable.profile,
  };
}

export function canonicalizeSnapshot(envelope: SnapshotEnvelope): string {
  return JSON.stringify(sortKeysDeep(toHashComparable(envelope)));
}

export function computeContentHash(envelope: SnapshotEnvelope): string {
  return createHash('sha256').update(canonicalizeSnapshot(envelope), 'utf8').digest('hex');
}

/**
 * [신규 No.40] `sha256(stableStringify(tiebreak.nodeUpdatedAt))` — `tiebreak`가 없으면 `null`(과거
 * 스냅샷). 환경 캡처의 "재사용" 조건(§5.3)이 `contentHash`만으로는 불충분해(발견 제약 ③) 이 값도
 * 같아야 한다. 목록·재사용 판정이 본문을 읽지 않게 하는 비정규화라 `ChatbotVersion.tiebreakHash`
 * 메타 컬럼에 저장한다.
 */
export function computeTiebreakHash(envelope: SnapshotEnvelope): string | null {
  if (!envelope.tiebreak) return null;
  return createHash('sha256').update(stableStringify(envelope.tiebreak.nodeUpdatedAt), 'utf8').digest('hex');
}

/** 임의 값을 정규(키 정렬) JSON 문자열로 — 차이 계산(§7.2)·복원 계획(§8.4)이 공유하는 동일성 판정 기준. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * `payload` 컬럼에 저장되는 문자열(§5.2) — `contentHash`와 **같은 정렬 규칙**이지만 타임스탬프
 * (`schemaVersion`·`capturedAt`·`chatbotId`·항목별 `createdAt`)를 포함한다. 따라서 저장된 본문에서
 * 해시를 재계산해 검증할 수 있다(§5.4 ③, EX-H-3) — `computeContentHash`는 이 문자열을 다시
 * `JSON.parse`한 뒤에도 `assets`/`answerSetting`/`profile`만 보므로 결과가 동일하다.
 */
export function serializeEnvelopeForStorage(envelope: SnapshotEnvelope): string {
  const comparable = toCanonicalComparable(envelope) as Record<string, unknown>;
  const full = {
    schemaVersion: envelope.schemaVersion,
    capturedAt: envelope.capturedAt,
    chatbotId: envelope.chatbotId,
    ...comparable,
  };
  return JSON.stringify(sortKeysDeep(full));
}
