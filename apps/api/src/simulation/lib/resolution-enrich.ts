import type { AssetCounts, DialogueBundle, DialogueResolution } from '@chat-bot/shared-types';

/** 서버가 판정 근거에 이름을 덧붙인다 — 프런트가 ID로 재조회하지 않게 한다(FR-10-8). */
export interface ResolutionNames {
  matchedNodeName?: string;
  matchedIntentName?: string;
  matchedFaqQuestion?: string;
}

export function enrichNames(bundle: DialogueBundle, resolution: Pick<DialogueResolution, 'matchedNodeId' | 'matchedIntentId' | 'matchedFaqId'>): ResolutionNames {
  return {
    matchedNodeName: resolution.matchedNodeId ? bundle.dialogNodes.find((n) => n.id === resolution.matchedNodeId)?.name : undefined,
    matchedIntentName: resolution.matchedIntentId ? bundle.intents.find((i) => i.id === resolution.matchedIntentId)?.name : undefined,
    matchedFaqQuestion: resolution.matchedFaqId ? bundle.faqs.find((f) => f.id === resolution.matchedFaqId)?.question : undefined,
  };
}

/** 활성 자산 건수(FR-10-8, FR-10-16 빈 상태 안내 판단용). */
export function computeAssetCounts(bundle: DialogueBundle): AssetCounts {
  return {
    dialogNodes: bundle.dialogNodes.filter((n) => n.enabled).length,
    intents: bundle.intents.length,
    keywords: bundle.keywords.length,
    homonyms: bundle.homonyms.length,
    contexts: bundle.contexts.length,
    faqs: bundle.faqs.filter((f) => f.enabled !== false).length,
  };
}
