import {
  SURVEY_SKIP_BUTTON_VALUE,
  SURVEY_STOP_BUTTON_VALUE,
  averageOf,
  buildSurveyQuestionOutputs,
  evaluateSurveyAvailability,
  isSurveyLive,
  judgeSurveyAnswer,
  npsOf,
  validateSurveyAnswerValue,
} from '@chat-bot/shared-types';
import type { Survey, SurveyQuestion } from '@chat-bot/shared-types';
import { SKIP_TOKENS } from './constants';
import { makeSurvey, randomId } from './test-fixtures';

/**
 * `packages/shared-types/src/survey-logic.ts` 순수 함수 전 조합 시험(No.27, 설계 §18 인계 1행).
 * shared-types 패키지에는 jest가 배선되지 않아(다른 순수 유틸도 동일 관례 — `api-mapping.ts` 등)
 * 소비 패키지인 dialogue-engine에서 검증한다. Nest·Prisma·DOM 의존 0 — 순수 함수만 다룬다.
 */

function question<T extends SurveyQuestion>(q: T): T {
  return q;
}

const SINGLE = question({
  key: randomId(),
  type: 'SINGLE_CHOICE',
  prompt: '가장 만족한 점은?',
  required: true,
  choices: [
    { key: randomId(), label: '속도' },
    { key: randomId(), label: '친절도' },
    { key: randomId(), label: '가격' },
  ],
});

const MULTI = question({
  key: randomId(),
  type: 'MULTI_CHOICE',
  prompt: '이유를 모두 골라주세요.',
  required: true,
  minSelect: 1,
  maxSelect: 2,
  choices: [
    { key: randomId(), label: '포장' },
    { key: randomId(), label: '속도' },
    { key: randomId(), label: '가격' },
    { key: randomId(), label: '친절도' },
  ],
});

const SCALE_STAR = question({
  key: randomId(),
  type: 'SCALE',
  prompt: '만족도를 알려주세요.',
  required: true,
  scale: 'STAR_5',
  lowLabel: '매우 불만족',
  highLabel: '매우 만족',
});

const SCALE_NPS = question({
  key: randomId(),
  type: 'SCALE',
  prompt: '추천할 의향이 있나요?',
  required: true,
  scale: 'NPS_11',
});

const TEXT_Q = question({
  key: randomId(),
  type: 'TEXT',
  prompt: '자유롭게 의견을 남겨주세요.',
  required: false,
  maxLength: 10,
});

describe('judgeSurveyAnswer — SINGLE_CHOICE', () => {
  it('라벨 전체 일치로 판정한다', () => {
    const r = judgeSurveyAnswer(SINGLE, '친절도');
    expect(r).toEqual({ ok: true, value: { type: 'CHOICE', choiceKeys: [SINGLE.choices[1].key] } });
  });

  it.each([['1'], ['1번'], ['1.']])('번호 표기 "%s"는 순번으로 판정한다', (raw) => {
    const r = judgeSurveyAnswer(SINGLE, raw);
    expect(r).toEqual({ ok: true, value: { type: 'CHOICE', choiceKeys: [SINGLE.choices[0].key] } });
  });

  it('선택지 라벨이 숫자여도 라벨이 번호 해석보다 우선한다', () => {
    const q = question({
      ...SINGLE,
      choices: [
        { key: randomId(), label: '2' }, // 인덱스 0(번호로는 "1"에 대응)
        { key: randomId(), label: '1' }, // 인덱스 1(번호로는 "2"에 대응)
      ],
    });
    const r = judgeSurveyAnswer(q, '1');
    // "1"은 번호 1(인덱스0="2")이 아니라 라벨이 "1"인 인덱스1 선택지로 판정된다.
    expect(r).toEqual({ ok: true, value: { type: 'CHOICE', choiceKeys: [q.choices[1].key] } });
  });

  it('제시 범위 밖 번호·해석 불가 텍스트는 NOT_A_CHOICE다', () => {
    expect(judgeSurveyAnswer(SINGLE, '99')).toEqual({ ok: false, code: 'NOT_A_CHOICE' });
    expect(judgeSurveyAnswer(SINGLE, '아무말')).toEqual({ ok: false, code: 'NOT_A_CHOICE' });
  });
});

