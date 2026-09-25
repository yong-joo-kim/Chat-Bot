import type { DialogOutput } from '@chat-bot/shared-types';
import { isApiConditionV2, isSurveyV2 } from '@chat-bot/shared-types';

/**
 * [신규 No.22 — K-2] 저장 검증(`dialog-nodes.service.ts`)의 노드→노드 참조 수집을 **동작 변경 없이**
 * 추출한 것이다(topic-system-설계.md §13). 위치(zod 경로, `field`)를 함께 돌려주므로 저장 검증의
 * "어느 아웃풋의 어느 필드인지" 상세 보고 요구(No.26 M2-2)를 그대로 만족한다.
 * `getOutgoingNodeRefs()`(엔진)와 **동등성 시험**으로 id 집합이 일치함을 고정한다(세 번째 목록 금지).
 */
export function collectNodeTargetRefs(outputs: readonly DialogOutput[]): Array<{ id: string; field: string }> {
  const refs: Array<{ id: string; field: string }> = [];
  outputs.forEach((o, i) => {
    if (o.type === 'DIALOG_MOVE') refs.push({ id: o.payload.targetNodeId, field: `outputs.${i}.payload.targetNodeId` });
    if (o.type === 'BUTTON') {
      o.payload.buttons.forEach((b, k) => {
        if (b.action === 'NODE') refs.push({ id: b.value, field: `outputs.${i}.payload.buttons.${k}.value` });
      });
    }
    if (o.type === 'CARD' && o.payload.buttons) {
      o.payload.buttons.forEach((b, k) => {
        if (b.action === 'NODE') refs.push({ id: b.value, field: `outputs.${i}.payload.buttons.${k}.value` });
      });
    }
    if (o.type === 'API_CONDITION') {
      o.payload.conditions.forEach((c, j) => {
        refs.push({ id: c.nextNodeId, field: `outputs.${i}.payload.conditions.${j}.nextNodeId` });
      });
      if (isApiConditionV2(o.payload)) {
        if (o.payload.defaultNodeId) refs.push({ id: o.payload.defaultNodeId, field: `outputs.${i}.payload.defaultNodeId` });
        if (o.payload.failureNodeId) refs.push({ id: o.payload.failureNodeId, field: `outputs.${i}.payload.failureNodeId` });
      }
    }
    if (o.type === 'SURVEY' && isSurveyV2(o.payload) && o.payload.onCompleteNodeId) {
      refs.push({ id: o.payload.onCompleteNodeId, field: `outputs.${i}.payload.onCompleteNodeId` });
    }
  });
  return refs;
}
