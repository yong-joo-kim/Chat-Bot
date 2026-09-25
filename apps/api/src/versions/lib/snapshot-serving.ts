import { DialogueBundleSchema } from '@chat-bot/shared-types';
import type { DialogNode, DialogueBundle } from '@chat-bot/shared-types';
import { hydrateSnapshot } from './snapshot-hydrate';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * [신규 No.40 — 커밋 ①] C-1 서빙 역직렬화(§6.2) — 순수 함수. 봉투를 라이브 번들과 엔진 관점에서
 * 동치가 되도록 되살린다: ① 노드 `updatedAt` 복원(보조 필드) ② 6종 배열을 `createdAt asc, id asc`로
 * 재정렬(K-1 라이브 `build()` 순서 재현 — 발견 제약 ①). `hydrateSnapshot`(복원·무결성 검사 경로)은
 * 손대지 않는다.
 */
export interface ServingSnapshot {
  bundle: DialogueBundle;
  answerSetting: ReturnType<typeof hydrateSnapshot>['answerSetting'];
  profile: ReturnType<typeof hydrateSnapshot>['profile'];
  legacyTiebreak: boolean;
}

function byCreatedAtIdAsc<T extends { createdAt: Date; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = a.createdAt.getTime() - b.createdAt.getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 활성 노드 중 `(priority, 조건 수, matchMode)`가 같은 쌍이 있으면 true — 과거 스냅샷(보조 필드 없음)
 * 에서 실제로 승자가 달라질 수 있을 때만 `LEGACY_TIEBREAK`를 띄운다.
 */
export function hasPotentialNodeTies(nodes: readonly DialogNode[]): boolean {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node.enabled) continue;
    const conditionCount = node.intentIds.length + node.keywordIds.length + (node.contextVariableId ? 1 : 0);
    const key = `${node.priority}\u0000${conditionCount}\u0000${node.matchMode}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function hydrateForServing(envelope: SnapshotEnvelope, chatbotId: string): ServingSnapshot {
  const base = hydrateSnapshot(envelope, chatbotId);

  let legacyTiebreak: boolean;
  let dialogNodes = base.bundle.dialogNodes;
  if (envelope.tiebreak) {
    const map = envelope.tiebreak.nodeUpdatedAt;
    const capturedAt = new Date(envelope.capturedAt);
    dialogNodes = dialogNodes.map((node) => ({ ...node, updatedAt: map[node.id] ? new Date(map[node.id]) : capturedAt }));
    legacyTiebreak = false;
  } else {
    legacyTiebreak = hasPotentialNodeTies(dialogNodes);
  }

  // ★ 서빙에는 파싱 결과가 아니라 원본 값을 쓴다(zod 변환이 섞이면 라이브와 달라진다) — 검증만 별도로 한다.
  const bundle: DialogueBundle = {
    intents: byCreatedAtIdAsc(base.bundle.intents),
    keywords: byCreatedAtIdAsc(base.bundle.keywords),
    homonyms: byCreatedAtIdAsc(base.bundle.homonyms),
    dialogNodes: byCreatedAtIdAsc(dialogNodes),
    contexts: byCreatedAtIdAsc(base.bundle.contexts),
    faqs: byCreatedAtIdAsc(base.bundle.faqs),
    surveys: [],
  };

  const parsed = DialogueBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new Error(`hydrateForServing: 서빙 번들 검증 실패(chatbotId=${chatbotId})`);
  }

  return { bundle, answerSetting: base.answerSetting, profile: base.profile, legacyTiebreak };
}