describe('judgeSurveyAnswer — MULTI_CHOICE', () => {
  it('쉼표로 구분한 번호 조합("1,3")을 판정한다', () => {
    const r = judgeSurveyAnswer(MULTI, '1,3');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'CHOICE') {
      expect(r.value.choiceKeys).toEqual([MULTI.choices[0].key, MULTI.choices[2].key]);
    }
  });

  it('공백만으로 구분된 순수 숫자열("1 3")도 토큰으로 분리한다', () => {
    const r = judgeSurveyAnswer(MULTI, '1 3');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'CHOICE') {
      expect(r.value.choiceKeys).toEqual([MULTI.choices[0].key, MULTI.choices[2].key]);
    }
  });

  it('라벨 조합("포장,속도")을 판정한다', () => {
    const r = judgeSurveyAnswer(MULTI, '포장,속도');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'CHOICE') {
      expect(r.value.choiceKeys.sort()).toEqual([MULTI.choices[0].key, MULTI.choices[1].key].sort());
    }
  });

  it('입력 전체가 선택지 라벨 1개와 정확히 일치하면 그 1개만 선택된다(공백 포함 라벨 보호)', () => {
    const q = question({ ...MULTI, choices: [{ key: randomId(), label: '포장 속도' }, ...MULTI.choices.slice(1)] });
    const r = judgeSurveyAnswer(q, '포장 속도');
    expect(r).toEqual({ ok: true, value: { type: 'CHOICE', choiceKeys: [q.choices[0].key] } });
  });

  it('중복 토큰은 중복 제거 후 개수를 판정한다("1,1"은 실질 1개 선택으로 줄어든다)', () => {
    // MULTI(minSelect=1)는 dedup 후 1개로도 통과한다 — dedup 자체의 증거로 choiceKeys 길이 1을 확인한다.
    const r = judgeSurveyAnswer(MULTI, '1,1');
    expect(r).toEqual({ ok: true, value: { type: 'CHOICE', choiceKeys: [MULTI.choices[0].key] } });

    // minSelect=2인 문항에서는 dedup 후 1개뿐이라 TOO_FEW로 드러난다(중복 제거가 실제로 일어난다는 증거).
    const strict = question({ ...MULTI, minSelect: 2, maxSelect: 2 });
    expect(judgeSurveyAnswer(strict, '1,1')).toEqual({ ok: false, code: 'TOO_FEW' });
  });

  it('최소 선택 수 미달은 TOO_FEW, 최대 초과는 TOO_MANY다', () => {
    expect(judgeSurveyAnswer(MULTI, '')).toEqual({ ok: false, code: 'NOT_A_CHOICE' });
    expect(judgeSurveyAnswer(MULTI, '1,2,3')).toEqual({ ok: false, code: 'TOO_MANY' });
  });

  it('해석 불가 토큰이 하나라도 있으면 전체가 NOT_A_CHOICE다', () => {
    expect(judgeSurveyAnswer(MULTI, '1,없는선택지')).toEqual({ ok: false, code: 'NOT_A_CHOICE' });
  });

  it('선택지 순서 기준으로 결과가 정렬된다(입력 순서 무관)', () => {
    const r = judgeSurveyAnswer(MULTI, '3,1');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'CHOICE') {
      expect(r.value.choiceKeys).toEqual([MULTI.choices[0].key, MULTI.choices[2].key]);
    }
  });
});

