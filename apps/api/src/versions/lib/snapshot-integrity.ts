import { getOutgoingNodeRefs } from '@chat-bot/dialogue-engine';
import {
  ChatbotAnswerSettingSchema,
  ChatbotSnapshotProfileSchema,
  DialogueBundleSchema,
  isApiConditionV2,
  normalizeText,
  VERSION_LIMITS,
  type VersionIntegrityWarning,
} from '@chat-bot/shared-types';
import type { HydratedSnapshot } from './snapshot-hydrate';
import { validateAnswerSettingShape } from '../../answer-settings/lib/validate-thresholds';

export type IntegrityMode = 'CAPTURE' | 'RESTORE';

export interface IntegrityCheckResult {
  violations: VersionIntegrityWarning[];
  violationsTotal: number;
  warnings: VersionIntegrityWarning[];
  warningsTotal: number;
}

function pushDuplicates<T extends { id: string }>(
  warnings: VersionIntegrityWarning[],
  items: readonly T[],
  keyOf: (item: T) => string,
  kind: VersionIntegrityWarning['kind'],
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    const key = keyOf(item);
    const owner = seen.get(key);
    if (owner) {
      warnings.push({ rule: 'DUPLICATE_NORMALIZED_NAME', kind, id: item.id, field: 'name', refId: owner });
    } else {
      seen.set(key, item.id);
    }
  }
}

/**
 * §5.5 — 캡처/복원 공용 스냅샷 내부 검사(DB·Nest 무의존 순수 함수). 캡처 모드는 FK·앱 레벨 참조를
 * **경고**로만 기록한다(저장을 막지 않는다). 복원 모드는 zod/도메인 상한·FK 참조·정규화 유일성·
 * 노드 유형 유일성·답변설정 교차 제약을 **위반(거부 대상)**으로 판정한다. 앱 레벨 참조와 교차 챗봇 ID
 * (DB 의존 — 호출자가 별도로 검사)는 복원에서도 경고만이다(§5.5 표).
 */
