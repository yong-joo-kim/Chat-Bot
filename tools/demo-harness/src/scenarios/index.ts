// 시나리오 구간 슬롯 9개(시작 · 장면 1~7 · 마무리) — 1단계는 빈 슬롯만 둔다(설계 §3.1 `scenarios/`).
// 구간 제목·칩은 ui-spec §3.5, 예산은 설계 §11.1(합 600초). 단계 정의(step)는 다음 단계(H4·H5)에서 구간별 파일로 추가한다.
import type { SegmentDef } from '../scenario/types';
import { s1Segment } from './s1';
import { s2Segment } from './s2';
import { s3Segment } from './s3';
import { s4Segment } from './s4';

function slot(
  key: SegmentDef['key'],
  chip: string,
  title: string,
  budgetSec: number,
  skipOrder: string[],
): SegmentDef {
  return { key, chip, title, budgetSec, skipOrder, steps: [], slot: true };
}

function withSteps(seg: SegmentDef, def: Pick<SegmentDef, 'steps' | 'skipOrder'>): SegmentDef {
  return { ...seg, steps: def.steps, skipOrder: def.skipOrder, slot: false };
}

/** 설계 §11.1 예산표의 생략 순서(핵심 단계는 절대 포함하지 않는다). */
export function buildSegmentSlots(): SegmentDef[] {
  return [
    slot('opening', '시작', '구축형 구성 확인', 30, ['S0-02']),
    withSteps(slot('s1', '장면 1/7', '챗봇 구축과 위젯 대화', 90, []), s1Segment),
    withSteps(slot('s2', '장면 2/7', '상담원 인계', 80, []), s2Segment),
    withSteps(slot('s3', '장면 3/7', '통계와 대시보드', 55, []), s3Segment),
    withSteps(slot('s4', '장면 4/7', '학습 개선 루프', 95, []), s4Segment),
    slot('s5', '장면 5/7', '버전과 배포 통제', 95, ['S5-07']),
    slot('s6', '장면 6/7', '개인정보와 안전', 70, ['S6-06', 'S6-04', 'S6-05']),
    slot('s7', '장면 7/7', '발화 묶음 분석', 70, ['S7-01', 'S7-05']),
    slot('closing', '마무리', '마무리와 로드맵', 15, ['S9-02']),
  ];
}
