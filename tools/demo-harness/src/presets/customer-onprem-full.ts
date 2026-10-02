// [DT-2] 프리셋 customer-onprem-full — 구축형(온프레미스) 고객 · 풀 투어(기본 약 13분 50초 · 모델 장면 플래그를 모두 켜면 약 17분 15초) · ADR-0053.
// 10분판(`customer-onprem-10m`)은 정의·단계 ID·예산·검증을 바꾸지 않는다 — 이 프리셋은 DT-1 단계 객체를 그대로 또는 얕은 복사(derive)로 쓴다.
// 구간 예산은 활성 단계 합으로 해석기(`resolvePreset`)가 계산하고(여기의 budgetSec는 자리 표시 0), 대표 계획 16개의 총 예산은 `expectedTotals`로 선언해 정의 검사가 대조한다.
import { edgeInactiveReason } from '../scenario/plan';
import type { PresetDef, SegmentDef } from '../scenario/types';
import { s1Segment } from '../scenarios/s1';
import { s2Segment } from '../scenarios/s2';
import { s3Segment } from '../scenarios/s3';
import { s5Segment } from '../scenarios/s5';
import { closingFullSegment } from '../scenarios/full/closing-full';
import { edgeSegment } from '../scenarios/full/edge';
import { openingFullSegment } from '../scenarios/full/opening-full';
import { proactiveSegment } from '../scenarios/full/proactive';
import { s4FullSegment } from '../scenarios/full/s4-full';
import { s6FullSegment } from '../scenarios/full/s6-full';
import { s7FullSegment } from '../scenarios/full/s7-full';
import { voiceSegment } from '../scenarios/full/voice';

function seg(key: SegmentDef['key'], chip: string, title: string, def: Pick<SegmentDef, 'steps' | 'skipOrder'>, extra: Partial<SegmentDef> = {}): SegmentDef {
  return { key, chip, title, budgetSec: 0, skipOrder: def.skipOrder, steps: def.steps, ...extra };
}

/** 대표 계획별 총 예산(초) — 제안 · 미실측(리허설 보정). 음성 real·mock은 같은 예산. SE-01은 K0 실측(DX-7)으로 25초. */
export const FULL_EXPECTED_TOTALS: Record<string, number> = {
  'v:off|l:0|c:0': 830,
  'v:off|l:0|c:1': 890,
  'v:off|l:1|c:0': 930,
  'v:off|l:1|c:1': 990,
  'v:real|l:0|c:0': 875,
  'v:real|l:0|c:1': 935,
  'v:real|l:1|c:0': 975,
  'v:real|l:1|c:1': 1035,
  'v:mock|l:0|c:0': 875,
  'v:mock|l:0|c:1': 935,
  'v:mock|l:1|c:0': 975,
  'v:mock|l:1|c:1': 1035,
};

export const customerOnpremFull: PresetDef = {
  id: 'customer-onprem-full',
  audience: 'ONPREM',
  /** 기본 투어(플래그 없음) 총 예산 — 실제 총 예산은 계획 문맥으로 해석한 값(`resolvePreset`). */
  totalBudgetSec: 830,
  autoChips: true,
  flags: ['voiceInput', 'localLlm', 'liveClustering'],
  expectedTotals: FULL_EXPECTED_TOTALS,
  modesAllowed: ['visible', 'headless-check'],
  segments: [
    seg('opening', '시작', '구축형 구성 확인', openingFullSegment),
    seg('s1', '', '챗봇 구축과 위젯 대화', s1Segment),
    seg('s2', '', '상담원 인계', s2Segment),
    seg('s3', '', '통계와 대시보드', s3Segment),
    seg('s4', '', '학습 개선 루프', s4FullSegment),
    seg('s5', '', '버전과 배포 통제', s5Segment),
    seg('s6', '', '개인정보와 안전', s6FullSegment),
    seg('s7', '', '발화 묶음 분석', s7FullSegment),
    seg('voice', '', '음성 응대', voiceSegment),
    seg('proactive', '', '먼저 말 거는 안내', proactiveSegment),
    seg('edge', '', '사내 소형 생성 모델', edgeSegment, { when: (p) => p.localLlm, inactiveReason: edgeInactiveReason }),
    seg('closing', '마무리', '마무리와 로드맵', closingFullSegment),
  ],
};
