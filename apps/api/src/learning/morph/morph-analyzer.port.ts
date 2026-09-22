/**
 * No.23 요소분해의 형태소 분석 포트(ADR-0028 §2). 소비자(`decompose()` 순수 함수 — backend-implementer가
 * `learning` 모듈에서 배선한다)는 이 인터페이스만 알아야 한다. 로드는 기동 시 1회(비동기)이며,
 * `analyze()` 자체는 메모리 내 연산이라 동기 함수다.
 *
 * ⚠ 알려진 한계(실측으로 확인, M1 `garu-ko` 기준): 반환되는 `start`/`end`는 **어절(eojeol) 단위
 * 오프셋**이다 — 같은 어절 안의 여러 형태소가 같은 `start`/`end`를 공유한다("해외로" → `해외`
 * `[0,3)`, `로` `[0,3)`, 원문 슬라이스는 둘 다 "해외로"). 또한 불규칙 활용(예: "보내"+"ㄹ" → 표면형
 * "보낼")에서는 형태소 `surface`를 원문에 이어붙여도 원문 부분 문자열과 일치하지 않을 수 있다.
 * 즉 **이 포트는 어절 경계까지만 신뢰할 수 있는 힌트를 제공하며, 어절 내부의 글자 단위 분할은
 * 소비자가 gazetteer 우선순위(ADR-0028 §3 ①)로 보정하거나 보수적으로 어절 전체를 1개 스팬으로
 * 유지해야 한다.** 이 한계는 형태소 분석기 일반의 특성이며, 그래서 관리자가 칩 경계를 직접 수정할
 * 수 있게 하는 안전장치(FR-L2-8)가 설계에 이미 포함되어 있다.
 */
export interface MorphToken {
  readonly surface: string;
  readonly start: number;
  readonly end: number;
  readonly pos: string;
}

export interface MorphAnalyzerPort {
  /** 분해 응답에 실려 화면이 "정밀 분석 사용 중 / 기본 분해"를 구분해 표시한다. */
  readonly analyzerId: string;
  /** 로드 실패·미설치 = false. false일 때 `analyze()`는 빈 배열을 반환해야 한다(예외 금지). */
  readonly ready: boolean;
  analyze(text: string): readonly MorphToken[];
}
