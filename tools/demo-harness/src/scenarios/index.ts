// 시나리오 구간 9개(시작 · 장면 1~7 · 마무리) — 구간 제목·칩은 ui-spec §3.5, 예산은 설계 §11.1(합 600초), 단계 정의는 구간별 파일.
import type { SegmentDef } from '../scenario/types';
import { closingSegment } from './closing';
import { openingSegment } from './opening';
import { s1Segment } from './s1';
import { s2Segment } from './s2';
import { s3Segment } from './s3';
import { s4Segment } from './s4';
import { s5Segment } from './s5';
import { s6Segment } from './s6';
import { s7Segment } from './s7';

function seg(key: SegmentDef['key'], chip: string, title: string, budgetSec: number, def: Pick<SegmentDef, 'steps' | 'skipOrder'>): SegmentDef {
  return { key, chip, title, budgetSec, skipOrder: def.skipOrder, steps: def.steps };
}

/** 설계 §11.1 예산표의 구간·생략 순서(핵심 단계는 절대 포함하지 않는다). */
export function buildSegments(): SegmentDef[] {
  return [
    seg('opening', '시작', '구축형 구성 확인', 30, openingSegment),
    seg('s1', '장면 1/7', '챗봇 구축과 위젯 대화', 90, s1Segment),
    seg('s2', '장면 2/7', '상담원 인계', 80, s2Segment),
    seg('s3', '장면 3/7', '통계와 대시보드', 55, s3Segment),
    seg('s4', '장면 4/7', '학습 개선 루프', 95, s4Segment),
    seg('s5', '장면 5/7', '버전과 배포 통제', 95, s5Segment),
    seg('s6', '장면 6/7', '개인정보와 안전', 70, s6Segment),
    seg('s7', '장면 7/7', '발화 묶음 분석', 70, s7Segment),
    seg('closing', '마무리', '마무리와 로드맵', 15, closingSegment),
  ];
}
