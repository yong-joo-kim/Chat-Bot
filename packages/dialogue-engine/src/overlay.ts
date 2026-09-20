import type { ContextVariable, DialogNode, DialogueBundle, FaqEntry, HomonymDictionary, Intent, Keyword } from '@chat-bot/shared-types';

/**
 * 저장 전 미리보기 오버레이 병합(FR-10-18~24, DD-28). DB·zod 무의존 순수 함수 — apps/api가
 * 오버레이 DTO(Create*Schema + id)를 이 패치 형태(번들과 동일한 완전한 엔터티 배열)로 변환한 뒤 호출한다.
 * zod 검증은 apps/api 책임이다(저장 API와 동일 스키마를 써야 하므로, §7.5).
 */
export interface OverlayDeletedIds {
  dialogNodes?: string[];
  intents?: string[];
  keywords?: string[];
  homonyms?: string[];
  contexts?: string[];
  faqs?: string[];
}

export interface BundleOverlayPatch {
  dialogNodes?: DialogNode[];
  intents?: Intent[];
  keywords?: Keyword[];
  homonyms?: HomonymDictionary[];
  contexts?: ContextVariable[];
  faqs?: FaqEntry[];
  deletedIds?: OverlayDeletedIds;
}

function mergeKind<T extends { id: string }>(base: T[], overlayItems: T[] | undefined, deletedIds: string[] | undefined): T[] {
  const deleted = new Set(deletedIds ?? []);
  const kept = base.filter((item) => !deleted.has(item.id));
  if (!overlayItems || overlayItems.length === 0) return kept;
  const byId = new Map(kept.map((item) => [item.id, item] as const));
  for (const item of overlayItems) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

/**
 * 저장본 번들에 오버레이를 `id` 기준 upsert로 병합한다(FR-10-19). 종류별로 동일 규칙을 적용한다:
 * ① `deletedIds`에 포함된 id를 먼저 제거 ② 남은 배열에 오버레이 항목의 id가 있으면 교체, 없으면 추가
 * (`draft-` 접두 임시 id 포함) ③ 원본 `bundle`을 변형하지 않는다(새 배열 반환).
 * 존재하지 않는 id의 `deletedIds`는 오류가 아니라 무시한다(EX-10-8).
 */
export function mergeOverlay(bundle: DialogueBundle, overlay: BundleOverlayPatch): DialogueBundle {
  return {
    intents: mergeKind(bundle.intents, overlay.intents, overlay.deletedIds?.intents),
    keywords: mergeKind(bundle.keywords, overlay.keywords, overlay.deletedIds?.keywords),
    homonyms: mergeKind(bundle.homonyms, overlay.homonyms, overlay.deletedIds?.homonyms),
    dialogNodes: mergeKind(bundle.dialogNodes, overlay.dialogNodes, overlay.deletedIds?.dialogNodes),
    contexts: mergeKind(bundle.contexts, overlay.contexts, overlay.deletedIds?.contexts),
    faqs: mergeKind(bundle.faqs, overlay.faqs, overlay.deletedIds?.faqs),
  };
}
