import { getOutgoingNodeRefs } from '@chat-bot/dialogue-engine';
import type { DialogueBundle, TopicAssetKind, TopicRefEdge } from '@chat-bot/shared-types';

/**
 * 참조 열거 1벌(topic-system-설계.md §7.1) — 토픽 점검·영향 미리보기·목록 교차 참조 수·노드 목록
 * 배지·분리 폐포가 공유하는 유일한 참조 그래프 계산이다(NFR-TPM1). DB·Nest 무의존 순수 함수.
 */

export type AssetRefKind = TopicAssetKind | 'SURVEY' | 'HANDOFF_SETTING';

export interface AssetRef {
  edge: TopicRefEdge;
  fromKind: AssetRefKind;
  fromId: string;
  toKind: AssetRefKind;
  toId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * 임의 JSON 값 안의 모든 UUID 형식 문자열 잎을 결정적 순서(키 정렬)로 수집한다(중복 제거).
 * `asset-transfer/lib/id-leaf-rewrite.ts`가 재작성용으로, 이 파일이 참조 열거용으로 공유한다.
 */
export function collectUuidLeaves(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === 'object') {
      for (const key of Object.keys(v as Record<string, unknown>).sort()) visit((v as Record<string, unknown>)[key]);
      return;
    }
    if (isUuidLike(v) && !seen.has(v)) {
      seen.add(v);
      found.push(v);
    }
  };
  visit(value);
  return found;
}

/** 재작성(§9.5)·참조 열거(§7.1)가 공유하는 "잎이 참조인가" 판정 — 값이 자산 id 색인에 있어야 한다. */
export function assetIdIndex(bundle: DialogueBundle): Map<string, AssetRefKind> {
  const index = new Map<string, AssetRefKind>();
  for (const i of bundle.intents) index.set(i.id, 'INTENT');
  for (const k of bundle.keywords) index.set(k.id, 'KEYWORD');
  for (const h of bundle.homonyms) index.set(h.id, 'HOMONYM');
  for (const c of bundle.contexts) index.set(c.id, 'CONTEXT');
  for (const n of bundle.dialogNodes) index.set(n.id, 'NODE');
  for (const f of bundle.faqs) index.set(f.id, 'FAQ');
  for (const s of bundle.surveys ?? []) index.set(s.id, 'SURVEY');
  return index;
}

export function collectAssetRefs(bundle: DialogueBundle, extras?: { handoffEndButtonNodeId?: string | null }): AssetRef[] {
  const index = assetIdIndex(bundle);
  const refs: AssetRef[] = [];
  const push = (edge: TopicRefEdge, fromKind: AssetRefKind, fromId: string, toId: string): void => {
    const toKind = index.get(toId);
    if (!toKind) return; // 존재하지 않는 참조(BROKEN_REFERENCE)는 별도 검사 몫 — 여기서는 건너뛴다.
    refs.push({ edge, fromKind, fromId, toKind, toId });
  };

  for (const node of bundle.dialogNodes) {
    for (const intentId of node.intentIds) push('NODE_INTENT', 'NODE', node.id, intentId);
    for (const keywordId of node.keywordIds) push('NODE_KEYWORD', 'NODE', node.id, keywordId);
    if (node.contextVariableId) push('NODE_CONTEXT', 'NODE', node.id, node.contextVariableId);

    const { moveTargets, buttonTargets, apiTargets, surveyTargets } = getOutgoingNodeRefs(node);
    const labeledIds = new Set<string>([...moveTargets, ...buttonTargets, ...apiTargets, ...surveyTargets]);
    for (const id of moveTargets) push('NODE_MOVE', 'NODE', node.id, id);
    for (const id of buttonTargets) push('NODE_BUTTON', 'NODE', node.id, id);
    for (const id of apiTargets) push('NODE_API_BRANCH', 'NODE', node.id, id);
    for (const id of surveyTargets) push('NODE_SURVEY_COMPLETE', 'NODE', node.id, id);

    // 나머지 UUID 잎(CONTEXT_FORM·API v2 슬롯 바인딩의 contextVariableId(E-12)·SURVEY의 surveyId·
    // 그 밖의 자산 참조) — 위에서 이미 라벨이 붙은 노드 참조는 제외한다.
    for (const leaf of collectUuidLeaves(node.outputs)) {
      if (labeledIds.has(leaf)) continue;
      if (leaf === node.id) continue;
      const kind = index.get(leaf);
      if (!kind) continue; // connectionId(전역)·자유 텍스트 등 자산 id 색인 밖의 값은 참조로 보지 않는다.
      if (kind === 'CONTEXT') push('NODE_OUTPUT_CONTEXT', 'NODE', node.id, leaf);
      else if (kind === 'SURVEY') push('NODE_SURVEY', 'NODE', node.id, leaf);
      else push('NODE_OUTPUT_OTHER', 'NODE', node.id, leaf);
    }
  }

  for (const homonym of bundle.homonyms) {
    for (const meaning of homonym.meanings) {
      if (meaning.intentId) push('HOMONYM_INTENT', 'HOMONYM', homonym.id, meaning.intentId);
    }
  }

  for (const context of bundle.contexts) {
    for (const slot of context.slots) {
      if (slot.keywordId) push('CONTEXT_SLOT_KEYWORD', 'CONTEXT', context.id, slot.keywordId);
    }
  }

  if (extras?.handoffEndButtonNodeId) {
    push('HANDOFF_END_BUTTON', 'HANDOFF_SETTING', 'handoff', extras.handoffEndButtonNodeId);
  }

  return refs;
}