describe('judgeSurveyAnswer — SCALE', () => {
  it.each([
    ['3', 3],
    ['3점', 3],
    ['★3', 3],
    ['3점 보통이에요', 3],
  ])('STAR_5 "%s" → %d', (raw, expected) => {
    expect(judgeSurveyAnswer(SCALE_STAR, raw)).toEqual({ ok: true, value: { type: 'SCALE', value: expected } });
  });

  it.each([['0'], ['6'], ['-1']])('STAR_5 범위(1~5) 밖 "%s"는 OUT_OF_RANGE다', (raw) => {
    expect(judgeSurveyAnswer(SCALE_STAR, raw)).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
  });

  it('숫자로 시작하지 않으면 NOT_A_NUMBER다', () => {
    expect(judgeSurveyAnswer(SCALE_STAR, '매우 만족')).toEqual({ ok: false, code: 'NOT_A_NUMBER' });
  });

  it.each([['0', 0], ['10', 10]])('NPS_11 경계값 "%s" → %d(허용)', (raw, expected) => {
    expect(judgeSurveyAnswer(SCALE_NPS, raw)).toEqual({ ok: true, value: { type: 'SCALE', value: expected } });
  });

  it.each([['-1'], ['11']])('NPS_11 범위(0~10) 밖 "%s"는 OUT_OF_RANGE다', (raw) => {
    expect(judgeSurveyAnswer(SCALE_NPS, raw)).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
  });
});

describe('judgeSurveyAnswer — TEXT', () => {
  it('1자 이상 · 상한 이내면 정제된 원문을 값으로 돌려준다', () => {
    expect(judgeSurveyAnswer(TEXT_Q, '  좋아요  ')).toEqual({ ok: true, value: { type: 'TEXT', text: '좋아요' } });
  });

  it('제어문자를 제거한 뒤 판정한다', () => {
    const r = judgeSurveyAnswer(TEXT_Q, '좋아\u0000요');
    expect(r).toEqual({ ok: true, value: { type: 'TEXT', text: '좋아요' } });
  });

  it('공백만 입력하면 EMPTY다', () => {
    expect(judgeSurveyAnswer(TEXT_Q, '   ')).toEqual({ ok: false, code: 'EMPTY' });
  });

  it('코드 포인트 기준으로 상한을 넘으면 TOO_LONG이며 자르지 않는다', () => {
    const over = '가'.repeat(11); // maxLength=10
    expect(judgeSurveyAnswer(TEXT_Q, over)).toEqual({ ok: false, code: 'TOO_LONG' });
  });

  it('서로게이트 쌍(이모지)도 1 코드 포인트로 센다', () => {
    const q = question({ ...TEXT_Q, maxLength: 3 });
    // 이모지 3개 = 코드 포인트 3개(UTF-16 코드 유닛 기준 6개) — 길이 초과가 아니어야 한다.
    const raw = '😀😀😀';
    expect(judgeSurveyAnswer(q, raw)).toEqual({ ok: true, value: { type: 'TEXT', text: raw } });
    expect(judgeSurveyAnswer(question({ ...q, maxLength: 2 }), raw)).toEqual({ ok: false, code: 'TOO_LONG' });
  });

  it('"그만"이 포함된 긴 자유 응답은 판정 대상 밖(취소 판정은 엔진 몫)이라 그대로 TEXT 값이 된다', () => {
    const raw = '이제 그만 좀 배송이 늦었으면 좋겠어요';
    expect(judgeSurveyAnswer(question({ ...TEXT_Q, maxLength: 100 }), raw)).toEqual({ ok: true, value: { type: 'TEXT', text: raw } });
  });
});

