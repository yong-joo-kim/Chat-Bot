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
  /** 마무리 카드에서만 쓰는 공연 결과 집계. */
  results?: { passed: number; skipped: number; fallback: number; failed: number };
  /** 브라우저가 외부로 보내려던 요청 차단 건수(DHX-1 증거). */
  blockedRequests?: number;
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
