import type { ConfigService } from '@nestjs/config';
import { IMPORT_LIMITS } from '@chat-bot/shared-types';

/**
 * 발화 묶음 분석 설정 읽기(No.21 — 설계서 §18.1). 전부 선택 환경변수이고 기본값으로 기동 조건이 불변이다.
 * 여러 서비스가 같은 기본값을 쓰도록 이 파일 1곳에서 읽는다.
 */
export interface UtteranceAnalysisConfig {
  readonly enabled: boolean;
  readonly maxRows: number;
  readonly maxChars: number;
  readonly maxFileBytes: number;
  readonly retentionDays: number;
  readonly maxStoredPerChatbot: number;
  readonly embedBatchSize: number;
  readonly embedPauseMs: number;
  readonly embedYieldRatio: number;
  readonly nameSuggestEnabled: boolean;
  readonly nameSuggestTimeoutMs: number;
  readonly nameSuggestBudgetMs: number;
  readonly nameSuggestBaseUrl: string | undefined;
  readonly embeddingBaseUrl: string | undefined;
}

export function readUtteranceAnalysisConfig(config: ConfigService): UtteranceAnalysisConfig {
  return {
    enabled: config.get<boolean>('UTTERANCE_ANALYSIS_ENABLED') ?? true,
    maxRows: config.get<number>('UTTERANCE_ANALYSIS_MAX_ROWS') ?? 5000,
    maxChars: config.get<number>('UTTERANCE_ANALYSIS_MAX_CHARS') ?? 300,
    maxFileBytes: IMPORT_LIMITS.maxFileBytes,
    retentionDays: config.get<number>('UTTERANCE_ANALYSIS_RETENTION_DAYS') ?? 90,
    maxStoredPerChatbot: config.get<number>('UTTERANCE_ANALYSIS_MAX_STORED_PER_CHATBOT') ?? 20,
    embedBatchSize: config.get<number>('UTTERANCE_ANALYSIS_EMBED_BATCH_SIZE') ?? 16,
    embedPauseMs: config.get<number>('UTTERANCE_ANALYSIS_EMBED_PAUSE_MS') ?? 100,
    embedYieldRatio: config.get<number>('UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO') ?? 1,
    nameSuggestEnabled: config.get<boolean>('UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED') ?? false,
    nameSuggestTimeoutMs: config.get<number>('UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS') ?? 30_000,
    nameSuggestBudgetMs: config.get<number>('UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS') ?? 300_000,
    nameSuggestBaseUrl: config.get<string>('AUGMENTATION_LOCAL_BASE_URL') || undefined,
    embeddingBaseUrl: config.get<string>('EMBEDDING_BASE_URL') || undefined,
  };
}

/** 이름 제안 가용 판정(§16.1) — 설정 켬 ∧ 로컬 생성기 주소 있음(네트워크 확인 없음). */
export function isNameSuggestAvailable(cfg: UtteranceAnalysisConfig): boolean {
  return cfg.nameSuggestEnabled && cfg.nameSuggestBaseUrl !== undefined;
}
