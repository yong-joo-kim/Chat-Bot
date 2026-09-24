import { useMemo, useState } from 'react';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import { buildSurveyQuestionOutputs, judgeSurveyAnswer, retryGuidance, type Survey, type SurveyQuestion } from '@chat-bot/shared-types';
import { OutputRenderer } from '../../../../components/OutputRenderer';
import { MESSAGES } from '../../../../constants/messages';
import { draftToQuestionInput, type SurveyQuestionDraft } from './types';

function draftsToPreviewSurvey(introMessage: string, questions: SurveyQuestionDraft[]): Survey {
  // 미리보기 전용 — `buildSurveyQuestionOutputs`가 실제로 읽는 필드(introMessage/questions)만 채운다.
  // id·chatbotId·structureVersion·createdAt·updatedAt은 렌더에 쓰이지 않는다(§2.2 `SurveyPreviewPanel`).
  return {
    id: '00000000-0000-0000-0000-000000000000',
    chatbotId: '00000000-0000-0000-0000-000000000000',
    name: '',
    status: 'DRAFT',
    completionMessage: '설문에 참여해 주셔서 감사합니다.',
    cancelKeywords: [],
    sessionTimeoutMinutes: 30,
    introMessage: introMessage || undefined,
    questions: questions.map((q) => draftToQuestionInput(q) as SurveyQuestion),
    structureVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * ui-spec §2.2 `SurveyPreviewPanel` — 위젯 모양(TEXT+BUTTON)을 `survey-logic.ts`의 순수 함수를
 * 브라우저에서 직접 호출해 렌더한다(서버 왕복 없음, `ApiConditionPreviewPanel`과 동일 전략).
 */
export function SurveyPreviewPanel({ introMessage, questions }: { introMessage: string; questions: SurveyQuestionDraft[] }): JSX.Element {
  const msg = MESSAGES.surveys;
  const [index, setIndex] = useState(0);
  const [sample, setSample] = useState('');
  const clampedIndex = Math.min(index, Math.max(0, questions.length - 1));
  const survey = useMemo(() => draftsToPreviewSurvey(introMessage, questions), [introMessage, questions]);

  if (questions.length === 0) {
    return (
      <div className="survey-preview-panel">
        <h3>{msg.previewTitle}</h3>
        <p className="field-hint">{msg.previewEmpty}</p>
      </div>
    );
  }

  const outputs = buildSurveyQuestionOutputs(survey, clampedIndex, { withIntro: clampedIndex === 0 });
  const question = survey.questions[clampedIndex];
  const judgeResult = sample.trim() ? judgeSurveyAnswer(question, sample) : undefined;
  const sampleDisplay =
    judgeResult && judgeResult.ok
      ? judgeResult.value.type === 'CHOICE'
        ? judgeResult.value.choiceKeys.join(', ')
        : judgeResult.value.type === 'SCALE'
          ? `${judgeResult.value.value}점`
          : judgeResult.value.text
      : undefined;

  function handleButtonClick(action: ButtonActionView): void {
    if (action.kind === 'MESSAGE' && action.text !== undefined) setSample(action.text);
  }

  return (
    <div className="survey-preview-panel">
      <div className="output-preview-header">
        <h3>{msg.previewTitle}</h3>
        <div className="output-preview-nav">
          <button type="button" className="btn btn-secondary" disabled={clampedIndex === 0} onClick={() => setIndex(clampedIndex - 1)} aria-label="이전 문항 미리보기">
            ◀
          </button>
          <span>{msg.previewQuestionNav(clampedIndex + 1, questions.length)}</span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={clampedIndex >= questions.length - 1}
            onClick={() => setIndex(clampedIndex + 1)}
            aria-label="다음 문항 미리보기"
          >
            ▶
          </button>
        </div>
      </div>
      <div className="widget-preview-frame">
        <OutputRenderer outputs={outputs} onButtonClick={handleButtonClick} />
      </div>
      <div className="form-field">
        <label htmlFor="survey-preview-sample">{msg.previewSampleLabel}</label>
        <div className="form-field--inline">
          <input id="survey-preview-sample" type="text" value={sample} onChange={(e) => setSample(e.target.value)} />
        </div>
        {sample.trim() && judgeResult && (
          <p className="field-hint" role="status">
            {judgeResult.ok ? msg.previewSampleResultOk(sampleDisplay ?? '') : msg.previewSampleResultFail(retryGuidance(question, judgeResult.code))}
          </p>
        )}
      </div>
    </div>
  );
}
