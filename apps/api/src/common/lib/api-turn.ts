import { resumeAfterApiCall } from '@chat-bot/dialogue-engine';
import type { ApiCallSuspension, DialogueTurnResult } from '@chat-bot/dialogue-engine';
import type { ApiCallResult, DialogueBundle } from '@chat-bot/shared-types';

/**
 * [No.26] 목 실행기 공용 헬퍼(§6.5, NFR-LM4) — 소비자별로 달라지는 것은 실행기(목/실제) 하나뿐이다.
 * 실제 실행기(비동기)는 `LegacyApiService.completeTurn()` 안에 있고 같은 `resumeAfterApiCall`을
 * 호출한다. `request === null`(바인딩 누락)은 두 경로 모두 실행기를 부르지 않고
 * `FAILURE(BINDING_MISSING)`로 재진입한다.
 */
export type SyncApiExecutor = (suspension: ApiCallSuspension) => {
  result: ApiCallResult;
  mock?: { sampleHash8?: string; sampleLabel?: string; noSample?: boolean };
};

export interface CompleteApiTurnSyncResult {
  turn: DialogueTurnResult;
  mock?: { sampleHash8?: string; sampleLabel?: string; noSample?: boolean };
}

export function completeApiTurnSync(
  turn: DialogueTurnResult,
  exec: SyncApiExecutor,
  bundle: DialogueBundle,
  now: Date,
): CompleteApiTurnSyncResult {
  const suspension = turn.apiCall;
  if (!suspension) return { turn };

  if (!suspension.request) {
    const resumed = resumeAfterApiCall(turn as DialogueTurnResult & { apiCall: ApiCallSuspension }, { kind: 'FAILURE', outcome: 'BINDING_MISSING' }, bundle, now);
    return { turn: resumed };
  }

  const { result, mock } = exec(suspension);
  const resumed = resumeAfterApiCall(turn as DialogueTurnResult & { apiCall: ApiCallSuspension }, result, bundle, now);
  return { turn: resumed, mock };
}