describe('validateSurveyAnswerValue — 서버 재검증', () => {
  it('SINGLE_CHOICE: 존재하는 key 1개만 허용', () => {
    expect(validateSurveyAnswerValue(SINGLE, { type: 'CHOICE', choiceKeys: [SINGLE.choices[0].key] })).toBe(true);
    expect(validateSurveyAnswerValue(SINGLE, { type: 'CHOICE', choiceKeys: [randomId()] })).toBe(false);
    expect(validateSurveyAnswerValue(SINGLE, { type: 'CHOICE', choiceKeys: [SINGLE.choices[0].key, SINGLE.choices[1].key] })).toBe(false);
    expect(validateSurveyAnswerValue(SINGLE, { type: 'SCALE', value: 1 })).toBe(false);
  });

  it('MULTI_CHOICE: 중복 key·개수 범위·미지 key를 모두 거부한다', () => {
    const ok = { type: 'CHOICE' as const, choiceKeys: [MULTI.choices[0].key, MULTI.choices[1].key] };
    expect(validateSurveyAnswerValue(MULTI, ok)).toBe(true);
    expect(validateSurveyAnswerValue(MULTI, { type: 'CHOICE', choiceKeys: [MULTI.choices[0].key, MULTI.choices[0].key] })).toBe(false); // 중복
    expect(validateSurveyAnswerValue(MULTI, { type: 'CHOICE', choiceKeys: [] })).toBe(false); // minSelect=1 미달
    expect(
      validateSurveyAnswerValue(MULTI, {
        type: 'CHOICE',
        choiceKeys: [MULTI.choices[0].key, MULTI.choices[1].key, MULTI.choices[2].key],
      }),
    ).toBe(false); // maxSelect=2 초과
    expect(validateSurveyAnswerValue(MULTI, { type: 'CHOICE', choiceKeys: [randomId()] })).toBe(false); // 미지 key
  });

  it('SCALE: 정수·범위만 허용', () => {
    expect(validateSurveyAnswerValue(SCALE_STAR, { type: 'SCALE', value: 3 })).toBe(true);
    expect(validateSurveyAnswerValue(SCALE_STAR, { type: 'SCALE', value: 3.5 })).toBe(false);
    expect(validateSurveyAnswerValue(SCALE_STAR, { type: 'SCALE', value: 0 })).toBe(false);
    expect(validateSurveyAnswerValue(SCALE_STAR, { type: 'SCALE', value: 6 })).toBe(false);
  });

  it('TEXT: 길이 1~maxLength만 허용', () => {
    expect(validateSurveyAnswerValue(TEXT_Q, { type: 'TEXT', text: '좋아요' })).toBe(true);
    expect(validateSurveyAnswerValue(TEXT_Q, { type: 'TEXT', text: '' })).toBe(false);
    expect(validateSurveyAnswerValue(TEXT_Q, { type: 'TEXT', text: '가'.repeat(11) })).toBe(false);
  });
});

