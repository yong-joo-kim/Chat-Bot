import type { ConditionSummary, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';

/** 목록 화면의 조건 요약 칩(FR-5-11) — 끊어진 참조 ID는 조용히 제외한다. */
export function buildConditionSummary(
  node: { intentIds: string[]; keywordIds: string[]; contextVariableId?: string },
  intentNames: Map<string, string>,
  keywordNames: Map<string, string>,
  contextNames: Map<string, string>,
): ConditionSummary {
  return {
    intents: node.intentIds.filter((id) => intentNames.has(id)).map((id) => ({ id, name: intentNames.get(id)! })),
    keywords: node.keywordIds.filter((id) => keywordNames.has(id)).map((id) => ({ id, name: keywordNames.get(id)! })),
    context:
      node.contextVariableId && contextNames.has(node.contextVariableId)
        ? { id: node.contextVariableId, name: contextNames.get(node.contextVariableId)! }
        : undefined,
  };
}

/** 아웃풋 타입 요약(중복 제거, 순서 보존, FR-5-11). */
export function extractOutputTypes(outputs: DialogOutput[]): DialogOutputType[] {
  return [...new Set(outputs.map((o) => o.type))];
}
