import type {
  ChatbotAnswerSetting,
  ChatbotSnapshotProfile,
  ContextVariable,
  DialogNode,
  DialogueBundle,
  FaqEntry,
  HomonymDictionary,
  Intent,
  Keyword,
  VersionCounts,
} from '@chat-bot/shared-types';
import { SNAPSHOT_SCHEMA_VERSION } from '@chat-bot/shared-types';

/**
 * 캡처 결과(§6.1) → 저장 봉투(slim, §5.1) 변환 — DB·Nest 무의존 순수 함수(NFR-HM1).
 * 항목별 `chatbotId`·`updatedAt`을 제거한다(FR-H1-3). `createdAt`은 보존한다.
 */

export type SlimIntent = Omit<Intent, 'chatbotId' | 'updatedAt'>;
export type SlimKeyword = Omit<Keyword, 'chatbotId' | 'updatedAt'>;
export type SlimHomonym = Omit<HomonymDictionary, 'chatbotId' | 'updatedAt'>;
export type SlimNode = Omit<DialogNode, 'chatbotId' | 'updatedAt'>;
export type SlimContext = Omit<ContextVariable, 'chatbotId' | 'updatedAt'>;
export type SlimFaq = Omit<FaqEntry, 'chatbotId' | 'updatedAt'>;
export type SlimAnswerSetting = Omit<ChatbotAnswerSetting, 'chatbotId' | 'createdAt' | 'updatedAt'>;

export interface SnapshotAssets {
  intents: SlimIntent[];
  keywords: SlimKeyword[];
  homonyms: SlimHomonym[];
  dialogNodes: SlimNode[];
  contexts: SlimContext[];
  faqs: SlimFaq[];
}

/** [신규 No.40 — 커밋 ①] 해시 밖 보조 필드(C-1) — 노드 id → 캡처 당시 updatedAt(ISO). */
export interface SnapshotTiebreak {
  nodeUpdatedAt: Record<string, string>;
}

/** 저장 봉투(§5.1) — `payload` 컬럼에 그대로 직렬화된다. */
export interface SnapshotEnvelope {
  schemaVersion: number;
  capturedAt: string;
  chatbotId: string;
  assets: SnapshotAssets;
  answerSetting: SlimAnswerSetting | null;
  profile: ChatbotSnapshotProfile;
  /** [신규 No.40] 선택 필드 — 해시 범위 밖(`snapshot-canonical.ts`는 이 키를 보지 않는다). */
  tiebreak?: SnapshotTiebreak;
}

export interface CapturedAssets {
  chatbotId: string;
  bundle: DialogueBundle;
  answerSetting: ChatbotAnswerSetting | null;
  profile: ChatbotSnapshotProfile;
}

function stripIdentity<T extends { chatbotId: string; updatedAt: unknown }>(row: T): Omit<T, 'chatbotId' | 'updatedAt'> {
  const { chatbotId: _chatbotId, updatedAt: _updatedAt, ...rest } = row;
  return rest;
}

export function buildSnapshotEnvelope(captured: CapturedAssets, capturedAt: Date): SnapshotEnvelope {
  const { bundle, answerSetting, profile, chatbotId } = captured;
  // [신규 No.40 — 커밋 ①] C-1: 라이브 값(stripIdentity 전)의 노드 updatedAt을 해시 밖 보조 필드에
  // 담는다. 엔진이 updatedAt을 읽는 곳은 rankNodes(node-matcher.ts) 1곳뿐이라 노드만 담는다.
  const nodeUpdatedAt: Record<string, string> = {};
  for (const node of bundle.dialogNodes) {
    nodeUpdatedAt[node.id] = new Date(node.updatedAt as unknown as string | Date).toISOString();
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: capturedAt.toISOString(),
    chatbotId,
    assets: {
      intents: bundle.intents.map(stripIdentity),
      keywords: bundle.keywords.map(stripIdentity),
      homonyms: bundle.homonyms.map(stripIdentity),
      dialogNodes: bundle.dialogNodes.map(stripIdentity),
      contexts: bundle.contexts.map(stripIdentity),
      faqs: bundle.faqs.map(stripIdentity),
    },
    answerSetting: answerSetting
      ? (() => {
          const { chatbotId: _c, createdAt: _ca, updatedAt: _u, ...rest } = answerSetting;
          return rest;
        })()
      : null,
    profile,
    tiebreak: { nodeUpdatedAt },
  };
}

/** 캡처 시점의 종류별 건수(§5.3, AC-H1-1). */
export function computeVersionCounts(envelope: SnapshotEnvelope): VersionCounts {
  const nodeIntentLinks = envelope.assets.dialogNodes.reduce((sum, n) => sum + n.intentIds.length, 0);
  const nodeKeywordLinks = envelope.assets.dialogNodes.reduce((sum, n) => sum + n.keywordIds.length, 0);
  const intentExamples = envelope.assets.intents.reduce((sum, i) => sum + i.examples.length, 0);
  return {
    intents: envelope.assets.intents.length,
    intentExamples,
    keywords: envelope.assets.keywords.length,
    homonyms: envelope.assets.homonyms.length,
    contexts: envelope.assets.contexts.length,
    dialogNodes: envelope.assets.dialogNodes.length,
    nodeIntentLinks,
    nodeKeywordLinks,
    faqs: envelope.assets.faqs.length,
    answerSetting: envelope.answerSetting ? 1 : 0,
  };
}