describe('buildSurveyQuestionOutputs — 문항 출력(AC-SV2-13)', () => {
  function totalButtonCount(outputs: ReturnType<typeof buildSurveyQuestionOutputs>): number {
    return outputs
      .filter((o) => o.type === 'BUTTON')
      .reduce((sum, o) => sum + ((o.payload as { buttons: unknown[] }).buttons?.length ?? 0), 0);
  }

  it('TEXT 출력에 진행 표시(n/N)와 문항 문구가 포함된다', () => {
    const survey = makeSurvey({ questions: [SINGLE, MULTI] });
    const outputs = buildSurveyQuestionOutputs(survey, 0);
    const text = outputs.find((o) => o.type === 'TEXT');
    expect((text?.payload as { text: string }).text).toContain('1/2');
    expect((text?.payload as { text: string }).text).toContain(SINGLE.prompt);
  });

  it('withIntro 옵션이 있으면 소개 문구가 맨 앞에 추가된다', () => {
    const survey = makeSurvey({ questions: [SINGLE], introMessage: '설문에 참여해 주세요.' });
    const outputs = buildSurveyQuestionOutputs(survey, 0, { withIntro: true });
    expect(outputs[0]).toEqual({ type: 'TEXT', payload: { text: '설문에 참여해 주세요.' } });
  });

  it('필수 문항 버튼에는 건너뛰기가 없고, 선택 문항에는 건너뛰기가 있으며, 그만하기는 항상 마지막이다', () => {
    const requiredSurvey = makeSurvey({ questions: [SINGLE] });
    const requiredButtons = buildSurveyQuestionOutputs(requiredSurvey, 0)
      .filter((o) => o.type === 'BUTTON')
      .flatMap((o) => (o.payload as { buttons: Array<{ value: string }> }).buttons);
    expect(requiredButtons.some((b) => b.value === SURVEY_SKIP_BUTTON_VALUE)).toBe(false);
    expect(requiredButtons[requiredButtons.length - 1].value).toBe(SURVEY_STOP_BUTTON_VALUE);

    const optionalSurvey = makeSurvey({ questions: [{ ...SINGLE, required: false }] });
    const optionalButtons = buildSurveyQuestionOutputs(optionalSurvey, 0)
      .filter((o) => o.type === 'BUTTON')
      .flatMap((o) => (o.payload as { buttons: Array<{ value: string }> }).buttons);
    expect(optionalButtons.some((b) => b.value === SURVEY_SKIP_BUTTON_VALUE)).toBe(true);
  });

  it('선택지 8개(필수) — 5개 단위로 나뉘며 슬라이스로 버림 없이 전 버튼(선택지8+그만하기1=9개)이 보존된다', () => {
    const eightChoices = question({
      key: randomId(),
      type: 'SINGLE_CHOICE',
      prompt: '8지 선택 문항',
      required: true,
      choices: Array.from({ length: 8 }, (_, i) => ({ key: randomId(), label: `선택지${i + 1}` })),
    });
    const survey = makeSurvey({ questions: [eightChoices] });
    const outputs = buildSurveyQuestionOutputs(survey, 0);
    const blocks = outputs.filter((o) => o.type === 'BUTTON');
    expect(blocks.length).toBeLessThanOrEqual(3);
    for (const b of blocks) expect((b.payload as { buttons: unknown[] }).buttons.length).toBeLessThanOrEqual(5);
    expect(totalButtonCount(outputs)).toBe(9); // 8 선택지 + 그만하기 1 — AC-SV2-13: slice(0,5) 절단 없음
  });

  it('NPS_11(11개 값, 필수) — 값 11개 + 그만하기 1개 = 12개가 모두 보존된다', () => {
    const survey = makeSurvey({ questions: [SCALE_NPS] });
    const outputs = buildSurveyQuestionOutputs(survey, 0);
    const blocks = outputs.filter((o) => o.type === 'BUTTON');
    expect(blocks.length).toBeLessThanOrEqual(3);
    expect(totalButtonCount(outputs)).toBe(12);
  });

  it('다중 선택 라벨은 "{번호}. {라벨}" 형태로 40 코드 포인트에서 자르고 …을 붙인다(원래 값은 자르지 않는다)', () => {
    const longLabel = '가'.repeat(50);
    const q = question({
      key: randomId(),
      type: 'MULTI_CHOICE',
      prompt: '문항',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      choices: [{ key: randomId(), label: longLabel }, { key: randomId(), label: '짧은라벨' }],
    });
    const survey = makeSurvey({ questions: [q] });
    const outputs = buildSurveyQuestionOutputs(survey, 0);
    const buttons = outputs.filter((o) => o.type === 'BUTTON').flatMap((o) => (o.payload as { buttons: Array<{ label: string; value: string }> }).buttons);
    const longButton = buttons.find((b) => b.value === longLabel);
    expect(longButton).toBeDefined();
    expect(Array.from(longButton!.label).length).toBe(40);
    expect(longButton!.label.endsWith('…')).toBe(true);
    expect(longButton!.value).toBe(longLabel); // 값(전송용)은 자르지 않는다
  });

  it('척도 문항은 선택지 버튼이 없고 값 버튼(+제어 버튼)만 있다 — 자유 텍스트는 제어 버튼만 있다', () => {
    const scaleSurvey = makeSurvey({ questions: [SCALE_STAR] });
    const scaleButtons = buildSurveyQuestionOutputs(scaleSurvey, 0)
      .filter((o) => o.type === 'BUTTON')
      .flatMap((o) => (o.payload as { buttons: unknown[] }).buttons);
    expect(scaleButtons.length).toBe(6); // 1~5점 + 그만하기

    const textSurvey = makeSurvey({ questions: [{ ...TEXT_Q, required: false }] });
    const textButtons = buildSurveyQuestionOutputs(textSurvey, 0)
      .filter((o) => o.type === 'BUTTON')
      .flatMap((o) => (o.payload as { buttons: Array<{ value: string }> }).buttons);
    expect(textButtons.map((b) => b.value)).toEqual([SURVEY_SKIP_BUTTON_VALUE, SURVEY_STOP_BUTTON_VALUE]);
  });
});

