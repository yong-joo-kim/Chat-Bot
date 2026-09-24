import { AUDIT_LIMITS } from '@chat-bot/shared-types';
import type { AuditTargetType } from '@chat-bot/shared-types';

/**
 * 감사 스냅샷 화이트리스트(FR-13-11, NFR-S8, ADR-0016 §9.6). 대량 필드는 원문이 아니라
 * 건수로 대체한다(`examples`→`exampleCount` 등) — 서비스가 스냅샷 입력을 만들 때 이미 건수로 변환해
 * 넘겨야 한다. `User`에는 `passwordHash`가 물리적으로 들어갈 수 없다(화이트리스트에 없다).
 */
const AUDIT_FIELDS: Record<AuditTargetType, readonly string[]> = {
  // [No.29] archivedAt 추가 — 그룹 "삭제"가 보관으로 처리될 때 after 스냅샷에 보관 시각을 남긴다.
  ChatbotGroup: ['name', 'description', 'archivedAt'],
  // FAQ/의도 매칭 고도화 그룹(nlu-rag-answering-설계.md §11.3, FR-N3-9) 추가분 — AI 답변 설정
  // 저장은 `targetType: 'Chatbot'`으로 기록하며 화이트리스트에 임계값 3종·활성화 여부·스코프
  // 3종·정책·타임아웃을 포함한다(대화 문장은 절대 포함하지 않는다, AC-N1-19).
  Chatbot: [
    'name',
    'slug',
    'status',
    'groupId',
    'description',
    'avatarUrl',
    'semanticEnabled',
    'acceptThreshold',
    'lowThreshold',
    'marginThreshold',
    'ragEnabled',
    'ragCompany',
    'ragCategory',
    'ragSubcategory',
    'ragSimilarityThreshold',
    'fallbackPolicy',
    'showSources',
    'ragTimeoutMs',
  ],
  Intent: ['name', 'description', 'exampleCount'],
  Keyword: ['name', 'synonymCount'],
  HomonymDictionary: ['word', 'policy', 'meaningCount'],
  ContextVariable: ['name', 'slotCount', 'cancelKeywords', 'sessionTimeoutMinutes'],
  DialogNode: ['name', 'nodeType', 'priority', 'enabled', 'outputCount', 'intentIds', 'keywordIds', 'contextVariableId'],
  FaqEntry: ['question', 'category', 'enabled', 'altQuestionCount'],
  Channel: ['type', 'enabled'],
  User: ['email', 'name', 'role', 'status'],
  BannedWord: ['word', 'matchType', 'policy', 'enabled'],
  Session: [],
  // 검증/품질 고도화(No.19) 그룹 추가 — TC 세트만 감사 대상이다(ADR-0029 §5). `caseCount`는
  // 서비스가 스냅샷 입력을 만들 때 이미 건수로 채워 넘긴다(대량 필드 원문 미포함 규약과 동일).
  TestCaseSet: ['name', 'description', 'isDefault', 'caseCount'],
  // 챗봇 복원/버전 이력관리(No.25) 그룹 추가(version-history-설계.md §12) — 수동 생성/라벨·메모/고정/
  // 삭제 감사. `RESTORE`는 요약 액션이라 이 화이트리스트를 거치지 않는다(AuditLogService.isBulkSummary).
  ChatbotVersion: ['versionNo', 'trigger', 'label', 'memo', 'pinned', 'sizeBytes'],
  // 운영 예약 배포(No.28) 그룹 추가(scheduled-deploy-설계.md §8.4) — 생성/수정/취소/재개 감사.
  // params는 매퍼가 평탄화한 enableWebChannel/enabled를 number/boolean으로만 추가한다(원문 없음).
  DeploySchedule: ['action', 'status', 'scheduledAt', 'targetVersionNo', 'memo', 'enableWebChannel', 'enabled'],
  // 레거시 API 연동(No.26) 그룹 추가(legacy-api-integration-설계.md §11) — `secretRef`는 **이름**,
  // `baseUrl`은 **호스트만**, 샘플은 **개수만**(원문 없음).
  ApiConnection: [
    'name',
    'baseUrlHost',
    'allowedMethods',
    'authType',
    'secretRef',
    'timeoutMs',
    'rateLimitPerMin',
    'allowRawPersonalData',
    'personalDataLookup',
    'enabled',
    'sampleCount',
  ],
  // 설문관리(No.27) 그룹 추가(survey-management-설계.md §12) — 문항 문구·선택지·소개·완료 문구·
  // 취소어 본문을 담지 않는다(`DialogNode.outputs` 제외 선례).
  Survey: ['name', 'status', 'activeFrom', 'activeTo', 'questionCount', 'structureVersion', 'sessionTimeoutMinutes'],
};

/** 엔터티(도메인 객체)에서 화이트리스트 필드만 뽑아 스냅샷을 만든다. */
export function buildSnapshot(targetType: AuditTargetType, entity: unknown): Record<string, unknown> | null {
  if (entity === null || entity === undefined) return null;
  const fields = AUDIT_FIELDS[targetType] ?? [];
  const source = entity as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) snapshot[field] = source[field];
  }
  return snapshot;
}

export interface SerializedSnapshot {
  json: string | null;
  truncated: boolean;
}

/** 직렬화 결과가 상한(8KB)을 넘으면 필드를 뒤에서부터 잘라내고 `__truncated:true`를 남긴다(EX-13-11). */
export function serializeSnapshot(snapshot: Record<string, unknown> | null): SerializedSnapshot {
  if (snapshot === null) return { json: null, truncated: false };
  const keys = Object.keys(snapshot);

  for (let cut = keys.length; cut >= 0; cut -= 1) {
    const partial: Record<string, unknown> = {};
    for (let i = 0; i < cut; i += 1) partial[keys[i]] = snapshot[keys[i]];
    const truncated = cut < keys.length;
    const payload = truncated ? { ...partial, __truncated: true } : partial;
    const json = JSON.stringify(payload);
    if (cut === 0 || Buffer.byteLength(json, 'utf8') <= AUDIT_LIMITS.snapshotBytes) {
      return { json, truncated };
    }
  }
  return { json: '{}', truncated: true };
}
