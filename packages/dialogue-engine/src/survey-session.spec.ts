import { advanceSurveySession, startSurveySession, willSurveyConsumeInput } from './survey-session';
import { makeBundle, makeSurvey } from './test-fixtures';
import type { SurveySessionState } from '@chat-bot/shared-types';

const NOW = new Date('2026-09-24T10:00:00Z');

function sessionAfterStart(survey: ReturnType<typeof makeSurvey>): SurveySessionState {
  return startSurveySession(survey, null, 0, NOW).session;
}

describe('startSurveySession', () => {
  it('설문 시작 시 EXPOSED 이벤트 + 첫 문항 출력을 낸다', () => {
    const survey = makeSurvey();
    const { session, outputs, event } = startSurveySession(survey, null, 0, NOW);
    expect(session.surveyId).toBe(survey.id);
    expect(session.questionIndex).toBe(0);
    expect(session.retryCount).toBe(0);
    expect(session.startedAt).toEqual(NOW);
    expect(event).toEqual({ kind: 'EXPOSED', attempt: { surveyId: survey.id, structureVersion: 1, startedAt: NOW }, nodeId: null });
    expect(outputs.length).toBeGreaterThan(0);
  });
});

describe('advanceSurveySession — 취소', () => {
  it('취소어 전체 일치 시 ABANDONED(CANCELLED)로 종료한다', () => {
    const survey = makeSurvey();
    const session = sessionAfterStart(survey);
    const result = advanceSurveySession(session, { raw: '그만', norm: '그만' }, survey, NOW, false);
    expect(result.kind).toBe('CONSUMED');
    if (result.kind === 'CONSUMED') {
      expect(result.nextSession).toBeNull();
      expect(result.events).toEqual([{ kind: 'ABANDONED', attempt: expect.objectContaining({ surveyId: survey.id }), reason: 'CANCELLED' }]);
    }
  });

  it('취소어가 포함돼도 전체 일치가 아니면 취소로 판정하지 않는다(§22 D-3)', () => {
    const survey = makeSurvey({ questions: [{ key: 'q1', type: 'TEXT', prompt: '의견을 남겨주세요.', required: false, maxLength: 300 }] as never });
    const session = sessionAfterStart(survey);
    const raw = '이제 그만 좀 늦었으면 좋겠어요';
    const result = advanceSurveySession(session, { raw, norm: raw }, survey, NOW, false);
    // 취소가 아니므로 텍스트 응답으로 판정돼 완료(마지막 문항)로 이어진다 — ABANDONED가 아니다.
    expect(result.kind).toBe('CONSUMED');
    if (result.kind === 'CONSUMED') {
      expect(result.events.some((e) => e.kind === 'ABANDONED')).toBe(false);
    }
  });
});

describe('advanceSurveySession — 계속 불가·타임아웃', () => {
  it('설문이 CLOSED 상태면 RELEASED로 종료하고 일반 경로로 넘긴다', () => {
    const survey = makeSurvey({ status: 'OPEN' });
    const session = sessionAfterStart(survey);
    const closedSurvey = { ...survey, status: 'CLOSED' as const };
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, closedSurvey, NOW, false);
    expect(result.kind).toBe('RELEASED');
    if (result.kind === 'RELEASED') {
      expect(result.events).toEqual([{ kind: 'ABANDONED', attempt: expect.objectContaining({ surveyId: survey.id }), reason: 'CLOSED' }]);
    }
  });

  it('구조 버전이 바뀌면 DEFINITION_CHANGED로 RELEASED된다', () => {
    const survey = makeSurvey();
    const session = sessionAfterStart(survey);
    const changedSurvey = { ...survey, structureVersion: 2 };
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, changedSurvey, NOW, false);
    expect(result.kind).toBe('RELEASED');
    if (result.kind === 'RELEASED') {
      expect(result.events[0]).toMatchObject({ kind: 'ABANDONED', reason: 'DEFINITION_CHANGED' });
    }
  });

  it('타임아웃(31분 경과)이면 RELEASED된다', () => {
    const survey = makeSurvey({ sessionTimeoutMinutes: 30 });
    const session = sessionAfterStart(survey);
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, survey, later, false);
    expect(result.kind).toBe('RELEASED');
    if (result.kind === 'RELEASED') {
      expect(result.events[0]).toMatchObject({ kind: 'ABANDONED', reason: 'TIMEOUT' });
    }
  });

  it('29분 경과는 타임아웃이 아니다(경계값)', () => {
    const survey = makeSurvey({ sessionTimeoutMinutes: 30 });
    const session = sessionAfterStart(survey);
    const later = new Date(NOW.getTime() + 29 * 60_000);
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, survey, later, false);
    expect(result.kind).toBe('CONSUMED');
  });

  it('preview=true면 CLOSED 상태도 계속 진행한다', () => {
    const survey = makeSurvey({ status: 'CLOSED' });
    const session = sessionAfterStart(survey);
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, survey, NOW, true);
    expect(result.kind).toBe('CONSUMED');
  });
});

