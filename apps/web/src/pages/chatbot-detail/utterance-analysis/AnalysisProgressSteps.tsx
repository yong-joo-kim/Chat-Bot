import type { UtteranceAnalysisConditions, UtteranceAnalysisStage, UtteranceAnalysisStatus } from '@chat-bot/shared-types';
import { AsyncJobProgress } from '../../../components/AsyncJobProgress';
import { MESSAGES } from '../../../constants/messages';

type StepKey = 'PREPARE' | UtteranceAnalysisStage;

/** 단계 목록(§5.2) — 대조를 끈 분석은 5번, 이름 제안을 끈 분석은 6번 줄이 없다. */
export function stepsFor(conditions: Pick<UtteranceAnalysisConditions, 'nameSuggest'> & { probe: { enabled: boolean } }): StepKey[] {
  const steps: StepKey[] = ['PREPARE', 'EMBEDDING', 'CLUSTERING', 'KEYWORDS'];
  if (conditions.probe.enabled) steps.push('PROBING');
  if (conditions.nameSuggest) steps.push('NAMING');
  steps.push('SAVING');
  return steps;
}

/**
 * 처리 중 화면의 단계 목록 + 진행 막대(UA-3 §5.2). 각 줄은 글자("완료/진행 중/대기 중")로 상태를 밝히고 기호는 `aria-hidden`이다.
 * 막대는 `live={false}`(진행률 숫자가 바뀔 때마다 낭독하지 않는다) — 단계 전환 낭독은 호출부의 별도 `role="status"`가 맡는다.
 */
export function AnalysisProgressSteps({
  status,
  stage,
  progress,
  conditions,
}: {
  status: UtteranceAnalysisStatus;
  stage: UtteranceAnalysisStage | null;
  progress: number;
  conditions: Pick<UtteranceAnalysisConditions, 'nameSuggest'> & { probe: { enabled: boolean } };
}): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis;
  const steps = stepsFor(conditions);
  // QUEUED이면 1번(요청 처리에서 이미 끝난 단계)만 완료다.
  const activeIndex = Math.max(0, status === 'RUNNING' && stage ? steps.indexOf(stage) : 0);
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="ua-progress">
      <ol className="ua-steps" aria-label={msg.stepsLabel}>
        {steps.map((key, i) => {
          const state = i === 0 || i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'waiting';
          const symbol = state === 'done' ? '✔' : state === 'active' ? '●' : '○';
          const text = state === 'done' ? msg.stepDone : state === 'active' ? msg.stepActive : msg.stepWaiting;
          return (
            <li key={key} className={`ua-step ua-step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <span aria-hidden="true">{symbol}</span> {i + 1}. {msg.steps[key]} — {text}
            </li>
          );
        })}
      </ol>
      <div className="ua-overall-progress">
        <AsyncJobProgress label={msg.overallProgress} progress={pct} live={false} />
        <span className="ua-progress-percent">{pct}%</span>
      </div>
    </div>
  );
}
