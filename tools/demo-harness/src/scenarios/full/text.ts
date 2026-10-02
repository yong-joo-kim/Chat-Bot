// [DT-2] 풀 투어 사실 의존 문구 — 계획 문맥·사실에 따라 바뀌는 자막·안내 줄을 순수 함수로 모은다(설계 §3.3 · H-T19 ④).
// 모든 출력은 줄당 40자 · 원문자·화살표·기호 금지(ui-spec A-1·A-9)를 지켜야 하고, 고객 화면에는 `--` 옵션 이름·포트가 없어야 한다(H-T27).
// 단위 시험이 16개 대표 계획 × 장치 선택·대체 × 거버넌스·대기 시간 사실 조합 전부에서 검사한다.
import { egressNames, gpuUse, type PlanContext } from '../../scenario/plan';
import type { RunFacts } from '../../scenario/types';

/** S0-01·S0-02 문구가 읽는 사실(RunFacts의 부분집합 — 시험에서 간단히 만들 수 있게). */
export type FactsLite = Pick<RunFacts, 'governanceFallback' | 'embeddingTimeoutMs' | 'embeddingTimeoutDefault'>;

/** 음성 인식 GPU 사용(장치 cuda) 여부 — S0-01 변형 선택 조건. */
export function isSttGpu(p: PlanContext): boolean {
  return p.voiceInput === 'real' && p.sttDevice === 'cuda';
}

export const S0_01_NARRATION_CPU: string[] = ['이 노트북 한 대를 사내 서버로 가정했습니다', '문장 분석은 GPU 없이 CPU로 돕니다'];
export const S0_01_NARRATION_GPU: string[] = ['이 노트북 한 대를 사내 서버로 가정했습니다', '문장 분석은 CPU, 음성 인식은 이 노트북 GPU'];

/** S0-01 안내 줄 — 장치 선택·대체가 시연용 설정보다 우선한다(A-16). 밀린 쪽은 시작 카드 알림 줄·보고서에 남는다. */
export function s001Disclosure(p: PlanContext, f: FactsLite): string | undefined {
  if (p.deviceNote?.kind === 'FALLBACK') return '음성 인식 장치를 GPU에서 CPU로 바꿔 시작했습니다';
  if (p.deviceNote?.kind === 'SELECTED') return '이 PC는 GPU 조건이 안 돼 음성 인식을 CPU로 돌립니다';
  if (f.governanceFallback) return '이번 시연은 데이터 통제 모드를 끈 상태입니다';
  if (f.embeddingTimeoutMs !== f.embeddingTimeoutDefault) return `문장 분석 대기 시간을 ${f.embeddingTimeoutMs}ms로 늘렸습니다`;
  if (gpuUse(p) !== 'none') return '이 노트북 GPU를 쓰는 구간이 있습니다';
  return undefined;
}

/** S0-02 안내 줄 — `출구 허용 N곳: 이름 목록`(1곳이면 이 PC 안 표기). */
export function s002Disclosure(p: PlanContext): string {
  const names = egressNames(p);
  return names.length === 1 ? `출구 허용 1곳: ${names[0]}(이 PC 안)` : `출구 허용 ${names.length}곳: ${names.join('·')}`;
}

/** SV-01 안내 줄 — 음성 입력 상태(기본/불가/실제/모의). */
export function sv01Disclosure(p: PlanContext): string {
  if (p.voiceInput === 'real') return `음성 인식 ${p.sttModel ?? ''} · ${p.sttDevice === 'cuda' ? '이 노트북 GPU' : 'CPU'}`.trim();
  if (p.voiceInput === 'mock') return '모의 인식입니다 · 음성 인식 미검증';
  if (p.voiceRequested) return '음성 입력은 이 PC에서 준비하지 못해 생략합니다';
  return '이 PC 구성에서는 서버 음성 인식을 켜지 않았습니다';
}

/** SV-03 안내 줄. */
export function sv03Disclosure(p: PlanContext): string {
  return p.voiceInput === 'mock' ? '모의 인식입니다 · 음성 인식 미검증' : '합성 음성 파일을 가상 마이크로 넣습니다';
}

/** SV-07 자막 본문 — 음성 입력을 쓴 실행은 음성 원본 저장 0도 함께 말한다. */
export function sv07Narration(p: PlanContext): string[] {
  return p.voiceInput === 'off' ? ['읽기는 고객 기기 안에서 합니다'] : ['음성 원본은 저장하지 않습니다', '읽기는 고객 기기 안에서 합니다'];
}

/** SE-01 자막 본문 — 음성 인식을 내리는 단계가 있는지(G)에 따라. */
export function se01Narration(p: PlanContext): string[] {
  return isSttGpu(p) ? ['음성 인식을 내리고 사내 소형 생성 모델을 올립니다'] : ['사내 소형 생성 모델을 이 노트북 GPU에 올립니다'];
}

export const SE01_DISCLOSURE = '4B 소형 모델 · 이 노트북 GPU · 동작 확인 수준';
export const SE02_DISCLOSURE = '문장 품질은 보증하지 않습니다(경량 구성)';
export const SP01_DISCLOSURE = '시연을 위해 머문 시간을 5초로 줄였습니다';
export const SV05_NO_VOICE_DISCLOSURE = '이 PC에는 기기 안 한국어 음성이 없습니다';

/** S7-07 안내 줄 — 사전 분석이 걸린 시간(초)을 알면 함께 알린다. */
export function s707Disclosure(preSec: number | null): string | undefined {
  return preSec !== null && preSec > 0 ? `앞서 같은 파일은 약 ${preSec}초 걸렸습니다` : undefined;
}

/** S7-02 자막 본문 — 방금 실제로 분석한 결과인지(스크래치에 분석 ID가 있는지)에 따라. */
export function s702Narration(freshAnalysis: boolean): string[] {
  return freshAnalysis ? ['방금 분석한 결과를 묶음별로 봅니다'] : ['같은 파일을 분석한 결과를 묶음별로 봅니다'];
}

/** 대체 자막 총표(ui-spec §16.13.2) — 정의 검사 대상 밖이라 시험이 직접 검사한다. */
export const FALLBACK_TEXTS = {
  SV03: { caption: '음성 인식이 지연되어 같은 문장을 글자로 입력합니다' },
  SV05: { caption: '이 PC에서는 소리 재생을 할 수 없습니다' },
  SP01: { caption: '말풍선이 뜨지 않아 관리자 화면으로 대신 보여 드립니다' },
  S707: { caption: '분석이 길어져 미리 실행해 둔 결과를 보여 드립니다' },
  S706: { caption: '결과를 엑셀로 받으면 받은 사람과 행 수가 기록됩니다', notice: '파일 받기를 이 PC가 막아 같은 파일을 서버에서 직접 받았습니다' },
  SE01: { caption: '이번에는 모델을 올리지 못해 미리 만든 결과로 보여 드립니다', notice: '동작 확인 수준 · 사전 결과' },
  SE02_DEGRADED: { caption: '소형 모델이 이번에는 후보를 만들지 못해 규칙 기반 후보로 대신했습니다' },
  SE02_PREPARED: { caption: '사내 소형 모델이 만든 예문 후보입니다', notice: '미리 같은 모델로 만들어 둔 결과입니다' },
} as const;
