// 단건 질의 임베딩 300ms 예산 실측과 결정(설계 §14 · J-11 · FR-DH2-3).
import { httpJson } from '../util/json-request';

/** 대표 질의 23개(앞 3개는 버리고 20개로 P50/P95). 데이터셋 문장이 확정되면 그쪽으로 교체한다. */
export const DEFAULT_MEASURE_QUERIES: readonly string[] = [
  '물건이 아직 안 왔어요',
  '배송 조회하고 싶어요',
  '환불은 어떻게 하나요',
  '영업시간 알려 주세요',
  '포인트 적립은 언제 되나요',
  '주문을 변경하고 싶어요',
  '회원 정보 수정',
  '택배가 언제 오나요',
  '상담원이랑 직접 얘기하고 싶어요',
  '사람이랑 통화할 수 있나요?',
  '교환 기간이 얼마나 되나요',
  '영수증 발급 가능한가요',
  '배송비는 얼마예요',
  '운송장 번호로 조회할래요',
  '선물 포장 되나요',
  '적립금 소멸 기한',
  '비밀번호를 잊어버렸어요',
  '주문 취소하고 싶어요',
  '반품 접수 방법',
  '오늘 도착하나요',
  '결제 수단 변경',
  '쿠폰 사용법',
  '탈퇴하고 싶어요',
];

/** 최근접 순위 백분위(정렬된 배열). 20개의 P95 = 19번째 값(설계 §14). */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

export type TimeoutAction = 'keep' | 'raised' | 'confirm';

export interface TimeoutDecision {
  timeoutMs: number;
  action: TimeoutAction;
}

/** 실측 P95로 EMBEDDING_TIMEOUT_MS를 정한다(설계 §14 표): <=200 유지 · 201~1000 `clamp(50단위 올림(P95x2),400,2000)` · >1000 2000 + 진행자 확인. */
export function decideEmbeddingTimeout(p95Ms: number): TimeoutDecision {
  if (!Number.isFinite(p95Ms)) return { timeoutMs: 2000, action: 'confirm' };
  if (p95Ms <= 200) return { timeoutMs: 300, action: 'keep' };
  if (p95Ms > 1000) return { timeoutMs: 2000, action: 'confirm' };
  const raised = Math.ceil((p95Ms * 2) / 50) * 50;
  return { timeoutMs: Math.min(2000, Math.max(400, raised)), action: 'raised' };
}

export interface LatencyRound {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
}

export interface LatencyMeasurement {
  /** 결정에 쓴 마지막 라운드. */
  p50Ms: number;
  p95Ms: number;
  samples: number;
  /** 모든 라운드(안정화를 위해 반복했다면 여러 개 — 보고서에 공개). */
  rounds: LatencyRound[];
}

export interface MeasureOptions {
  baseUrl: string;
  queries?: readonly string[];
  /** 버릴 앞쪽 표본 수(기본 3). */
  discard?: number;
  samples?: number;
  /** P95가 200ms를 넘으면 다시 재는 최대 라운드 수(기본 3). */
  maxRounds?: number;
  /** 시험 주입용 단건 호출(밀리초 반환). */
  embedOnce?: (text: string) => Promise<number>;
}

async function embedOnceHttp(baseUrl: string, text: string): Promise<number> {
  const t0 = performance.now();
  const res = await httpJson(`${baseUrl}/embed`, { method: 'POST', body: { texts: [text], kind: 'QUERY' }, timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`/embed 응답 ${res.status}: ${res.text.slice(0, 120)}`);
  return performance.now() - t0;
}

/**
 * 순차 단건 호출로 지연을 잰다. 모델 적재 직후에는 첫 수십 건이 평소의 3~10배로 느릴 수 있어(2026-10-01 실측: 첫 라운드 P95 1.6초 ->
 * 안정 후 140ms) 한 번만 재면 시연 설정을 잘못 올리게 된다. 그래서 P95가 200ms 이하가 될 때까지 최대 maxRounds회 반복하고
 * 마지막 라운드로 결정하며, 모든 라운드를 기록해 보고서에 공개한다.
 */
export async function measureEmbedLatency(opts: MeasureOptions): Promise<LatencyMeasurement> {
  const queries = opts.queries ?? DEFAULT_MEASURE_QUERIES;
  const discard = opts.discard ?? 3;
  const samples = opts.samples ?? 20;
  const maxRounds = opts.maxRounds ?? 3;
  const once = opts.embedOnce ?? ((t: string) => embedOnceHttp(opts.baseUrl, t));
  const rounds: LatencyRound[] = [];
  for (let r = 0; r < maxRounds; r++) {
    const all: number[] = [];
    for (let i = 0; i < discard + samples; i++) all.push(await once(queries[i % queries.length]));
    const kept = all.slice(discard).sort((a, b) => a - b);
    const round: LatencyRound = { samplesMs: kept, p50Ms: percentile(kept, 0.5), p95Ms: percentile(kept, 0.95) };
    rounds.push(round);
    if (round.p95Ms <= 200) break;
  }
  const last = rounds[rounds.length - 1];
  return { p50Ms: last.p50Ms, p95Ms: last.p95Ms, samples, rounds };
}
