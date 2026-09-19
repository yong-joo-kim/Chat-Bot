import type { DialogNode, DialogueBundle, Keyword } from '@chat-bot/shared-types';
import { containsWord, normalizeText } from './normalize';

/** `resolveResponse` 파이프라인 내부에서 공유하는 턴 컨텍스트(§7.3). */
export interface EngineContext {
  raw: string;
  norm: string;
  tokens: string[];
  matchedIntentId?: string;
  /** 직전 턴에 COMPLETED된 컨텍스트 폼 ID(DD-13) — 노드의 컨텍스트 조건 판정 근거. */
  completedContextVariableId?: string;
}

export interface BrokenReference {
  kind: 'INTENT' | 'KEYWORD' | 'CONTEXT';
  id: string;
}

export interface NodeEvaluation {
  node: DialogNode;
  matched: boolean;
  brokenReferences: BrokenReference[];
}

/**
 * 노드 하나의 인풋 조건이 현재 턴 컨텍스트를 충족하는지 판정한다(FR-5-2, DD-13).
 * 끊어진 참조는 조건 목록에서 조용히 제외하고 `brokenReferences`로 보고한다(FR-E-9, AC-E-9).
 */
export function evaluateNode(node: DialogNode, ctx: EngineContext, bundle: DialogueBundle): NodeEvaluation {
  const brokenReferences: BrokenReference[] = [];

  const validIntentIds = node.intentIds.filter((id) => {
    const exists = bundle.intents.some((i) => i.id === id);
    if (!exists) brokenReferences.push({ kind: 'INTENT', id });
    return exists;
  });

  const validKeywords: Keyword[] = [];
  node.keywordIds.forEach((id) => {
    const keyword = bundle.keywords.find((k) => k.id === id);
    if (keyword) validKeywords.push(keyword);
    else brokenReferences.push({ kind: 'KEYWORD', id });
  });

  let contextConditionSpecified = false;
  let contextValid = false;
  if (node.contextVariableId) {
    contextConditionSpecified = true;
    const exists = bundle.contexts.some((c) => c.id === node.contextVariableId);
    if (!exists) {
      brokenReferences.push({ kind: 'CONTEXT', id: node.contextVariableId });
    } else {
      contextValid = true;
    }
  }

  const results: boolean[] = [];

  if (validIntentIds.length > 0) {
    results.push(!!ctx.matchedIntentId && validIntentIds.includes(ctx.matchedIntentId));
  }

  if (validKeywords.length > 0) {
    results.push(
      validKeywords.some((keyword) => {
        const terms = [keyword.name, ...keyword.synonyms].map(normalizeText);
        return terms.some((term) => containsWord(ctx.norm, term));
      }),
    );
  }

  if (contextConditionSpecified && contextValid) {
    results.push(node.contextVariableId === ctx.completedContextVariableId);
  }

  if (results.length === 0) {
    return { node, matched: false, brokenReferences };
  }

  const matched = node.matchMode === 'ALL' ? results.every(Boolean) : results.some(Boolean);
  return { node, matched, brokenReferences };
}

/**
 * 매칭된 노드 정렬(FR-5-8, EX-D-2). `priority desc → 조건 개수 desc → matchMode(ALL 우선)
 * → updatedAt desc → id asc`(마지막 `id asc`는 결정성 보장을 위한 보강, ADR-0008).
 */
export function rankNodes(nodes: DialogNode[]): DialogNode[] {
  return [...nodes].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;

    const condA = a.intentIds.length + a.keywordIds.length + (a.contextVariableId ? 1 : 0);
    const condB = b.intentIds.length + b.keywordIds.length + (b.contextVariableId ? 1 : 0);
    if (condA !== condB) return condB - condA;

    if (a.matchMode !== b.matchMode) return a.matchMode === 'ALL' ? -1 : 1;

    const updA = a.updatedAt.getTime();
    const updB = b.updatedAt.getTime();
    if (updA !== updB) return updB - updA;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
