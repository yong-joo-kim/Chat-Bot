import { isSurveyV2 } from '@chat-bot/shared-types';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * [신규 No.40] §9.4 `CONTEXT_FLOWS_AFFECTED` — 현재 운영에 있고 대상에는 없는 컨텍스트·설문 참조를
 * 가진 노드 수를 센다(진행 중인 대화가 끊길 수 있는 흐름, EX-EN-8). DB·Nest 무의존 순수 함수.
 */
export function computeContextFlowsAffected(current: SnapshotEnvelope, target: SnapshotEnvelope): number {
  const targetContextIds = new Set(target.assets.contexts.map((c) => c.id));
  const targetSurveyIds = new Set<string>();
  for (const node of target.assets.dialogNodes) {
    for (const output of node.outputs) {
      if (output.type === 'SURVEY' && isSurveyV2(output.payload)) targetSurveyIds.add(output.payload.surveyId);
    }
  }

  let count = 0;
  for (const node of current.assets.dialogNodes) {
    if (node.contextVariableId && !targetContextIds.has(node.contextVariableId)) {
      count += 1;
      continue;
    }
    let affectedBySurvey = false;
    for (const output of node.outputs) {
      if (output.type === 'SURVEY' && isSurveyV2(output.payload) && !targetSurveyIds.has(output.payload.surveyId)) {
        affectedBySurvey = true;
        break;
      }
    }
    if (affectedBySurvey) count += 1;
  }
  return count;
}
