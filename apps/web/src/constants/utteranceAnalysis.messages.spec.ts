import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages';

/**
 * DC-15 · FR-DC6-6 — 발화 묶음 분석 화면 문자열에는 기술 용어("토픽·군집·클러스터·임베딩·벡터")를 쓰지 않는다.
 * 유일한 예외는 도움말 한 문장(`clusterHelp`, "챗봇의 '토픽' 설정과는 관계없습니다")이다.
 */
const FORBIDDEN = ['토픽', '군집', '클러스터', '임베딩', '벡터'];
const FORBIDDEN_EN = /embedding|cluster|vector/i;
const ALLOWED_KEYS = new Set(['clusterHelp']);

function collect(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (typeof value === 'function') {
    // 함수형 문구는 숫자 인자로 호출해 실제 출력 문자열을 검사한다(문자열 자리에도 "1"이 들어가 무해하다).
    const text = (value as (...args: unknown[]) => unknown)(1, 1, 1, 1);
    if (typeof text === 'string') out.push({ path, text });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path ? `${path}.${k}` : k, out);
  }
}

describe('MESSAGES.utteranceAnalysis — 화면 용어 원칙(DC-15)', () => {
  const all: Array<{ path: string; text: string }> = [];
  collect(MESSAGES.utteranceAnalysis, '', all);

  it('문구가 충분히 수집된다(시험이 빈 껍데기가 아님)', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('금지 용어는 clusterHelp 한 문장 외에는 어디에도 없다', () => {
    const violations = all.filter((m) => !ALLOWED_KEYS.has(m.path) && (FORBIDDEN.some((w) => m.text.includes(w)) || FORBIDDEN_EN.test(m.text)));
    expect(violations).toEqual([]);
  });

  it('clusterHelp만 "토픽"을 쓰고, 그 문장은 챗봇의 토픽 설정과 무관함을 밝힌다', () => {
    const withTopic = all.filter((m) => m.text.includes('토픽'));
    expect(withTopic.map((m) => m.path)).toEqual(['clusterHelp']);
    expect(MESSAGES.utteranceAnalysis.clusterHelp).toContain('관계없습니다');
  });

  it('자동 캡처 트리거 라벨 BEFORE_UTTERANCE_APPLY가 기존 형식으로 추가되어 있다', () => {
    expect(MESSAGES.versions.triggerBadge.BEFORE_UTTERANCE_APPLY).toBe('자동 · 발화 묶음 반영 직전');
  });
});
