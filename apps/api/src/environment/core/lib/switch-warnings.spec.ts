import { computeSwitchWarnings } from './switch-warnings';

/**
 * [신규 No.40 — §9.4] 전환 경고 7종(CONTEXT_FLOWS_AFFECTED·TOPIC_EXPOSURE_CHANGE·TOPIC_MISSING·
 * SURVEY_MISSING·SURVEY_NOT_OPEN·API_CONNECTION_MISSING·API_CONNECTION_DISABLED) 단위 시험.
 * `prod-switch.service.ts`가 이 순수 함수에 입력을 조립해 넘긴다(DB 무의존이라 여기서 전부 검증
 * 가능).
 */
function profile(name = '봇') {
  return { name, description: null, avatarUrl: null, skin: { primaryColor: '#000', headerTitle: '챗봇' } };
}

function baseInput() {
  return {
    targetLegacyTiebreak: false,
    semanticMissing: 0,
    targetCreatedAt: new Date('2026-01-10T00:00:00Z'),
    draftLatestCapturedAt: new Date('2026-01-01T00:00:00Z'),
    currentProfile: profile(),
    targetProfile: profile(),
    contextFlowsAffected: 0,
    topicExposure: { exposed: 0, hidden: 0 },
    topicMissingCount: 0,
    surveyMissingCount: 0,
    surveyNotOpenCount: 0,
    apiConnectionMissingCount: 0,
    apiConnectionDisabledCount: 0,
  } as Parameters<typeof computeSwitchWarnings>[0];
}

describe('computeSwitchWarnings — §9.4 경고 7종', () => {
  it('모든 입력이 0/false면 경고가 없다', () => {
    expect(computeSwitchWarnings(baseInput())).toEqual([]);
  });

  it('CONTEXT_FLOWS_AFFECTED — 진행 중 흐름이 끊길 수 있는 노드 수를 싣는다', () => {
    const warnings = computeSwitchWarnings({ ...baseInput(), contextFlowsAffected: 3 });
    expect(warnings).toContainEqual({ code: 'CONTEXT_FLOWS_AFFECTED', count: 3 });
  });

  it('TOPIC_EXPOSURE_CHANGE — 노출 증가만 있어도, 숨김만 있어도 싣는다', () => {
    expect(computeSwitchWarnings({ ...baseInput(), topicExposure: { exposed: 2, hidden: 0 } })).toContainEqual({
      code: 'TOPIC_EXPOSURE_CHANGE',
      exposed: 2,
      hidden: 0,
    });
    expect(computeSwitchWarnings({ ...baseInput(), topicExposure: { exposed: 0, hidden: 1 } })).toContainEqual({
      code: 'TOPIC_EXPOSURE_CHANGE',
      exposed: 0,
      hidden: 1,
    });
  });

  it('TOPIC_MISSING — 대상 버전에 토픽 정의가 없는 항목 수를 싣는다', () => {
    expect(computeSwitchWarnings({ ...baseInput(), topicMissingCount: 2 })).toContainEqual({ code: 'TOPIC_MISSING', count: 2 });
  });

  it('SURVEY_MISSING · SURVEY_NOT_OPEN — 독립적으로 싣는다(동시에 있을 수 있다)', () => {
    const warnings = computeSwitchWarnings({ ...baseInput(), surveyMissingCount: 1, surveyNotOpenCount: 2 });
    expect(warnings).toContainEqual({ code: 'SURVEY_MISSING', count: 1 });
    expect(warnings).toContainEqual({ code: 'SURVEY_NOT_OPEN', count: 2 });
  });

  it('API_CONNECTION_MISSING · API_CONNECTION_DISABLED — 독립적으로 싣는다', () => {
    const warnings = computeSwitchWarnings({ ...baseInput(), apiConnectionMissingCount: 1, apiConnectionDisabledCount: 1 });
    expect(warnings).toContainEqual({ code: 'API_CONNECTION_MISSING', count: 1 });
    expect(warnings).toContainEqual({ code: 'API_CONNECTION_DISABLED', count: 1 });
  });

  it('기존 경고(LEGACY_TIEBREAK·SEMANTIC_INDEX_PENDING·OLDER_THAN_DRAFT·PROFILE_WILL_CHANGE)는 여전히 함께 나온다(회귀 방지)', () => {
    const warnings = computeSwitchWarnings({
      ...baseInput(),
      targetLegacyTiebreak: true,
      semanticMissing: 5,
      targetCreatedAt: new Date('2025-01-01T00:00:00Z'), // draftLatestCapturedAt보다 이르다.
      targetProfile: profile('다른이름'),
    });
    expect(warnings).toContainEqual({ code: 'LEGACY_TIEBREAK' });
    expect(warnings).toContainEqual({ code: 'SEMANTIC_INDEX_PENDING', count: 5 });
    expect(warnings).toContainEqual({ code: 'OLDER_THAN_DRAFT' });
    expect(warnings).toContainEqual({ code: 'PROFILE_WILL_CHANGE', fields: ['name'] });
  });

  it('7종 모두 동시에 발생하면 전부 싣는다(순서·존재 확인)', () => {
    const warnings = computeSwitchWarnings({
      ...baseInput(),
      contextFlowsAffected: 1,
      topicExposure: { exposed: 1, hidden: 1 },
      topicMissingCount: 1,
      surveyMissingCount: 1,
      surveyNotOpenCount: 1,
      apiConnectionMissingCount: 1,
      apiConnectionDisabledCount: 1,
    });
    const codes = warnings.map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'CONTEXT_FLOWS_AFFECTED',
        'TOPIC_EXPOSURE_CHANGE',
        'TOPIC_MISSING',
        'SURVEY_MISSING',
        'SURVEY_NOT_OPEN',
        'API_CONNECTION_MISSING',
        'API_CONNECTION_DISABLED',
      ]),
    );
    expect(warnings).toHaveLength(7);
  });
});
