// 프리셋 customer-onprem-10m — 구축형(온프레미스) 고객 · 10분 · 시나리오 7개(PM 확정 2026-10-01, 설계 §0·§11.1).
// 30분 프리셋은 이 폴더에 파일을 추가하는 것으로 확장한다(`--preset <id>`).
import type { PresetDef } from '../scenario/types';
import { buildSegments } from '../scenarios';

export const customerOnprem10m: PresetDef = {
  id: 'customer-onprem-10m',
  audience: 'ONPREM',
  totalBudgetSec: 600,
  segments: buildSegments(),
  modesAllowed: ['visible', 'headless-check'],
};
