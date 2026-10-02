// 시작/마무리 카드(/system)가 표시하는 "하네스가 확인한 사실"(ui-spec §7) — `/__facts` JSON으로 제공한다. 값이 없으면 항상 "확인 못함" 계열 문구가 나온다.
export interface StageFacts {
  device: string;
  gpuHidden: boolean;
  gpuPresent: boolean;
  /** 단건 임베딩 지연 P95(ms) — 측정 실패면 null. */
  latencyP95: number | null;
  /** 외부 주소 설정 개수(서버 출구 키 중 값이 있는 것). */
  externalAddresses: number;
  network: 'closed' | 'open' | 'unknown';
  governance: 'ON' | 'OFF';
  egressAllowed: number;
  apiBindNote: string;
  /** 마무리 카드에서만 쓰는 공연 결과 집계. [DT-2] `optionSkipped` = 옵션(이 PC 구성)으로 생략한 단계 수 — `skipped`에는 섞지 않는다. */
  results?: { passed: number; skipped: number; fallback: number; failed: number; optionSkipped?: number };
  /** 브라우저가 외부로 보내려던 요청 차단 건수(DHX-1 증거). */
  blockedRequests?: number;
  /** [DT-2] 풀 투어 계획 요약 · GPU 전환 카드 값 · 지금 GPU를 쓰는 것들. */
  plan?: StagePlanFacts;
  gpu?: StageGpuFacts;
  gpuActive?: string[];
}

/** [DT-2] 풀 투어 계획 요약(시작·마무리 카드 · 로드맵이 읽는다). 10분판은 undefined — 카드가 DT-1 문구를 그대로 쓴다. */
export interface StagePlanFacts {
  sceneCount: number;
  totalSec: number;
  servers: string[];
  voice: { state: 'SHOWN' | 'NOT_REQUESTED' | 'UNAVAILABLE'; modelLabel: string | null; device: 'GPU' | 'CPU' | null; note: 'SELECTED' | 'FALLBACK' | null; noteReason: string | null };
  llm: { state: 'SHOWN' | 'NOT_REQUESTED' | 'UNAVAILABLE'; modelLabel: string | null };
  liveClustering: boolean;
  gpuUse: 'none' | 'stt' | 'llm' | 'both';
  gpuUseText: string;
  egressNames: string[];
  augmentation: 'rule' | 'local';
  /** 이 PC 구성에서 생략한 장면(고객용 한 줄) — 없으면 빈 배열. */
  omittedLines: string[];
  /** 활성 장면 이름(로드맵 "오늘 보여 드린 N가지") · 오늘 시연한 기능 번호(로드맵 행에서 제외). */
  sceneTitles: string[];
  demonstratedNos: number[];
}

/** [DT-2] ⑩ GPU 전환 카드(`/system?view=gpu`)가 읽는 값 — 값이 없으면 카드가 "확인 못함" 계열 문구를 쓴다. */
export interface StageGpuFacts {
  /** 음성 인식 프로세스 상태(내리기 전·후). */
  sttState: 'RUNNING' | 'STOPPED' | 'NONE' | 'UNKNOWN';
  beforeStopMiB: number | null;
  afterStopMiB: number | null;
  usedMiB: number | null;
  totalMiB: number | null;
  loadSec: number | null;
  model: string | null;
  ollamaActive: boolean;
  phase: 'idle' | 'stopping' | 'loading' | 'verifying' | 'done' | 'failed';
  /** 실패한 행(1 회수 · 2 올리기 · 3 확인) — 없으면 null. */
  failedStep: 1 | 2 | 3 | null;
}

export function defaultFacts(): StageFacts {
  return {
    device: 'cpu',
    gpuHidden: true,
    gpuPresent: false,
    latencyP95: null,
    externalAddresses: 0,
    network: 'unknown',
    governance: 'ON',
    egressAllowed: 1,
    apiBindNote: 'API는 같은 네트워크에서도 접속할 수 있습니다(제품 동작)',
  };
}
