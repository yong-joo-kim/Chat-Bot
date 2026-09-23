import type { ChatbotAnswerSetting, ChatbotSnapshotProfile, DialogueBundle } from '@chat-bot/shared-types';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * slim 봉투 → `DialogueBundle`/설정/프로필 DTO 형태(§5.5, 검증 입력) — DB·Nest 무의존 순수 함수.
 * 항목별 `chatbotId := 현재 챗봇`, `updatedAt := capturedAt`("스냅샷 시점")을 채운다.
 * ⚠ **쓰기에는 이 결과가 아니라 원본(slim) 값을 쓴다** — zod 변환값(.trim()/.default())이 섞이면
 * 복원 후 해시가 대상과 달라진다(§8.5 사후 검증 실패 원인 1순위).
 */
export interface HydratedSnapshot {
  bundle: DialogueBundle;
  answerSetting: ChatbotAnswerSetting | null;
  profile: ChatbotSnapshotProfile;
}

export function hydrateSnapshot(envelope: SnapshotEnvelope, chatbotId: string): HydratedSnapshot {
  const capturedAt = new Date(envelope.capturedAt);
  const withIdentity = <T extends Record<string, unknown>>(row: T): T & { chatbotId: string; updatedAt: Date } => ({
    ...row,
    chatbotId,
    updatedAt: capturedAt,
  });

  const bundle: DialogueBundle = {
    intents: envelope.assets.intents.map((i) => withIdentity({ ...i, createdAt: new Date(i.createdAt as unknown as string) })),
    keywords: envelope.assets.keywords.map((k) => withIdentity({ ...k, createdAt: new Date(k.createdAt as unknown as string) })),
    homonyms: envelope.assets.homonyms.map((h) => withIdentity({ ...h, createdAt: new Date(h.createdAt as unknown as string) })),
    dialogNodes: envelope.assets.dialogNodes.map((n) => withIdentity({ ...n, createdAt: new Date(n.createdAt as unknown as string) })),
    contexts: envelope.assets.contexts.map((c) => withIdentity({ ...c, createdAt: new Date(c.createdAt as unknown as string) })),
    faqs: envelope.assets.faqs.map((f) => withIdentity({ ...f, createdAt: new Date(f.createdAt as unknown as string) })),
  };

  const answerSetting: ChatbotAnswerSetting | null = envelope.answerSetting
    ? { ...envelope.answerSetting, chatbotId, createdAt: capturedAt, updatedAt: capturedAt }
    : null;

  return { bundle, answerSetting, profile: envelope.profile };
}
