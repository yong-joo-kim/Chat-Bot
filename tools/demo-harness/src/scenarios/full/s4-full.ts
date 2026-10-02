// [DT-2] 풀 투어 ④ 학습 개선 루프(95 · 사내 생성 켬이면 75) — 설계 §9.3. DT-1 단계를 그대로 쓰고 S4-03(규칙 기반 예문 늘리기)만 조건부로 비활성한다.
// 증강 공급자는 프로세스 전역 1종이라(코드 확인 C-DX-1) 생성을 켜면 같은 기능을 ⑩이 로컬 생성으로 보인다.
import type { SegmentDef } from '../../scenario/types';
import { s4Segment } from '../s4';
import { derive } from './derive';

export const s4FullSegment: Pick<SegmentDef, 'steps' | 'skipOrder'> = {
  steps: s4Segment.steps.map((st) =>
    st.id === 'S4-03'
      ? derive(st, {
          when: (p) => !p.localLlm,
          inactive: 'option',
          // 생략이 아니라 장면 10으로 옮겨 보이는 것 — 고객 화면의 "생략한 장면" 줄에는 올리지 않는다(hidden)
          inactiveReason: () => ({
            kind: 'NOT_REQUESTED',
            sceneName: '예문 늘리기(규칙 기반)',
            customer: '장면 10에서 사내 생성 모델로 보여 드립니다',
            internal: '예문 늘리기는 장면 10에서 사내 생성 모델로 보입니다 (--with-local-llm)',
            hidden: true,
          }),
        })
      : st,
  ),
  skipOrder: ['S4-03', 'S4-06'],
};
