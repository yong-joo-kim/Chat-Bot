// 데모 데이터 생성 결과(비밀 아닌 ID들) — state.json에 저장되어 재개·시나리오가 쓴다.
export interface BotIds {
  id: string;
  slug: string;
  name: string;
}

export interface DatasetIds {
  groupId: string;
  A: BotIds & {
    intents: Record<string, { intentId: string; nodeId: string; answer: string }>;
    keywordIds: Record<string, string>;
    faqIds: string[];
    faqAnswers: string[];
    startNodeId: string;
    fallbackNodeId: string;
    testSetId: string;
    baselineRunId: string;
    preAnalysisId: string | null;
  };
  B: BotIds & { intentId: string; nodeId: string; v1: VersionRef; v2: VersionRef };
  C: BotIds & {
    intentId: string;
    nodeId: string;
    v1: VersionRef;
    v2: VersionRef;
    /** 이력용 예약 C-1(없으면 --no-history-schedule). */
    historySchedule: { scheduleId: string; scheduledAt: string; approvalId: string } | null;
    /** 이력 예약이 실행된 뒤 라이브 예약용으로 승격한 v3(대기 단계 뒤에 채워진다). */
    v3: VersionRef | null;
  };
  accounts: Record<string, { id: string; email: string; name: string }>;
  counts: { historicalLogs: number; accounts: number; chatbots: number };
  /** 준비 단계 보정(감사 로그 2행 · 임베딩 캐시)을 했는지 — 보고서 공개용. */
  calibrated: boolean;
}

export interface VersionRef {
  versionId: string;
  versionNo: number;
}
