import type { DialogueBundle, WorkflowOutputPayloadV1 } from '@chat-bot/shared-types';
import type { CompletedFormInfo } from './api-call';
import { resolveBinding } from './api-call';

/**
 * [No.41] 업무 자동화 워크플로우 — 엔진 닫힌 목록 E-2. 순수 함수만(엔진 I/O 0 · L-5 유지).
 * `docs/02-spec/workflow-automation-설계.md` §5.2~§5.3 근거.
 */

export interface WorkflowEmission {
  readonly nodeId: string;
  readonly outputIndex: number;
  readonly targetId: string;
  readonly actionKey: string;
  /** 바인딩 성공 시에만 값이 있다. ★ SLOT 값은 원본(마스킹 전) — API 계층이 마스킹한다(엔진은 PII를 모른다). */
  readonly fields: ReadonlyArray<{ name: string; value: string; source: 'CONST' | 'SLOT' }>;
  /** SLOT 하나라도 불충족이면 true + fields = [](부분 값을 싣지 않는다 — 빈 티켓 방지). 없으면 키 부재. */
  readonly bindingMissing?: true;
}

/** [No.41] "업무 요청 보내기" 바인딩 해석 — No.26 `resolveBinding` 1벌 재사용. */
export function bindWorkflowOutput(
  p: WorkflowOutputPayloadV1,
  nodeId: string,
  outputIndex: number,
  completedForm?: CompletedFormInfo,
): WorkflowEmission {
  const fields: Array<{ name: string; value: string; source: 'CONST' | 'SLOT' }> = [];
  for (const f of p.fields) {
    const bound = resolveBinding(f.value, completedForm);
    if (!bound) {
      return { nodeId, outputIndex, targetId: p.targetId, actionKey: p.actionKey, fields: [], bindingMissing: true };
    }
    fields.push({ name: f.name, value: bound.value, source: bound.source });
  }
  return { nodeId, outputIndex, targetId: p.targetId, actionKey: p.actionKey, fields };
}

/** 번들 안에 `WORKFLOW` 아웃풋이 하나라도 있는가(재진입 이월 조건 §5.6). */
export function hasWorkflowOutputs(bundle: DialogueBundle): boolean {
  return bundle.dialogNodes.some((n) => n.outputs.some((o) => o.type === 'WORKFLOW'));
}