describe('evaluateSurveyAvailability — 참여 가능 판정 순서(①②⑤③④)', () => {
  it('설문이 없으면 NOT_FOUND다', () => {
    expect(evaluateSurveyAvailability(undefined, new Date(), [], false)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('문항이 0개면 EMPTY다', () => {
    const survey = makeSurvey({ questions: [] });
    expect(evaluateSurveyAvailability(survey, new Date(), [], false)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('이미 완료한 설문 id면 상태가 DRAFT/기간 밖이어도 ALREADY_RESPONDED가 먼저 보고된다(판정 순서)', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'DRAFT' });
    expect(evaluateSurveyAvailability(survey, new Date(), [survey.id], false)).toEqual({ ok: false, reason: 'ALREADY_RESPONDED' });
  });

  it('preview=true여도 ALREADY_RESPONDED는 그대로 적용된다(D-25)', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'DRAFT' });
    expect(evaluateSurveyAvailability(survey, new Date(), [survey.id], true)).toEqual({ ok: false, reason: 'ALREADY_RESPONDED' });
  });

  it('OPEN이 아니면 NOT_OPEN이다(preview=false)', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'DRAFT' });
    expect(evaluateSurveyAvailability(survey, new Date(), [], false)).toEqual({ ok: false, reason: 'NOT_OPEN' });
  });

  it('preview=true면 DRAFT/CLOSED·기간 밖이어도 진행 가능하다', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'CLOSED' });
    expect(evaluateSurveyAvailability(survey, new Date(), [], true)).toEqual({ ok: true });
  });

  it('종료일(activeTo) 배타 경계 — 직전은 가능, 정확히 그 시각은 불가(EX-SV 종료일 경계)', () => {
    const activeTo = new Date('2026-09-24T10:00:00.000Z');
    const survey = makeSurvey({ questions: [SINGLE], status: 'OPEN', activeTo });
    const justBefore = new Date(activeTo.getTime() - 1);
    expect(evaluateSurveyAvailability(survey, justBefore, [], false)).toEqual({ ok: true });
    expect(evaluateSurveyAvailability(survey, activeTo, [], false)).toEqual({ ok: false, reason: 'OUT_OF_PERIOD' });
  });

  it('시작일(activeFrom)은 포함 경계 — 정확히 그 시각부터 가능하다', () => {
    const activeFrom = new Date('2026-09-24T10:00:00.000Z');
    const survey = makeSurvey({ questions: [SINGLE], status: 'OPEN', activeFrom });
    const justBefore = new Date(activeFrom.getTime() - 1);
    expect(evaluateSurveyAvailability(survey, justBefore, [], false)).toEqual({ ok: false, reason: 'OUT_OF_PERIOD' });
    expect(evaluateSurveyAvailability(survey, activeFrom, [], false)).toEqual({ ok: true });
  });
});