export function checkSnapshotIntegrity(hydrated: HydratedSnapshot, mode: IntegrityMode): IntegrityCheckResult {
  const violations: VersionIntegrityWarning[] = [];
  const warnings: VersionIntegrityWarning[] = [];
  const { bundle, answerSetting, profile } = hydrated;

  if (mode === 'RESTORE') {
    if (!DialogueBundleSchema.safeParse(bundle).success) {
      violations.push({ rule: 'SCHEMA_INVALID', kind: 'INTENT', id: '-', field: 'assets' });
    }
    if (answerSetting && !ChatbotAnswerSettingSchema.safeParse(answerSetting).success) {
      violations.push({ rule: 'SCHEMA_INVALID', kind: 'ANSWER_SETTING', id: '-' });
    }
    if (!ChatbotSnapshotProfileSchema.safeParse(profile).success) {
      violations.push({ rule: 'SCHEMA_INVALID', kind: 'PROFILE', id: '-' });
    }
  }

  const intentIds = new Set(bundle.intents.map((i) => i.id));
  const keywordIds = new Set(bundle.keywords.map((k) => k.id));
  const contextIds = new Set(bundle.contexts.map((c) => c.id));
  const nodeIds = new Set(bundle.dialogNodes.map((n) => n.id));

  // ② FK 대상 — 캡처는 경고, 복원은 위반(DB가 어차피 거부한다)
  const fkTarget = mode === 'RESTORE' ? violations : warnings;
  for (const node of bundle.dialogNodes) {
    for (const id of node.intentIds) {
      if (!intentIds.has(id)) fkTarget.push({ rule: 'BROKEN_REFERENCE_NODE_INTENT', kind: 'NODE', id: node.id, field: 'intentIds', refId: id });
    }
    for (const id of node.keywordIds) {
      if (!keywordIds.has(id)) fkTarget.push({ rule: 'BROKEN_REFERENCE_NODE_KEYWORD', kind: 'NODE', id: node.id, field: 'keywordIds', refId: id });
    }
    if (node.contextVariableId && !contextIds.has(node.contextVariableId)) {
      fkTarget.push({ rule: 'BROKEN_REFERENCE_NODE_CONTEXT', kind: 'NODE', id: node.id, field: 'contextVariableId', refId: node.contextVariableId });
    }
  }

  // ② 앱 레벨 참조 — 캡처/복원 모두 경고만(EX-H-5: 캡처 당시 상태의 재현이 복원의 정의)
  for (const node of bundle.dialogNodes) {
    const refs = getOutgoingNodeRefs(node);
    for (const targetId of refs.moveTargets) {
      if (!nodeIds.has(targetId)) warnings.push({ rule: 'BROKEN_REFERENCE_NODE_MOVE', kind: 'NODE', id: node.id, field: 'outputs', refId: targetId });
    }
    for (const targetId of refs.buttonTargets) {
      if (!nodeIds.has(targetId)) warnings.push({ rule: 'BROKEN_REFERENCE_NODE_BUTTON', kind: 'NODE', id: node.id, field: 'outputs', refId: targetId });
    }
    // [No.26] API 조건분기 분기 대상(J-17) — 캡처/복원 모두 경고만(EX-H-5).
    for (const targetId of refs.apiTargets) {
      if (!nodeIds.has(targetId)) warnings.push({ rule: 'BROKEN_REFERENCE_NODE_API', kind: 'NODE', id: node.id, field: 'outputs', refId: targetId });
    }
    for (const output of node.outputs) {
      if (output.type === 'CONTEXT_FORM' && !contextIds.has(output.payload.contextVariableId)) {
        warnings.push({
          rule: 'BROKEN_REFERENCE_CONTEXT_FORM',
          kind: 'NODE',
          id: node.id,
          field: 'outputs',
          refId: output.payload.contextVariableId,
        });
      }
      // [No.26] v1 API_CONDITION 잔존(FR-L8-3) — 캡처 모드에서 이후 목록·상세가 "이전 형식 포함"을
      // 알 수 있게 경고로 남긴다(본문 참조 봉인 V-7 때문에 목록은 이 값을 저장해 둬야만 읽을 수 있다).
      if (output.type === 'API_CONDITION' && !isApiConditionV2(output.payload)) {
        warnings.push({ rule: 'API_LEGACY_FORMAT', kind: 'NODE', id: node.id, field: 'outputs' });
      }
    }
  }
  for (const homonym of bundle.homonyms) {
    homonym.meanings.forEach((m, idx) => {
      if (m.intentId && !intentIds.has(m.intentId)) {
        warnings.push({ rule: 'BROKEN_REFERENCE_HOMONYM_INTENT', kind: 'HOMONYM', id: homonym.id, field: `meanings[${idx}].intentId`, refId: m.intentId });
      }
    });
  }
  for (const context of bundle.contexts) {
    context.slots.forEach((s, idx) => {
      if (s.keywordId && !keywordIds.has(s.keywordId)) {
        warnings.push({ rule: 'BROKEN_REFERENCE_SLOT_KEYWORD', kind: 'CONTEXT', id: context.id, field: `slots[${idx}].keywordId`, refId: s.keywordId });
      }
    });
  }

  if (mode === 'RESTORE') {
    // ③ 정규화 이름 유일성(ADR-0006)
    pushDuplicates(violations, bundle.intents, (i) => normalizeText(i.name), 'INTENT');
    pushDuplicates(violations, bundle.keywords, (k) => normalizeText(k.name), 'KEYWORD');
    pushDuplicates(violations, bundle.dialogNodes, (n) => normalizeText(n.name), 'NODE');
    pushDuplicates(violations, bundle.contexts, (c) => normalizeText(c.name), 'CONTEXT');
    pushDuplicates(violations, bundle.homonyms, (h) => normalizeText(h.word), 'HOMONYM');
    pushDuplicates(violations, bundle.faqs, (f) => normalizeText(f.question), 'FAQ');

    // ④ 노드 유형 유일성(FR-5-4)
    const startCount = bundle.dialogNodes.filter((n) => n.nodeType === 'START').length;
    const fallbackCount = bundle.dialogNodes.filter((n) => n.nodeType === 'FALLBACK').length;
    if (startCount > 1) violations.push({ rule: 'DUPLICATE_NODE_TYPE_START', kind: 'NODE', id: '-' });
    if (fallbackCount > 1) violations.push({ rule: 'DUPLICATE_NODE_TYPE_FALLBACK', kind: 'NODE', id: '-' });

    // ⑥ 답변설정 교차 제약(answer-settings/lib/validate-thresholds.ts 재사용)
    if (answerSetting) {
      const failure = validateAnswerSettingShape(answerSetting);
      if (failure) violations.push({ rule: `ANSWER_SETTING_${failure.kind}`, kind: 'ANSWER_SETTING', id: '-', field: failure.field });
    }
  }

  return {
    violations: violations.slice(0, VERSION_LIMITS.integrityWarningStoreMax),
    violationsTotal: violations.length,
    warnings: warnings.slice(0, VERSION_LIMITS.integrityWarningStoreMax),
    warningsTotal: warnings.length,
  };
}
