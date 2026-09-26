import { isApiConditionV2, isSurveyV2 } from '@chat-bot/shared-types';
import type { SnapshotEnvelope } from './snapshot-envelope';

export interface ExternalRefs {
  apiConnectionIds: Set<string>;
  apiLegacyFormatCount: number;
  surveyIds: Set<string>;
  surveyLegacyFormatCount: number;
  /** [신규 No.41] `WORKFLOW`가 참조하는 발송 대상 id 집합(전역 자원 — §16). */
  workflowTargetIds: Set<string>;
}

/**
 * [신규 No.40] §6.1 발견 제약 ⑤ — 스냅샷의 노드 출력에서 v2 `API_CONDITION`·`SURVEY` 참조 id 집합과
 * v1(레거시 형식) 건수를 뽑는다. `restore-warnings.service.ts`(복원 경고)·`switch-warnings.ts`
 * (전환 미리보기 경고)가 동일 로직을 공유한다(동작 불변 추출 — DB·Nest 무의존 순수 함수).
 */
export function collectExternalRefs(envelope: SnapshotEnvelope): ExternalRefs {
  const apiConnectionIds = new Set<string>();
  let apiLegacyFormatCount = 0;
  const surveyIds = new Set<string>();
  let surveyLegacyFormatCount = 0;
  const workflowTargetIds = new Set<string>();

  for (const node of envelope.assets.dialogNodes) {
    for (const output of node.outputs) {
      if (output.type === 'API_CONDITION') {
        if (isApiConditionV2(output.payload)) apiConnectionIds.add(output.payload.connectionId);
        else apiLegacyFormatCount += 1;
      } else if (output.type === 'SURVEY') {
        if (isSurveyV2(output.payload)) surveyIds.add(output.payload.surveyId);
        else surveyLegacyFormatCount += 1;
      } else if (output.type === 'WORKFLOW') {
        workflowTargetIds.add(output.payload.targetId);
      }
    }
  }

  return { apiConnectionIds, apiLegacyFormatCount, surveyIds, surveyLegacyFormatCount, workflowTargetIds };
}