describe('isSurveyLive — 진행 중 세션의 계속 가능 판정', () => {
  it('설문이 사라졌으면 DEFINITION_CHANGED다', () => {
    expect(isSurveyLive(undefined, { structureVersion: 1 }, new Date(), false)).toEqual({ live: false, reason: 'DEFINITION_CHANGED' });
  });

  it('구조 버전이 달라지면 DEFINITION_CHANGED다', () => {
    const survey = makeSurvey({ questions: [SINGLE], structureVersion: 2 });
    expect(isSurveyLive(survey, { structureVersion: 1 }, new Date(), false)).toEqual({ live: false, reason: 'DEFINITION_CHANGED' });
  });

  it('상태가 OPEN이 아니면 CLOSED다', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'CLOSED', structureVersion: 1 });
    expect(isSurveyLive(survey, { structureVersion: 1 }, new Date(), false)).toEqual({ live: false, reason: 'CLOSED' });
  });

  it('activeTo 경과도 CLOSED로 판정한다(배타 경계 — 정확히 그 시각도 불가)', () => {
    const activeTo = new Date('2026-09-24T10:00:00.000Z');
    const survey = makeSurvey({ questions: [SINGLE], status: 'OPEN', structureVersion: 1, activeTo });
    expect(isSurveyLive(survey, { structureVersion: 1 }, activeTo, false)).toEqual({ live: false, reason: 'CLOSED' });
    expect(isSurveyLive(survey, { structureVersion: 1 }, new Date(activeTo.getTime() - 1), false)).toEqual({ live: true });
  });

  it('preview=true면 CLOSED 상태·기간 종료를 무시하지만 DEFINITION_CHANGED는 그대로 판정한다', () => {
    const survey = makeSurvey({ questions: [SINGLE], status: 'CLOSED', structureVersion: 2 });
    expect(isSurveyLive(survey, { structureVersion: 1 }, new Date(), true)).toEqual({ live: false, reason: 'DEFINITION_CHANGED' });
    const survey2 = makeSurvey({ questions: [SINGLE], status: 'CLOSED', structureVersion: 1 });
    expect(isSurveyLive(survey2, { structureVersion: 1 }, new Date(), true)).toEqual({ live: true });
  });
});

describe('npsOf · averageOf', () => {
  it('표본이 없으면 null이다', () => {
    expect(npsOf([])).toBeNull();
    expect(averageOf([])).toBeNull();
  });

  it('NPS = round((추천 비율 − 비추천 비율) × 100), 9~10 추천/0~6 비추천/7~8 중립', () => {
    const dist = [
      { value: 10, count: 5 }, // 추천
      { value: 8, count: 3 }, // 중립(계산 제외)
      { value: 3, count: 2 }, // 비추천
    ];
    expect(npsOf(dist)).toBe(30); // (5-2)/10*100
  });

  it('평균은 가중 평균을 소수 1자리로 반올림한다', () => {
    const dist = [
      { value: 5, count: 2 },
      { value: 3, count: 1 },
      { value: 4, count: 1 },
    ];
    // (5*2 + 3 + 4) / 4 = 4.25 → 4.3(반올림 — 실제로는 4.25→4.3? round(42.5)/10=4.3)
    expect(averageOf(dist)).toBe(4.3);
  });
});

describe('제어 토큰 정합성', () => {
  it('건너뛰기 버튼 값은 엔진 SKIP_TOKENS에 포함된다(두 상수 불일치 방지)', () => {
    expect(SKIP_TOKENS).toContain(SURVEY_SKIP_BUTTON_VALUE);
  });
});

describe('성능 — 문항 판정 1건 처리 시간(NFR-SVP4, 느슨한 CI 여유 포함)', () => {
  it('다중 선택(10지) 1,000회 판정이 합리적인 시간 안에 끝난다', () => {
    const tenChoices = question({
      key: randomId(),
      type: 'MULTI_CHOICE',
      prompt: '10지 선택',
      required: true,
      minSelect: 1,
      maxSelect: 10,
      choices: Array.from({ length: 10 }, (_, i) => ({ key: randomId(), label: `선택지${i + 1}` })),
    });
    const started = Date.now();
    for (let i = 0; i < 1000; i++) judgeSurveyAnswer(tenChoices, '1,3,5,7,9');
    const elapsed = Date.now() - started;
    // 목표는 문항당 1ms 이내지만, CI 지연을 감안해 1,000회 총합 500ms(평균 0.5ms) 미만으로 느슨하게 확인한다.
    expect(elapsed).toBeLessThan(500);
  });

  it('자유 텍스트(500자) 1,000회 판정이 합리적인 시간 안에 끝난다', () => {
    const longText = question({ ...TEXT_Q, maxLength: 500 });
    const raw = '가'.repeat(500);
    const started = Date.now();
    for (let i = 0; i < 1000; i++) judgeSurveyAnswer(longText, raw);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
  });
});
