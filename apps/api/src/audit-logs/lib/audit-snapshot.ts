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
  // [신규 No.22] 자산 6종에 'topicId' 추가 — 서비스가 값이 있을 때만 스냅샷 입력에 넣는다(토픽 없는
  // 챗봇의 감사 본문 불변, topic-system-설계.md §15).
  Intent: ['name', 'description', 'exampleCount', 'topicId'],
  Keyword: ['name', 'synonymCount', 'topicId'],
  HomonymDictionary: ['word', 'policy', 'meaningCount', 'topicId'],
  ContextVariable: ['name', 'slotCount', 'cancelKeywords', 'sessionTimeoutMinutes', 'topicId'],
  DialogNode: ['name', 'nodeType', 'priority', 'enabled', 'outputCount', 'intentIds', 'keywordIds', 'contextVariableId', 'topicId'],
  FaqEntry: ['question', 'category', 'enabled', 'altQuestionCount', 'topicId'],
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
  // 하이브리드 CS(No.24) 그룹 추가(hybrid-cs-설계.md §16, ADR-0036 §6) — 원문(`rawText`)·전체
  // `sessionId`·`sessionRef`·토큰은 화이트리스트에 없다(§18 H-15). `alias`는 서비스가 조립해 넣는
  // 파생 필드(원문 없는 표시용 식별자)다.
  HandoffSession: ['status', 'endReason', 'assignedUserName', 'alertLevelAtStart', 'alias'],
  // 본문(body) 제외 — FAQ 답변 제외 선례와 동일.
  CannedResponse: ['title', 'category', 'shortcut', 'enabled', 'sortOrder', 'bodyLength'],
  // 토픽 시스템(No.22) 그룹 추가(topic-system-설계.md §15).
  Topic: ['name', 'description', 'sortOrder', 'enabled'],
  // 환경 분리 / 버전 관리(No.40) 그룹 추가(environment-separation-설계.md §18) — 사유 메모 본문·
  // 자산 본문·발화는 화이트리스트에 없다(FR-0-155).
  ChatbotEnvironment: ['enabled', 'stagingVersionNo', 'prodVersionNo', 'gateMode', 'gateTestSetId', 'gateMinPassRate', 'gateValidHours'],
  // 데이터 거버넌스(No.45) 그룹 추가(data-governance-설계.md §11.1) — VIEW/EXPORT·파기 요약은
  // 이 화이트리스트를 거치지 않는다(요약 액션 — AuditLogService.isBulkSummary). `RAW_VIEW`도 여전히
  // 요약뿐(§9.4). 텍스트 필드는 0건(G-18).
  ConversationLog: [],
  UnansweredQuestion: [],
  AuditLog: [],
  TestRun: [],
  RetentionPolicy: [
    'conversationTextDays',
    'unansweredClosedDays',
    'surveyFreeTextDays',
    'handoffTextDays',
    'callLogsDays',
    'auditLogsDays',
    // [신규 No.42]
    'inboxTextDays',
    'customerIdentityDays',
    'pendingKinds',
    'pendingEffectiveAt',
  ],
  RetentionRun: ['kind', 'status', 'affectedByKind', 'headSeq', 'anchorSeq'],
  // 업무 자동화 워크플로우(No.41) 그룹 추가(workflow-automation-설계.md §15, ADR-0041) — ref **이름**만
  // (값은 DB에도 없다). `payload`·`fields`·`value`·`sessionId`·비밀 값 필드명은 절대 포함하지 않는다(W-6).
  WorkflowTarget: [
    'name',
    'description',
    'baseUrl',
    'authType',
    'authHeaderName',
    'secretRef',
    'signingEnabled',
    'signingSecretRef',
    'urlSecretRef',
    'timeoutMs',
    'maxAttempts',
    'allowRawPersonalData',
    'enabled',
  ],
  WorkflowSubscription: ['eventType', 'targetId', 'enabled', 'conditions'],
  // 발송 1건 1건은 감사가 아니다(요약 전용) — before/after 없음.
  WorkflowRun: [],
  // 옴니채널 통합 인박스(No.42) 그룹 추가(omnichannel-inbox-설계.md §12.1) — `displayName`·
  // `customerKeyHash`·`sessionId`·`text` 0건(O-6·G-18 형식). 요약은 별칭만.
  Customer: ['kind', 'status', 'ref'],
  InboxThread: ['status', 'snoozeUntil', 'assigneeUserId', 'assigneeUserName', 'version'],
  InboxTag: ['name', 'color'],
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
