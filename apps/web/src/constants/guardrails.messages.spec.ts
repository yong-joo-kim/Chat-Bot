import { describe, expect, it } from 'vitest';
import { GUARDRAIL_ACTION_LABELS, GUARDRAIL_APPLIES_TO_LABELS, GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_PII_KIND_LABELS } from '@chat-bot/shared-types';
import { MESSAGES } from './messages';

/**
 * AG-16 · NFR-AGA2 — 안전 가드레일 화면 문자열의 용어 원칙(ai-guardrails-ui-spec.md §0.3).
 * "가드레일"은 탭·화면 제목 1곳(`detail.tabGuardrails`)에만 쓰고, "환각"·"hallucination"·"편향 없음"은 어디에도 쓰지 않는다.
 * 그 밖에 관리자에게 어려운 내부 용어(RAG·이벤트·PII·마스킹)도 화면 문구에는 쓰지 않는다.
 */
const FORBIDDEN_EVERYWHERE = ['환각', '편향 없음', '입구', '출구', '프로필', '캐시', '포인터'];
const FORBIDDEN_PATTERNS = [/hallucination/i, /\bRAG\b/, /\bPII\b/, /\bCAS\b/, /마스킹/, /이벤트/];

function collect(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (typeof value === 'function') {
    // 함수형 문구는 인자를 넣어 실제 출력 문자열을 검사한다(숫자·문자열 어느 자리에도 무해한 값을 쓴다).
    const text = (value as (...args: unknown[]) => unknown)(1, 1, 1, 1, 1);
    if (typeof text === 'string') out.push({ path, text });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path ? `${path}.${k}` : k, out);
  }
}

describe('MESSAGES.guardrails · MESSAGES.switchApproval — 화면 용어 원칙(AG-16)', () => {
  const all: Array<{ path: string; text: string }> = [];
  collect(MESSAGES.guardrails, 'guardrails', all);
  collect(MESSAGES.switchApproval, 'switchApproval', all);
  // 라벨 상수(shared-types)도 화면에 그대로 나가므로 함께 검사한다.
  for (const table of [GUARDRAIL_ACTION_LABELS, GUARDRAIL_APPLIES_TO_LABELS, GUARDRAIL_CATEGORY_LABELS, GUARDRAIL_PII_KIND_LABELS]) {
    for (const [k, v] of Object.entries(table)) all.push({ path: `label.${k}`, text: v });
  }

  it('문구가 충분히 수집된다(시험이 빈 껍데기가 아님)', () => {
    expect(all.length).toBeGreaterThan(250);
  });

  it('"환각"·"hallucination"·"편향 없음"은 어디에도 없다', () => {
    const bad = all.filter((m) => m.text.includes('환각') || /hallucination/i.test(m.text) || m.text.includes('편향 없음'));
    expect(bad).toEqual([]);
  });

  it('"가드레일"은 이 두 문구 블록 어디에도 쓰지 않는다(탭·화면 제목은 detail.tabGuardrails 1곳)', () => {
    const bad = all.filter((m) => m.text.includes('가드레일'));
    expect(bad).toEqual([]);
    expect(MESSAGES.detail.tabGuardrails).toBe('안전 가드레일');
  });

  it('관리자에게 어려운 내부 용어(입구/출구·프로필·캐시·포인터·RAG·PII·마스킹·이벤트)를 쓰지 않는다', () => {
    const bad = all.filter((m) => FORBIDDEN_EVERYWHERE.some((w) => m.text.includes(w)) || FORBIDDEN_PATTERNS.some((p) => p.test(m.text)));
    expect(bad).toEqual([]);
  });

  it('동작·위치 라벨은 shared-types 상수와 같은 말을 쓴다(복제 금지)', () => {
    expect(GUARDRAIL_ACTION_LABELS).toEqual({ MONITOR: '기록만', REPLACE: '안전 문구로 대체', NO_RAG: 'AI로 보내지 않음' });
    expect(GUARDRAIL_APPLIES_TO_LABELS.OUTBOUND).toBe('AI 답변');
  });

  it('예약 실패 사유 APPROVAL_MISSING 라벨이 추가되어 있다(§13.3)', () => {
    expect(MESSAGES.deploySchedules.reasons.failure.APPROVAL_MISSING).toBe('승인 없음(2인 승인 필요)');
  });
});
