// 끝 장면 로드맵 문구 원천(설계 §10.9 · ui-spec §6.3) — 무대 `/roadmap` · 보고서 로드맵 절 · 정합 시험(H-T18)이 같은 데이터를 쓴다.
// 문구는 `docs/01-requirements/기능요구사항.md` 비고 열과 `CLAUDE.md` 상태를 근거로 하며 사실보다 낙관적으로 쓰지 않고, 출시 일정·성능을 약속하지 않는다(FR-DH10-2).
// [DT-2 FR-DX0-1] No.32(음성 AI)는 구현이 끝났으므로 "시연 불가"로 쓰지 않는다 — "구현됨 · 확장판에서 시연 예정".

export type RoadmapStatus = 'IMPLEMENTED_DEMO_LATER' | 'NOT_STARTED' | 'AWAITING_PROD_SERVER' | 'REQUIREMENTS_DRAFT';

/** 상태 칩 문구(어휘 4종만 — `개발 중`·`곧 출시`·`준비 중` 같은 일정 암시 표현 금지). */
export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  IMPLEMENTED_DEMO_LATER: '구현됨 · 확장판에서 시연 예정',
  NOT_STARTED: '미착수',
  AWAITING_PROD_SERVER: '운영 서버 확인 대기',
  REQUIREMENTS_DRAFT: '요구사항 정리 중(미착수)',
};

export interface RoadmapRow {
  /** `기능요구사항.md`의 기능 번호. */
  featureNo: number;
  /** 고객이 알아듣는 쉬운 말. */
  name: string;
  /** 한 줄 이유(<= 38자). */
  why: string;
  status: RoadmapStatus;
  /** 근거 문서·비고 인용(보고서에는 싣지 않고 유지보수·정합 시험용). */
  source: string;
}

/** 행 순서는 고객이 먼저 물을 법한 순이며 우선순위와 무관하다(하단 고정 문구가 말한다). */
export const ROADMAP: readonly RoadmapRow[] = [
  { featureNo: 32, name: '음성 응대', why: '눌러서 말하기와 듣기는 이미 만들어져 있습니다', status: 'IMPLEMENTED_DEMO_LATER', source: '기능요구사항.md No.32 비고 "구현 완료" · demo-harness-expansion.md FR-DX0-1' },
  { featureNo: 33, name: '이미지·문서 이해', why: '사진·스캔 문서를 읽는 모델은 운영용 GPU 서버가 필요합니다', status: 'NOT_STARTED', source: '기능요구사항.md No.33 비고 "-"' },
  { featureNo: 31, name: '업무를 스스로 실행하는 챗봇', why: '예약·환불 같은 여러 단계를 스스로 처리하는 기능입니다', status: 'NOT_STARTED', source: '기능요구사항.md No.31 비고 "-"' },
  { featureNo: 34, name: '고객별 맞춤 응답', why: '고객 이력을 반영해 답을 바꾸는 기능입니다', status: 'NOT_STARTED', source: '기능요구사항.md No.34 비고(식별 고객 개인화는 이 기능에서)' },
  { featureNo: 17, name: '챗봇이 스스로 문장 만들기', why: '운영용 GPU 서버에서 성능을 확인한 뒤 안내드립니다', status: 'AWAITING_PROD_SERVER', source: 'CLAUDE.md 다음 단계 No.17(L40S 실측 대기)' },
  { featureNo: 38, name: '글로 지시해 대화 흐름 만들기', why: '요구사항 정리 중입니다', status: 'REQUIREMENTS_DRAFT', source: 'CLAUDE.md No.38 보류 · 설계 §24 Q-7 기본안' },
];

/** 로드맵에 올라 있는 기능 번호(정합 시험·보고서 공용). */
export const ROADMAP_FEATURE_NOS: readonly number[] = ROADMAP.map((r) => r.featureNo);
