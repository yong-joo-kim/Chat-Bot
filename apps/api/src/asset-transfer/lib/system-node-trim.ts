import type { ButtonItem, DialogNode, DialogOutput } from '@chat-bot/shared-types';
import { isApiConditionV2, isSurveyV2 } from '@chat-bot/shared-types';

/**
 * 시작·폴백 노드의 연결 처리(topic-system-설계.md §9.3) — TRIM(기본)/FOLLOW. DB·Nest 무의존 순수 함수.
 * `keepNodeIds`에 없는 노드를 가리키는 `DIALOG_MOVE`·버튼(`BUTTON`/`CARD`의 `NODE` 액션)을 잘라낸다.
 * `API_CONDITION`·`SURVEY`(v2 `onCompleteNodeId`) 대상은 **잘라내지 않고 따라간다**(분기 의미 보존).
 */

export interface TrimmedLinkReport {
  edge: 'NODE_MOVE' | 'NODE_BUTTON';
  targetNodeId: string;
  reason?: 'TRIM_WOULD_EMPTY';
}

export interface FollowedLinkReport {
  edge: 'NODE_MOVE' | 'NODE_BUTTON' | 'NODE_API_BRANCH' | 'NODE_SURVEY_COMPLETE';
  targetNodeId: string;
  /** [신규 — M-2 코드리뷰 대응] "빈 결과" 보정으로 트림 대신 따라가게 된 항목만 채워진다. */
  reason?: 'TRIM_WOULD_EMPTY';
}

export interface TrimResult {
  outputs: DialogOutput[];
  trimmedLinks: TrimmedLinkReport[];
  followedLinks: FollowedLinkReport[];
}

function buttonsAfterTrim(buttons: ButtonItem[], keepNodeIds: ReadonlySet<string>): { kept: ButtonItem[]; trimmedTargets: string[] } {
  const kept: ButtonItem[] = [];
  const trimmedTargets: string[] = [];
  for (const b of buttons) {
    if (b.action === 'NODE' && !keepNodeIds.has(b.value)) trimmedTargets.push(b.value);
    else kept.push(b);
  }
  return { kept, trimmedTargets };
}

export function trimSystemNodeOutputs(node: DialogNode, keepNodeIds: ReadonlySet<string>): TrimResult {
  const trimmedLinks: TrimmedLinkReport[] = [];
  const followedLinks: FollowedLinkReport[] = [];
  const outputs: DialogOutput[] = [];

  for (const output of node.outputs) {
    if (output.type === 'DIALOG_MOVE') {
      if (keepNodeIds.has(output.payload.targetNodeId)) {
        outputs.push(output);
      } else {
        trimmedLinks.push({ edge: 'NODE_MOVE', targetNodeId: output.payload.targetNodeId });
      }
      continue;
    }
    if (output.type === 'BUTTON') {
      const { kept, trimmedTargets } = buttonsAfterTrim(output.payload.buttons, keepNodeIds);
      trimmedTargets.forEach((t) => trimmedLinks.push({ edge: 'NODE_BUTTON', targetNodeId: t }));
      if (kept.length === output.payload.buttons.length) {
        outputs.push(output);
      } else if (kept.length > 0) {
        outputs.push({ type: 'BUTTON', payload: { ...output.payload, buttons: kept } });
      } else if (output.payload.text) {
        outputs.push({ type: 'TEXT', payload: { text: output.payload.text } });
      }
      // 버튼 0개 · text 없음 → 이 아웃풋은 제거된다(아래 "빈 결과" 보정 대상이 될 수 있다).
      continue;
    }
    if (output.type === 'CARD' && output.payload.buttons) {
      const { kept, trimmedTargets } = buttonsAfterTrim(output.payload.buttons, keepNodeIds);
      trimmedTargets.forEach((t) => trimmedLinks.push({ edge: 'NODE_BUTTON', targetNodeId: t }));
      outputs.push({ type: 'CARD', payload: { ...output.payload, buttons: kept.length > 0 ? kept : undefined } });
      continue;
    }
    if (output.type === 'API_CONDITION') {
      // 조건분기 대상은 잘라내지 않는다 — 따라간다(분기 의미 보존).
      const targets = output.payload.conditions.map((c) => c.nextNodeId);
      if (isApiConditionV2(output.payload)) {
        if (output.payload.defaultNodeId) targets.push(output.payload.defaultNodeId);
        if (output.payload.failureNodeId) targets.push(output.payload.failureNodeId);
      }
      for (const t of targets) if (!keepNodeIds.has(t)) followedLinks.push({ edge: 'NODE_API_BRANCH', targetNodeId: t });
      outputs.push(output);
      continue;
    }
    if (output.type === 'SURVEY' && isSurveyV2(output.payload) && output.payload.onCompleteNodeId) {
      if (!keepNodeIds.has(output.payload.onCompleteNodeId)) {
        followedLinks.push({ edge: 'NODE_SURVEY_COMPLETE', targetNodeId: output.payload.onCompleteNodeId });
      }
      outputs.push(output);
      continue;
    }
    outputs.push(output);
  }

  // 잘라낸 결과 아웃풋이 0개가 되면 자르지 않고 FOLLOW로 처리한다(TRIM_WOULD_EMPTY).
  // [신규 — M-2 코드리뷰 대응] 간선 라벨을 실제 출처(DIALOG_MOVE→NODE_MOVE·BUTTON→NODE_BUTTON)로
  // 정확히 남기고, 이 보정으로 되돌려졌음을 reason으로 구분한다(하드코딩된 NODE_API_BRANCH 오분류 수정).
  if (outputs.length === 0 && node.outputs.length > 0) {
    const revertedFollowed: FollowedLinkReport[] = [];
    for (const output of node.outputs) {
      if (output.type === 'DIALOG_MOVE') revertedFollowed.push({ edge: 'NODE_MOVE', targetNodeId: output.payload.targetNodeId, reason: 'TRIM_WOULD_EMPTY' });
      if (output.type === 'BUTTON') {
        for (const b of output.payload.buttons) {
          if (b.action === 'NODE') revertedFollowed.push({ edge: 'NODE_BUTTON', targetNodeId: b.value, reason: 'TRIM_WOULD_EMPTY' });
        }
      }
    }
    return { outputs: node.outputs, trimmedLinks: [], followedLinks: revertedFollowed };
  }

  return { outputs, trimmedLinks, followedLinks };
}
