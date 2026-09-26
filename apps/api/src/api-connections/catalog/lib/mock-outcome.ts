import { createHash } from 'crypto';
import type { ApiCallResult, ApiCallOutcome, ApiSampleResponse, SimulateMockResponse } from '@chat-bot/shared-types';

/**
 * [No.26] 시뮬레이터·비교·TC 목 원천 → `ApiCallResult` 순수 변환(§6.2 `mock-outcome.ts`).
 * DB·Nest·네트워크 무의존(NFR-LM1) — `ApiConnectionCatalogService`가 읽어 온 샘플 배열만 받는다.
 */
export interface MockOutcome {
  result: ApiCallResult;
  /** 샘플을 썼을 때만(해시 앞 8자리). */
  sampleHash8?: string;
  sampleLabel?: string;
  /** 샘플이 없어 실패를 재현했을 때만(FR-L7-1). */
  noSample?: boolean;
}

const FAILURE_ONLY_OUTCOMES = new Set<ApiCallOutcome>([
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'REDIRECT_NOT_ALLOWED',
  'BLOCKED_ADDRESS',
  'BLOCKED_URL',
  'CIRCUIT_OPEN',
  'RATE_LIMITED',
  'CONNECTION_DISABLED',
  'CONNECTION_MISSING',
  'METHOD_NOT_ALLOWED',
  'SECRET_MISSING',
  'BINDING_MISSING',
  'FEATURE_DISABLED',
  // [신규 No.45] 시뮬레이터가 출구 차단 결과도 재현할 수 있어야 한다(ADR-0040 §6.5).
  'EGRESS_BLOCKED',
]);

function hashSample(sample: ApiSampleResponse): string {
  const json = JSON.stringify({ httpStatus: sample.httpStatus, body: sample.body });
  return createHash('sha256').update(json).digest('hex').slice(0, 8);
}

function sampleToOutcome(sample: ApiSampleResponse): MockOutcome {
  const sampleHash8 = hashSample(sample);
  if (sample.httpStatus >= 200 && sample.httpStatus < 300) {
    return { result: { kind: 'SUCCESS', httpStatus: sample.httpStatus, json: sample.body }, sampleHash8, sampleLabel: sample.label };
  }
  return { result: { kind: 'FAILURE', outcome: 'HTTP_ERROR', httpStatus: sample.httpStatus }, sampleHash8, sampleLabel: sample.label };
}

/**
 * `mockResponse` 지정 시 그것을 우선 쓴다 — `{sampleLabel}`(없는 라벨 → 호출부가 400 처리) ·
 * `{httpStatus, body}`(2xx면 SUCCESS) · `{failure}`. 미지정이면 **연결의 첫 번째 샘플**, 샘플이
 * 없으면 `FAILURE(INVALID_RESPONSE)` + `noSample: true`로 실패 분기를 재현한다(FR-L7-1 · §21 D-17).
 */
export function resolveMockOutcome(samples: readonly ApiSampleResponse[], mockResponse?: SimulateMockResponse): MockOutcome {
  if (mockResponse) {
    if ('sampleLabel' in mockResponse) {
      const sample = samples.find((s) => s.label === mockResponse.sampleLabel);
      if (!sample) return { result: { kind: 'FAILURE', outcome: 'INVALID_RESPONSE' }, noSample: true };
      return sampleToOutcome(sample);
    }
    if ('failure' in mockResponse) {
      const outcome = FAILURE_ONLY_OUTCOMES.has(mockResponse.failure) ? mockResponse.failure : 'INVALID_RESPONSE';
      return { result: { kind: 'FAILURE', outcome: outcome as Exclude<ApiCallOutcome, 'SUCCESS' | 'MAPPING_MISSING'> } };
    }
    // { httpStatus, body }
    if (mockResponse.httpStatus >= 200 && mockResponse.httpStatus < 300) {
      return { result: { kind: 'SUCCESS', httpStatus: mockResponse.httpStatus, json: mockResponse.body } };
    }
    return { result: { kind: 'FAILURE', outcome: 'HTTP_ERROR', httpStatus: mockResponse.httpStatus } };
  }

  const first = samples[0];
  if (!first) return { result: { kind: 'FAILURE', outcome: 'INVALID_RESPONSE' }, noSample: true };
  return sampleToOutcome(first);
}