describe('advanceSurveySession — 판정·재시도·완료', () => {
  it('척도 문항에 유효한 값을 답하면 ANSWERED 후 완료(마지막 문항)로 이어진다', () => {
    const survey = makeSurvey();
    const session = sessionAfterStart(survey);
    const result = advanceSurveySession(session, { raw: '5점', norm: '5점' }, survey, NOW, false);
    expect(result.kind).toBe('CONSUMED');
    if (result.kind === 'CONSUMED') {
      expect(result.completed).toBe(true);
      expect(result.nextSession).toBeNull();
      expect(result.events.map((e) => e.kind)).toEqual(['ANSWERED', 'COMPLETED']);
    }
  });

  it('잘못된 값은 재시도 안내를 하고 세션을 유지한다(같은 문항 재출력)', () => {
    const survey = makeSurvey();
    const session = sessionAfterStart(survey);
    const result = advanceSurveySession(session, { raw: '모르겠어요', norm: '모르겠어요' }, survey, NOW, false);
    expect(result.kind).toBe('CONSUMED');
    if (result.kind === 'CONSUMED') {
      expect(result.nextSession?.retryCount).toBe(1);
      expect(result.events).toEqual([]);
    }
  });

  it('재시도 상한(2회) 초과 시 ABANDONED(RETRY_EXCEEDED)로 종료한다', () => {
    const survey = makeSurvey();
    let session = sessionAfterStart(survey);
    for (let i = 0; i < 2; i++) {
      const r = advanceSurveySession(session, { raw: '모름', norm: '모름' }, survey, NOW, false);
      if (r.kind === 'CONSUMED' && r.nextSession) session = r.nextSession;
    }
    const finalResult = advanceSurveySession(session, { raw: '모름', norm: '모름' }, survey, NOW, false);
    expect(finalResult.kind).toBe('CONSUMED');
    if (finalResult.kind === 'CONSUMED') {
      expect(finalResult.nextSession).toBeNull();
      expect(finalResult.events).toEqual([{ kind: 'ABANDONED', attempt: expect.anything(), reason: 'RETRY_EXCEEDED' }]);
    }
  });

  it('선택 문항 건너뛰기는 SKIPPED 후 다음 문항으로 진행한다', () => {
    const survey = makeSurvey({
      questions: [
        { key: 'q1', type: 'SCALE', prompt: '만족도', required: false, scale: 'STAR_5' },
        { key: 'q2', type: 'SCALE', prompt: '재구매 의향', required: true, scale: 'STAR_5' },
      ] as never,
    });
    const session = sessionAfterStart(survey);
    const result = advanceSurveySession(session, { raw: '건너뛰기', norm: '건너뛰기' }, survey, NOW, false);
    expect(result.kind).toBe('CONSUMED');
    if (result.kind === 'CONSUMED') {
      expect(result.events).toEqual([{ kind: 'SKIPPED', attempt: expect.anything(), questionKey: 'q1', questionIndex: 0 }]);
      expect(result.nextSession?.questionIndex).toBe(1);
    }
  });
});

describe('willSurveyConsumeInput', () => {
  it('설문 세션이 없으면 false다', () => {
    const bundle = makeBundle();
    expect(willSurveyConsumeInput(undefined, bundle, NOW)).toBe(false);
  });

  it('진행 중(live) 설문 세션이 있으면 true다', () => {
    const survey = makeSurvey();
    const bundle = makeBundle({ surveys: [survey] });
    const session = sessionAfterStart(survey);
    const state = { version: 1, contextSession: null, surveySession: session };
    expect(willSurveyConsumeInput(state, bundle, NOW)).toBe(true);
  });

  it('타임아웃된 설문 세션은 false다(일반 경로로 넘어가 의미 매칭을 써야 한다)', () => {
    const survey = makeSurvey({ sessionTimeoutMinutes: 30 });
    const bundle = makeBundle({ surveys: [survey] });
    const session = sessionAfterStart(survey);
    const state = { version: 1, contextSession: null, surveySession: session };
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect(willSurveyConsumeInput(state, bundle, later)).toBe(false);
  });
});
