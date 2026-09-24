import type { SurveyQuestionInput, SurveyScaleKind } from '@chat-bot/shared-types';

/**
 * 설문 편집기(SV2)의 로컬 폼 상태. **`key`(서버 UUID)는 화면에 노출하지 않되 항상 보존**한다
 * (`survey-management-ui-spec.md` §3.2 "PATCH 시 기존 문항·선택지 key 보존 UX"). `localKey`는
 * React 렌더/`ReorderableList` 식별용이며 저장 payload에는 포함하지 않는다.
 */
export interface SurveyChoiceDraft {
  key?: string;
  localKey: string;
  label: string;
}

interface SurveyQuestionDraftCommon {
  key?: string;
  localKey: string;
  prompt: string;
  required: boolean;
}

export type SurveyQuestionDraft =
  | (SurveyQuestionDraftCommon & { type: 'SINGLE_CHOICE'; choices: SurveyChoiceDraft[] })
  | (SurveyQuestionDraftCommon & { type: 'MULTI_CHOICE'; choices: SurveyChoiceDraft[]; minSelect: number; maxSelect: number })
  | (SurveyQuestionDraftCommon & { type: 'SCALE'; scale: SurveyScaleKind; lowLabel: string; highLabel: string })
  | (SurveyQuestionDraftCommon & { type: 'TEXT'; maxLength: number });

let seq = 0;
function nextLocalKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function newChoiceDraft(): SurveyChoiceDraft {
  return { localKey: nextLocalKey('choice'), label: '' };
}

export function newQuestionDraft(type: SurveyQuestionDraft['type'] = 'SINGLE_CHOICE'): SurveyQuestionDraft {
  const common = { localKey: nextLocalKey('question'), prompt: '', required: true };
  switch (type) {
    case 'SINGLE_CHOICE':
      return { ...common, type, choices: [newChoiceDraft(), newChoiceDraft()] };
    case 'MULTI_CHOICE':
      return { ...common, type, choices: [newChoiceDraft(), newChoiceDraft()], minSelect: 1, maxSelect: 2 };
    case 'SCALE':
      return { ...common, type, scale: 'STAR_5', lowLabel: '', highLabel: '' };
    case 'TEXT':
      return { ...common, type, maxLength: 300 };
  }
}

/** 서버에서 불러온 문항을 로컬 초안으로 변환한다 — `key`를 보존한다. */
export function questionToDraft(q: SurveyQuestionInput & { key?: string }): SurveyQuestionDraft {
  const common = { key: q.key, localKey: nextLocalKey('question'), prompt: q.prompt, required: q.required ?? true };
  if (q.type === 'SINGLE_CHOICE') {
    return { ...common, type: 'SINGLE_CHOICE', choices: q.choices.map((c) => ({ key: c.key, localKey: nextLocalKey('choice'), label: c.label })) };
  }
  if (q.type === 'MULTI_CHOICE') {
    return {
      ...common,
      type: 'MULTI_CHOICE',
      choices: q.choices.map((c) => ({ key: c.key, localKey: nextLocalKey('choice'), label: c.label })),
      minSelect: q.minSelect,
      maxSelect: q.maxSelect,
    };
  }
  if (q.type === 'SCALE') {
    return { ...common, type: 'SCALE', scale: q.scale, lowLabel: q.lowLabel ?? '', highLabel: q.highLabel ?? '' };
  }
  return { ...common, type: 'TEXT', maxLength: q.maxLength ?? 300 };
}

/** 저장 payload로 변환한다 — `localKey`는 제거하고 `key`는 있으면 그대로, 없으면 생략(서버 발급). */
export function draftToQuestionInput(q: SurveyQuestionDraft): SurveyQuestionInput {
  const base = { key: q.key, prompt: q.prompt, required: q.required };
  if (q.type === 'SINGLE_CHOICE') {
    return { ...base, type: 'SINGLE_CHOICE', choices: q.choices.map((c) => ({ key: c.key, label: c.label })) };
  }
  if (q.type === 'MULTI_CHOICE') {
    return {
      ...base,
      type: 'MULTI_CHOICE',
      choices: q.choices.map((c) => ({ key: c.key, label: c.label })),
      minSelect: q.minSelect,
      maxSelect: q.maxSelect,
    };
  }
  if (q.type === 'SCALE') {
    return { ...base, type: 'SCALE', scale: q.scale, lowLabel: q.lowLabel || undefined, highLabel: q.highLabel || undefined };
  }
  return { ...base, type: 'TEXT', maxLength: q.maxLength };
}
