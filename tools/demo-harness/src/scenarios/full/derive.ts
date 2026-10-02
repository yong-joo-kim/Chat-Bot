// [DT-2] DT-1 단계 객체를 얕은 복사로 파생한다 — 원본은 절대 바꾸지 않는다(10분판 정의 불변 · 정적 검사 H-S7).
import type { StepDef } from '../../scenario/types';

export function derive(step: StepDef, patch: Partial<StepDef>): StepDef {
  return { ...step, ...patch };
}

/** 원본에서 단계 ID로 한 개 꺼낸다(없으면 던진다 — 풀 투어가 10분판 단계 ID에 기대고 있음을 시험이 지킨다). */
export function pick(steps: readonly StepDef[], id: string): StepDef {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`10분판에 단계 ${id}가 없습니다(풀 투어가 재사용하는 단계)`);
  return s;
}
